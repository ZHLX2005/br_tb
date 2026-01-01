/**
 * Background Service Worker 主入口
 * 负责初始化和启动所有功能模块
 */

import { setupContextMenu } from './contextMenu.js';
import { setupMessageHandler } from './messageHandler.js';
import { setupStorage } from './storage.js';
import { setupOCR } from './ocr.js';

/**
 * 初始化所有模块
 */
function initialize() {
  console.log('[初始化] Background Service Worker 启动中...');

  // 按顺序初始化各个模块
  setupStorage();
  setupContextMenu();
  setupMessageHandler();
  setupOCR();

  console.log('[初始化] 所有模块已启动');
}

// 启动应用
initialize();
