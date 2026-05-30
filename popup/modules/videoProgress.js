/**
 * Popup Video Progress Module
 * 在 popup 中展示视频课程进度
 */

import { escapeHtml, showToast } from './utils.js';
import { normalizeUrl } from '../../background/utils.js';
import { getVideoDisplayProgress, getGroupDisplayProgress } from '../../modules/video-progress/progress-utils.js';

let videoGroups = [];

/**
 * 加载视频组数据和进度条设置
 */
export async function loadVideoProgress() {
  try {
    const [groupsRes, settingsRes] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'getVideoGroups' }),
      chrome.runtime.sendMessage({ action: 'getSettings' })
    ]);
    videoGroups = groupsRes.success ? (groupsRes.videoGroups || []) : [];
    videoGroups = videoGroups.filter(g => !g.archived);
    renderVideoProgress();

    const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
    const showBarEl = document.getElementById('popupShowCourseProgressBar');
    const showUnrelatedEl = document.getElementById('popupShowBarOnUnrelatedTabs');
    if (showBarEl) showBarEl.checked = settings.showCourseProgressBar || false;
    if (showUnrelatedEl) showUnrelatedEl.checked = settings.showCourseProgressBarOnUnrelatedTabs || false;
  } catch (err) {
    console.error('[Popup] Failed to load video progress:', err);
  }
}

/**
 * 检测并显示当前页面视频信息
 */
export async function refreshCurrentVideo() {
  const container = document.getElementById('vpCurrentVideo');
  if (!container) return;

  container.innerHTML = '<div class="vp-current-loading">检测中...</div>';

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab || !activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://') || activeTab.url.startsWith('edge://')) {
      container.innerHTML = '<div class="vp-current-none">当前页面不支持视频检测</div>';
      return;
    }

    let results;
    try {
      results = await chrome.tabs.sendMessage(activeTab.id, { action: 'detectVideos' });
    } catch (err) {
      container.innerHTML = '<div class="vp-current-none">页面未就绪或不存在视频</div>';
      return;
    }

    if (!results || !results.videos || results.videos.length === 0) {
      container.innerHTML = '<div class="vp-current-none">当前页面未检测到视频</div>';
      return;
    }

    const video = results.videos[0]; // 取第一个视频

    // 查找该视频是否已在课程组中
    let foundGroup = null;
    let foundVideo = null;
    const normalizedVideoUrl = normalizeUrl(video.url);
    for (const g of videoGroups) {
      const v = g.videos.find(x => x.url === normalizedVideoUrl);
      if (v) {
        foundGroup = g;
        foundVideo = v;
        break;
      }
    }

    if (foundGroup && foundVideo) {
      const percent = getVideoDisplayProgress(foundVideo);
      container.innerHTML = `
        <div class="vp-current-box">
          <div class="vp-current-title">${escapeHtml(video.title || '未命名视频')}</div>
          <div class="vp-current-meta">
            已加入 "${escapeHtml(foundGroup.name)}" · 进度 ${percent}% · ${formatDuration(foundVideo.watched || 0)} / ${formatDuration(foundVideo.duration)}
          </div>
          <div class="vp-current-bar">
            <div class="vp-current-fill" style="width:${percent}%"></div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="vp-current-box">
          <div class="vp-current-title">${escapeHtml(video.title || '未命名视频')}</div>
          <div class="vp-current-meta">${formatDuration(video.duration)} · 未加入课程</div>
        </div>
      `;
    }
  } catch (error) {
    container.innerHTML = '<div class="vp-current-none">检测失败</div>';
  }
}

/**
 * 渲染视频进度面板
 */
