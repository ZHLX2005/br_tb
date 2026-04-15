/**
 * TabBoard Background Service Worker 主入口
 * 各模块自己管理自己的初始化
 */

import { initializeDefaultData, init as initStorage } from './storage.js';
import { initCommands } from './commands.js';
import { init as initGroups } from './groups.js';
import { init as initFocus } from './focus.js';
import { init as initTimeline } from './timeline.js';
import { init as initRecording } from './recording.js';

// 初始化存储默认数据
initializeDefaultData();

// 初始化各模块
initCommands();
initGroups();
initFocus();
initTimeline();
initRecording();
initStorage();

// 点击扩展图标时打开侧边栏
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    console.log('sidePanel open failed, fallback to tab:', error);
    await chrome.tabs.create({
      url: chrome.runtime.getURL('sidepanel/sidepanel.html'),
      active: true
    });
  }
});

console.log('[TabBoard] Background Service Worker 已启动');
