/**
 * TabBoard Background Service Worker 主入口
 * 使用 ES6 模块语法将不同功能解耦到独立模块中
 */

import { initializeDefaultData } from './init.js';
import { initCommands } from './commands.js';
import { initRecording } from './recording.js';
import { handleGroupsMessage } from './groups.js';
import { handleTimelineMessage } from './timeline.js';
import { handleRecordingMessage } from './recording.js';

// 初始化各模块
initializeDefaultData();
initCommands();
initRecording();

console.log('[TabBoard] Background Service Worker 已启动');

// 消息处理（用于 popup 和 tabboard 通信）
// 将消息分发到各个模块处理
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Timeline/快照相关消息
  if ([
    'getTimelineTabs',
    'deleteTimelineSnapshot',
    'restoreSnapshot',
    'importTimelineSnapshots',
    'toggleTabMark',
    'extractMarkedAsGroup',
    'collectOtherTabs',
    'collectAndOpenTabboard'
  ].includes(request.action)) {
    return handleTimelineMessage(request, sender, sendResponse);
  }

  // 分组相关消息
  if ([
    'getGroups',
    'clearAllGroups',
    'importGroupsAndTabs',
    'addTab',
    'moveTab',
    'updateBoardOrder',
    'deleteTab',
    'addGroup',
    'deleteGroup',
    'setDefaultGroup',
    'openTab',
    'openGroup',
    'updateGroupName',
    'openTabboard',
    'incrementVisitCount'
  ].includes(request.action)) {
    return handleGroupsMessage(request, sender, sendResponse);
  }

  // 录制相关消息
  if ([
    'getRecordingState',
    'getRecordings',
    'deleteRecording',
    'renameRecording',
    'openRecording',
    'startRecording',
    'stopRecording',
    'openRecordingPage'
  ].includes(request.action)) {
    return handleRecordingMessage(request, sender, sendResponse);
  }

  // 设置相关消息（简单处理）
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

  // 未知的消息
  console.warn('[TabBoard] Unknown action:', request.action);
  sendResponse({ success: false, error: 'Unknown action' });
  return true;
});