function renderVideoProgress() {
  const container = document.getElementById('videoProgressList');
  if (!container) return;

  if (videoGroups.length === 0) {
    container.innerHTML = `
      <div class="vp-empty-state">
        <div class="vp-empty-text">暂无课程</div>
        <div class="vp-empty-desc">捕获当前页面视频开始学习追踪</div>
      </div>
    `;
    return;
  }

  let totalVideos = 0;
  let totalDuration = 0;
  let totalWatched = 0;

  videoGroups.forEach(g => {
    g.videos.forEach(v => {
      totalVideos++;
      totalDuration += v.duration || 0;
      totalWatched += v.watched || 0;
    });
  });

  const allVideos = videoGroups.flatMap(g => g.videos);
  const overallPercent = getGroupDisplayProgress(allVideos);

  const groupsHtml = videoGroups.map(group => {
    const gDuration = group.videos.reduce((s, v) => s + (v.duration || 0), 0);
    const gPercent = getGroupDisplayProgress(group.videos);
    const isExpanded = group._expanded !== false;

    return `
      <div class="vp-group" data-group-id="${group.id}">
        <div class="vp-group-header" data-action="toggle-group" data-group-id="${group.id}">
          <div class="vp-group-color" style="background:${group.color || '#42a5f5'}"></div>
          <div class="vp-group-info">
            <div class="vp-group-name">${escapeHtml(group.name)}</div>
            <div class="vp-group-meta">${group.videos.length} 个视频 · ${formatDuration(gDuration)}</div>
          </div>
          <div class="vp-group-progress">
            <div class="vp-group-percent">${gPercent}%</div>
            <div class="vp-group-bar">
              <div class="vp-group-fill" style="width:${gPercent}%"></div>
            </div>
          </div>
          <div class="vp-group-toggle">${isExpanded ? '▼' : '▶'}</div>
        </div>
        <div class="vp-group-videos" style="display:${isExpanded ? 'block' : 'none'}">
          ${group.videos.length === 0 ? '<div class="vp-video-empty">暂无视频</div>' :
            group.videos.map(video => {
              const vPercent = getVideoDisplayProgress(video);
              return `
                <div class="vp-video-item" data-url="${escapeHtml(video.url)}" data-action="open-video">
                  <img class="vp-video-favicon" src="${escapeHtml(video.favicon || '')}" loading="lazy" onerror="this.style.display='none'">
                  <div class="vp-video-info">
                    <div class="vp-video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
                    <div class="vp-video-bar">
                      <div class="vp-video-fill" style="width:${vPercent}%"></div>
                    </div>
                    <div class="vp-video-meta">${formatDuration(video.watched || 0)} / ${formatDuration(video.duration)} · ${vPercent}%</div>
                  </div>
                </div>
              `;
            }).join('')}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="vp-stats">
      <div class="vp-stat">
        <div class="vp-stat-value">${videoGroups.length}</div>
        <div class="vp-stat-label">课程</div>
      </div>
      <div class="vp-stat">
        <div class="vp-stat-value">${totalVideos}</div>
        <div class="vp-stat-label">视频</div>
      </div>
      <div class="vp-stat">
        <div class="vp-stat-value">${overallPercent}%</div>
        <div class="vp-stat-label">总进度</div>
      </div>
    </div>
    <div class="vp-overall-bar">
      <div class="vp-overall-fill" style="width:${overallPercent}%"></div>
    </div>
    <div class="vp-groups">${groupsHtml}</div>
  `;
}

/**
 * 绑定视频进度面板事件
 */
export function bindVideoProgressEvents() {
  const container = document.getElementById('videoProgressList');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    const header = e.target.closest('[data-action="toggle-group"]');
    if (header) {
      const groupId = header.dataset.groupId;
      const group = videoGroups.find(g => g.id === groupId);
      if (group) {
        group._expanded = !(group._expanded !== false);
        renderVideoProgress();
      }
      return;
    }

    const videoItem = e.target.closest('[data-action="open-video"]');
    if (videoItem) {
      const url = videoItem.dataset.url;
      if (url) {
        await chrome.tabs.create({ url });
      }
    }
  });

  // 捕获当前视频按钮
  const captureBtn = document.getElementById('popupCaptureVideoBtn');
  if (captureBtn) {
    captureBtn.addEventListener('click', () => captureCurrentVideo());
  }

  // 刷新当前视频
  const refreshBtn = document.getElementById('popupRefreshVideoBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => refreshCurrentVideo());
  }

  // 打开视频进度页面
  const openPageBtn = document.getElementById('popupOpenVideoPageBtn');
  if (openPageBtn) {
    openPageBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openVideoProgressPage' });
    });
  }

  // 进度条设置
  const showBarEl = document.getElementById('popupShowCourseProgressBar');
  const showUnrelatedEl = document.getElementById('popupShowBarOnUnrelatedTabs');
  if (showBarEl) {
    showBarEl.addEventListener('change', async () => {
      const settingsRes = await chrome.runtime.sendMessage({ action: 'getSettings' });
      const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
      settings.showCourseProgressBar = showBarEl.checked;
      await chrome.runtime.sendMessage({ action: 'updateSettings', settings });
    });
  }
  if (showUnrelatedEl) {
    showUnrelatedEl.addEventListener('change', async () => {
      const settingsRes = await chrome.runtime.sendMessage({ action: 'getSettings' });
      const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
      settings.showCourseProgressBarOnUnrelatedTabs = showUnrelatedEl.checked;
      await chrome.runtime.sendMessage({ action: 'updateSettings', settings });
    });
  }
}

