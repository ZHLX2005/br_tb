/**
 * 初始化模块
 */

import { ensureGroupDefaults } from './group-model.js';

// 初始化默认数据
export async function initializeDefaultData() {
  // group 域(groups/tabs 默认数据 + goto 面包 seed + 标记迁移)统一由 group-model 负责
  await ensureGroupDefaults();

  // 一次性获取其余需要初始化的数据
  const result = await chrome.storage.local.get([
    'timelineSnapshots',
    'settings',
    'recordings',
    'recordingState',
    'notePages'
  ]);

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
        showCourseProgressBar: false,
        showCourseProgressBarOnUnrelatedTabs: false,
        showGotoRing: false,
        ringSidebarEnabled: true,
        showVpSidebar: true,
        theme: 'neo-brutalism'
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
    if (updatedSettings.showCourseProgressBarOnUnrelatedTabs === undefined) {
      updatedSettings.showCourseProgressBarOnUnrelatedTabs = false;
      needUpdate = true;
    }
    if (updatedSettings.showLcSidebar === undefined) {
      updatedSettings.showLcSidebar = true;
      needUpdate = true;
    }
    if (updatedSettings.showGotoRing === undefined) {
      updatedSettings.showGotoRing = false;
      needUpdate = true;
    }
    if (updatedSettings.ringSidebarEnabled === undefined) {
      updatedSettings.ringSidebarEnabled = true;
      needUpdate = true;
    }
    if (updatedSettings.showVpSidebar === undefined) {
      updatedSettings.showVpSidebar = true;
      needUpdate = true;
    }
    if (updatedSettings.showCaptureRing === undefined) {
      updatedSettings.showCaptureRing = true;
      needUpdate = true;
    }
    if (updatedSettings.showSpeedRing === undefined) {
      updatedSettings.showSpeedRing = true;
      needUpdate = true;
    }
    if (updatedSettings.showNoteRing === undefined) {
      updatedSettings.showNoteRing = true;
      needUpdate = true;
    }
    if (updatedSettings.showGotoManagerSidebar === undefined) {
      updatedSettings.showGotoManagerSidebar = true;
      needUpdate = true;
    }
    if (updatedSettings.lastView === undefined) {
      updatedSettings.lastView = 'timeline';
      needUpdate = true;
    }
    if (updatedSettings.theme === undefined) {
      updatedSettings.theme = 'neo-brutalism';
      needUpdate = true;
    }
    // 注:visibleGroups / focusSearchGroups 已迁移为 group.visible / group.inFocusSearch
    // (由 group-model.ensureGroupDefaults 负责),settings 不再持有这两个 key
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

  // 初始化 LeetCode 150 进度
  const lcResult = await chrome.storage.local.get(['leetcodeProgress']);
  if (!lcResult.leetcodeProgress) {
    await chrome.storage.local.set({ leetcodeProgress: {} });
  }

  // 初始化便签页存储
  if (!result.notePages) {
    await chrome.storage.local.set({ notePages: [] });
  }

  // 初始化便签全局默认 page id(用户在面板里选的 page,跨 tab 共享)
  if (!('noteCurrentPageId' in result)) {
    await chrome.storage.local.set({ noteCurrentPageId: null });
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
