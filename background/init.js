/**
 * 初始化模块
 */

import { generateId, DEFAULT_COLORS } from './utils.js';

// 初始化默认数据
export async function initializeDefaultData() {
  // 一次性获取所有需要初始化的数据
  const result = await chrome.storage.local.get([
    'groups',
    'tabs',
    'timelineSnapshots',
    'settings',
    'recordings',
    'recordingState'
  ]);

  if (!result.groups) {
    const defaultGroups = [
      { id: generateId(), name: '工作', color: DEFAULT_COLORS[0], isDefault: true },
      { id: generateId(), name: '学习', color: DEFAULT_COLORS[1], isDefault: false },
      { id: generateId(), name: '娱乐', color: DEFAULT_COLORS[2], isDefault: false }
    ];
    await chrome.storage.local.set({ groups: defaultGroups });
  }

  if (!result.tabs) {
    await chrome.storage.local.set({ tabs: {} });
  }

  // Timeline 存储 - 快照列表
  if (!result.timelineSnapshots) {
    await chrome.storage.local.set({ timelineSnapshots: [] });
  }

  if (!result.settings) {
    await chrome.storage.local.set({
      settings: {
        closeAfterCollect: false,
        closeAfterRestore: false,
        excludeEdgeUrls: false,
        lastView: 'timeline',
        visibleGroups: result.groups ? result.groups.map(g => g.id) : [],
        showCourseProgressBar: false
      }
    });
  } else {
    // 为旧设置迁移新字段
    let needUpdate = false;
    const updatedSettings = { ...result.settings };

    if (updatedSettings.showCourseProgressBar === undefined) {
      updatedSettings.showCourseProgressBar = false;
      needUpdate = true;
    }
    if (updatedSettings.lastView === undefined) {
      updatedSettings.lastView = 'timeline';
      needUpdate = true;
    }
    if (!updatedSettings.visibleGroups) {
      updatedSettings.visibleGroups = result.groups ? result.groups.map(g => g.id) : [];
      needUpdate = true;
    }
    if (needUpdate) {
      await chrome.storage.local.set({ settings: updatedSettings });
    }
  }

  // 初始化录制状态（独立存储，与分组分离）
  if (!result.recordingState) {
    await chrome.storage.local.set({
      recordingState: {
        isRecording: false,
        recordingId: null,
        recordingName: '',
        startTime: null,
        tabCount: 0
      }
    });
  }

  // 初始化录制列表存储（独立于 groups 和 tabs）
  if (!result.recordings) {
    await chrome.storage.local.set({ recordings: [] });
  }
}

// 设置相关的消息监听器
export function setupSettingsListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSettings' || request.action === 'updateSettings') {
      (async () => {
        try {
          if (request.action === 'getSettings') {
            const settingsResult = await chrome.storage.local.get(['settings']);
            sendResponse({ success: true, settings: settingsResult.settings || {} });
          } else {
            const currentSettings = await chrome.storage.local.get(['settings']);
            const newSettings = { ...currentSettings.settings, ...request.settings };
            await chrome.storage.local.set({ settings: newSettings });
            sendResponse({ success: true });
          }
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }
    return false;
  });
}
