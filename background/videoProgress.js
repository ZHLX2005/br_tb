/**
 * Video Progress Tracking Module
 * Handles video group CRUD and watch progress updates
 */

import { generateId } from './utils.js';

const COLORS = ['#ef5350', '#ec407a', '#ab47bc', '#7e57c2', '#5c6bc0', '#42a5f5', '#29b6f6', '#26c6da', '#26a69a', '#66bb6a', '#9ccc65', '#d4e157', '#ffee58', '#ffca28', '#ffa726', '#ff7043'];

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('bilibili.com') && u.pathname.startsWith('/video/')) {
      let path = u.pathname;
      if (path.endsWith('/')) path = path.slice(0, -1);
      return `${u.protocol}//${u.hostname}${path}`;
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Open the video progress page
 */
async function openVideoProgressPage() {
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find(tab => tab.url?.includes('modules/video-progress/video-progress.html'));

  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { active: true });
  } else {
    await chrome.tabs.create({
      url: chrome.runtime.getURL('modules/video-progress/video-progress.html')
    });
  }
}

/**
 * Setup message listeners for video progress operations
 */
function setupVideoProgressListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
      try {
        switch (request.action) {
          case 'getVideoGroups': {
            const result = await chrome.storage.local.get(['videoGroups']);
            const videoGroups = ('videoGroups' in result) ? result.videoGroups : [];
            sendResponse({ success: true, videoGroups });
            break;
          }

          case 'getCurrentVideoGroup': {
            const result = await chrome.storage.local.get(['videoGroups']);
            const videoGroups = ('videoGroups' in result) ? result.videoGroups : [];
            const normalizedCurrentUrl = normalizeUrl(request.url || '');

            for (const group of videoGroups) {
              const idx = group.videos.findIndex(v => normalizeUrl(v.url) === normalizedCurrentUrl);
              if (idx !== -1) {
                sendResponse({ success: true, group, currentIndex: idx });
                return;
              }
            }
            sendResponse({ success: false });
            break;
          }

          case 'addVideoGroup': {
            const result = await chrome.storage.local.get(['videoGroups']);
            const videoGroups = ('videoGroups' in result) ? result.videoGroups : [];

            const newGroup = {
              id: generateId(),
              name: request.name || '新课程',
              color: request.color || COLORS[videoGroups.length % COLORS.length],
              createdAt: new Date().toISOString(),
              videos: []
            };

            videoGroups.unshift(newGroup);
            await chrome.storage.local.set({ videoGroups });
            sendResponse({ success: true, videoGroup: newGroup });
            break;
          }

          case 'deleteVideoGroup': {
            const result = await chrome.storage.local.get(['videoGroups']);
            const videoGroups = ('videoGroups' in result) ? result.videoGroups : [];
            const filtered = videoGroups.filter(g => g.id !== request.groupId);
            await chrome.storage.local.set({ videoGroups: filtered });
            sendResponse({ success: true });
            break;
          }

          case 'renameVideoGroup': {
            const result = await chrome.storage.local.get(['videoGroups']);
            const videoGroups = ('videoGroups' in result) ? result.videoGroups : [];
            const group = videoGroups.find(g => g.id === request.groupId);
            if (group) {
              group.name = request.newName;
              await chrome.storage.local.set({ videoGroups });
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'Group not found' });
            }
            break;
          }

          case 'addVideoToGroup': {
            const result = await chrome.storage.local.get(['videoGroups']);
            const videoGroups = ('videoGroups' in result) ? result.videoGroups : [];
            const group = videoGroups.find(g => g.id === request.groupId);

            if (!group) {
              sendResponse({ success: false, error: 'Group not found' });
              return;
            }

            const normalizedUrl = normalizeUrl(request.video.url);

            // Check if video already exists in this group
            const exists = group.videos.some(v => v.url === normalizedUrl);
            if (exists) {
              sendResponse({ success: false, error: 'Video already in group' });
              return;
            }

            const newVideo = {
              id: generateId(),
              title: request.video.title || '未命名视频',
              url: normalizedUrl,
              duration: request.video.duration || 0,
              watched: request.video.watched || 0,
              favicon: request.video.favicon || '',
              pageTitle: request.video.pageTitle || '',
              addedAt: new Date().toISOString()
            };

            group.videos.push(newVideo);
            await chrome.storage.local.set({ videoGroups });
            sendResponse({ success: true, video: newVideo });
            break;
          }

          case 'removeVideoFromGroup': {
            const result = await chrome.storage.local.get(['videoGroups']);
            const videoGroups = ('videoGroups' in result) ? result.videoGroups : [];
            const group = videoGroups.find(g => g.id === request.groupId);

            if (group) {
              group.videos = group.videos.filter(v => v.id !== request.videoId);
              await chrome.storage.local.set({ videoGroups });
            }
            sendResponse({ success: true });
            break;
          }

          case 'updateVideoProgress': {
            const result = await chrome.storage.local.get(['videoGroups']);
            const videoGroups = ('videoGroups' in result) ? result.videoGroups : [];
            const normalizedReqUrl = normalizeUrl(request.url);

            for (const group of videoGroups) {
              const video = group.videos.find(v => v.url === normalizedReqUrl);
              if (video) {
                video.watched = Math.max(video.watched || 0, request.watched || 0);
                video.duration = request.duration || video.duration || 0;
                video.title = request.title || video.title;
                break;
              }
            }

            await chrome.storage.local.set({ videoGroups });
            sendResponse({ success: true });
            break;
          }

          case 'openVideoGroup': {
            const result = await chrome.storage.local.get(['videoGroups']);
            const videoGroups = ('videoGroups' in result) ? result.videoGroups : [];
            const group = videoGroups.find(g => g.id === request.groupId);

            if (group && group.videos.length > 0) {
              for (const video of group.videos) {
                await chrome.tabs.create({ url: video.url });
              }
            }
            sendResponse({ success: true });
            break;
          }

          case 'openVideoProgressPage': {
            await openVideoProgressPage();
            sendResponse({ success: true });
            break;
          }

          case 'detectPageVideos': {
            // This is handled by content script, but we ack here
            sendResponse({ success: true });
            break;
          }

          default:
            return false;
        }
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true;
  });
}

export { setupVideoProgressListeners, openVideoProgressPage };