/**
 * 捕获当前页面视频（popup 简化版）
 */
async function captureCurrentVideo() {
  const container = document.querySelector('.app');
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab || !activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://') || activeTab.url.startsWith('edge://')) {
      showToast(container, '当前页面不支持视频检测', 'error');
      return;
    }

    let results;
    try {
      results = await chrome.tabs.sendMessage(activeTab.id, { action: 'detectVideos' });
    } catch (err) {
      showToast(container, '页面未加载完成或不存在视频', 'error');
      return;
    }

    if (!results || !results.videos || results.videos.length === 0) {
      showToast(container, '当前页面未检测到视频', 'warning');
      return;
    }

    const videos = results.videos;

    // 获取课程组列表
    const groupsResponse = await chrome.runtime.sendMessage({ action: 'getVideoGroups' });
    const groups = (groupsResponse.success ? (groupsResponse.videoGroups || []) : []).filter(g => !g.archived);

    if (groups.length === 0) {
      const name = await window.modal.prompt('还没有课程组，请输入课程名称创建:', {
        title: '新建课程',
        defaultValue: '新课程',
        placeholder: '课程名称',
        confirmText: '创建并添加'
      });
      if (!name || !name.trim()) return;

      const createRes = await chrome.runtime.sendMessage({ action: 'addVideoGroup', name: name.trim() });
      if (!createRes.success) {
        showToast(container, '创建课程失败', 'error');
        return;
      }
      groups.push(createRes.videoGroup);
    }

    // 选择视频（多个时）
    let selectedVideo = videos[0];
    if (videos.length > 1) {
      const videoOptions = videos.map((v, i) => ({
        value: String(i),
        label: `${v.title || '未命名'} (${formatDuration(v.duration)})`
      }));
      const selected = await window.modal.select('检测到多个视频，请选择:', {
        title: '选择视频',
        options: videoOptions,
        confirmText: '下一步',
        cancelText: '取消'
      });
      if (selected === null) return;
      selectedVideo = videos[parseInt(selected)];
    }

    // 选择课程组
    const groupOptions = groups.map((g, i) => ({
      value: String(i),
      label: `${g.name} (${g.videos.length} 个视频)`
    }));
    const groupSelected = await window.modal.select(
      `视频: ${selectedVideo.title || '未命名视频'}\n选择要添加到的课程:`,
      { title: '添加到课程', options: groupOptions, confirmText: '添加', cancelText: '取消' }
    );
    if (groupSelected === null) return;

    const targetGroup = groups[parseInt(groupSelected)];
    const addRes = await chrome.runtime.sendMessage({
      action: 'addVideoToGroup',
      groupId: targetGroup.id,
      video: {
        title: selectedVideo.title || selectedVideo.pageTitle || '未命名视频',
        url: selectedVideo.url,
        duration: selectedVideo.duration || 0,
        watched: selectedVideo.watched || 0,
        favicon: selectedVideo.favicon || '',
        pageTitle: selectedVideo.pageTitle || ''
      }
    });

    if (addRes.success) {
      showToast(container, `已添加到 "${targetGroup.name}"`, 'success');
      await loadVideoProgress();
    } else if (addRes.error === 'Video already in group') {
      showToast(container, '该视频已在课程中', 'warning');
    } else {
      showToast(container, '添加失败: ' + (addRes.error || ''), 'error');
    }
  } catch (error) {
    showToast(container, '视频检测失败: ' + error.message, 'error');
  }
}

/**
 * 格式化时长
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
