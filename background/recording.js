/**
 * Tab录制模块
 * 处理标签录制、停止、重命名等功能
 */

import { generateId } from './utils.js';

// 用于跟踪已记录的标签页 ID，避免重复记录
const recordedTabsInSession = new Set();

// 初始化录制模块 - 监听标签页更新和关闭事件
export function initRecording() {
  // 监听标签页更新事件（用于录制模式）
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // 只在页面加载完成时处理
    if (changeInfo.status !== 'complete') {
      return;
    }

    // 检查是否已经记录过这个标签页（避免重复）
    if (recordedTabsInSession.has(tabId)) {
      return;
    }

    // 获取录制状态 - 使用 'in' 检查避免空对象被 falsy 判断导致数据丢失
    const result = await chrome.storage.local.get(['recordingState']);
    const recordingState = ('recordingState' in result) ? result.recordingState : null;

    // 如果不在录制模式或状态无效，直接返回
    if (!recordingState || !recordingState.isRecording || !recordingState.recordingId) {
      return;
    }

    // 跳过特殊页面
    if (!tab.url ||
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url === 'about:blank' ||
        tab.url.startsWith('about:')) {
      return;
    }

    // 检查标签页是否有效
    if (!tab.url || !tab.title) {
      return;
    }

    // 添加到录制列表（独立存储）
    // 使用 'in' 检查避免空数组被 falsy 判断导致数据丢失
    const recordingsResult = await chrome.storage.local.get(['recordings']);

    // 只在 key 存在时才获取数据，避免覆盖
    const recordings = ('recordings' in recordingsResult) ? recordingsResult.recordings : [];

    const currentRecording = recordings.find(r => r.id === recordingState.recordingId);

    if (currentRecording) {
      // 检查是否已存在
      const exists = currentRecording.tabs.some(t => t.url === tab.url);
      if (!exists) {
        currentRecording.tabs.unshift({
          id: generateId(),
          title: tab.title,
          url: tab.url,
          favicon: tab.favIconUrl || '',
          timestamp: new Date().toISOString()
        });

        // 限制每个录制最多 100 个标签
        if (currentRecording.tabs.length > 100) {
          currentRecording.tabs = currentRecording.tabs.slice(0, 100);
        }

        // 更新录制状态中的标签计数
        recordingState.tabCount = (recordingState.tabCount || 0) + 1;

        // 批量更新存储，避免多次操作导致数据冲突
        await chrome.storage.local.set({
          recordings,
          recordingState
        });

        // 标记为已记录，防止重复
        recordedTabsInSession.add(tabId);

        console.log('[TabBoard] 录制模式下自动捕获标签页:', tab.title, tab.url);
      }
    }
  });

  // 监听标签页关闭事件，清理记录
  chrome.tabs.onRemoved.addListener((tabId) => {
    recordedTabsInSession.delete(tabId);
  });
}

// 打开录制页面
async function openRecordingPage() {
  // 检查是否已经打开了录制页面
  const tabs = await chrome.tabs.query({});
  const existingRecTab = tabs.find(tab => tab.url?.includes('modules/recording/recording.html'));

  if (existingRecTab) {
    await chrome.tabs.update(existingRecTab.id, { active: true });
  } else {
    await chrome.tabs.create({
      url: chrome.runtime.getURL('modules/recording/recording.html')
    });
  }
}

// 导出函数供外部使用
export {
  openRecordingPage,
  setupRecordingListeners
};

