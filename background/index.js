/**
 * TabBoard Background Service Worker 主入口
 * 使用 ES6 模块语法将不同功能解耦到独立模块中
 */

import { initializeDefaultData, setupSettingsListeners } from './init.js';
import { initCommands } from './commands.js';
import { initRecording } from './recording.js';
import { setupGroupsListeners } from './groups.js';
import { setupTimelineListeners } from './timeline.js';
import { setupRecordingListeners } from './recording.js';
import { setupFocusListeners } from './focus.js';
import { setupVideoProgressListeners } from './videoProgress.js';
import { setupGotoListeners } from './goto.js';
import { setupBiliHistoryListeners } from './bilibili-history.js';
import { setupNotesListeners, initNoteTabBroadcast } from './notes.js';

// 初始化各模块
initializeDefaultData();
initCommands();
initRecording();

// 设置各模块的消息监听器
setupSettingsListeners();
setupGroupsListeners();
setupTimelineListeners();
setupRecordingListeners();
setupFocusListeners();
setupVideoProgressListeners();
setupGotoListeners();
setupBiliHistoryListeners();
setupNotesListeners();
initNoteTabBroadcast();

console.log('[TabBoard] Background Service Worker 已启动');
