/**
 * 存储模块
 * 负责数据初始化和设置相关的消息处理
 */

import { generateId, DEFAULT_COLORS } from './utils.js';

// ========== 数据初始化 ==========

export async function initializeDefaultData() {
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
        visibleGroups: result.groups ? result.groups.map(g => g.id) : []
      }
    });
  } else if (result.settings.lastView === undefined) {
    const newSettings = { ...result.settings, lastView: 'timeline' };
    if (!result.settings.visibleGroups) {
      newSettings.visibleGroups = result.groups ? result.groups.map(g => g.id) : [];
    }
    await chrome.storage.local.set({ settings: newSettings });
  }

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

  if (!result.recordings) {
    await chrome.storage.local.set({ recordings: [] });
  }
}

// ========== 设置消息处理 ==========

function setupSettingsListeners() {
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

// ========== 模块初始化 ==========

export function init() {
  setupSettingsListeners();
}