// 设置录制相关的消息监听器
function setupRecordingListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getRecordingState': {
          // 使用 'in' 检查避免空对象被 falsy 判断导致数据丢失
          const recordingStateResult = await chrome.storage.local.get(['recordingState']);
          const recordingState = ('recordingState' in recordingStateResult) ? recordingStateResult.recordingState : { isRecording: false };
          sendResponse({ success: true, recordingState });
          break;
        }

        case 'getRecordings': {
          // 使用 'in' 检查避免空数组被 falsy 判断导致数据丢失
          const recordingsResult = await chrome.storage.local.get(['recordings']);
          const recordings = ('recordings' in recordingsResult) ? recordingsResult.recordings : [];
          sendResponse({ success: true, recordings });
          break;
        }

        case 'deleteRecording': {
          // 使用 'in' 检查避免空数组被 falsy 判断导致数据丢失
          const delRecResult = await chrome.storage.local.get(['recordings']);
          const recordings = ('recordings' in delRecResult) ? delRecResult.recordings : [];
          const newRecordings = recordings.filter(r => r.id !== request.recordingId);
          await chrome.storage.local.set({ recordings: newRecordings });
          sendResponse({ success: true });
          break;
        }

        case 'renameRecording': {
          // 使用 'in' 检查避免空数组被 falsy 判断导致数据丢失
          const renameRecResult = await chrome.storage.local.get(['recordings', 'recordingState']);
          const recordings = ('recordings' in renameRecResult) ? renameRecResult.recordings : [];
          const recording = recordings.find(r => r.id === request.recordingId);
          if (recording) {
            recording.name = request.newName;
            await chrome.storage.local.set({ recordings });
            // 如果是正在录制的项目，同时更新录制状态中的名称
            const recordingState = ('recordingState' in renameRecResult) ? renameRecResult.recordingState : {};
            if (recordingState.isRecording && recordingState.recordingId === request.recordingId) {
              recordingState.recordingName = request.newName;
              await chrome.storage.local.set({ recordingState });
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Recording not found' });
          }
          break;
        }

        case 'openRecording': {
          // 使用 'in' 检查避免空数组被 falsy 判断导致数据丢失
          const openRecResult = await chrome.storage.local.get(['recordings']);
          const allRecordings = ('recordings' in openRecResult) ? openRecResult.recordings : [];
          const targetRecording = allRecordings.find(r => r.id === request.recordingId);
          if (targetRecording) {
            for (const tab of targetRecording.tabs) {
              await chrome.tabs.create({ url: tab.url });
            }
          }
          sendResponse({ success: true });
          break;
        }

        case 'startRecording': {
          const recName = request.groupName || `录制 ${new Date().toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
          const recId = generateId();

          const newRecording = {
            id: recId,
            name: recName,
            startTime: new Date().toISOString(),
            endTime: null,
            tabs: []
          };

          // 使用 'in' 检查避免空数组被 falsy 判断导致数据丢失
          const getRecsResult = await chrome.storage.local.get(['recordings']);
          const existingRecordings = ('recordings' in getRecsResult) ? getRecsResult.recordings : [];
          existingRecordings.unshift(newRecording);

          const newRecordingState = {
            isRecording: true,
            recordingId: recId,
            recordingName: recName,
            startTime: new Date().toISOString(),
            tabCount: 0
          };

          await chrome.storage.local.set({
            recordings: existingRecordings,
            recordingState: newRecordingState
          });

          // 更新徽章显示
          chrome.action.setBadgeText({ text: 'REC' });
          chrome.action.setBadgeBackgroundColor({ color: '#ef5350' });

          sendResponse({ success: true, recordingState: newRecordingState });
          break;
        }

        case 'stopRecording': {
          // 使用 'in' 检查避免空数组被 falsy 判断导致数据丢失
          const stopRecResult = await chrome.storage.local.get(['recordingState', 'recordings']);
          const currentRecordingState = ('recordingState' in stopRecResult) ? stopRecResult.recordingState : {};
          const tabCount = currentRecordingState.tabCount || 0;
          const recordingId = currentRecordingState.recordingId;
          const allRecordings = ('recordings' in stopRecResult) ? stopRecResult.recordings : [];

          // 更新录制结束时间
          if (recordingId) {
            const recording = allRecordings.find(r => r.id === recordingId);
            if (recording) {
              recording.endTime = new Date().toISOString();
            }
          }

          const stoppedRecordingState = {
            isRecording: false,
            recordingId: null,
            recordingName: '',
            startTime: null,
            tabCount: 0
          };

          // 批量更新存储，避免多次操作导致数据冲突
          await chrome.storage.local.set({
            recordings: allRecordings,
            recordingState: stoppedRecordingState
          });

          // 清除徽章
          chrome.action.setBadgeText({ text: '' });

          sendResponse({ success: true, recordingState: stoppedRecordingState, tabCount });
          break;
        }

        case 'openRecordingPage': {
          await openRecordingPage();
          sendResponse({ success: true });
          break;
        }

        default:
          return false; // 未处理的消息
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // 异步响应
  });
}
