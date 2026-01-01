/**
 * 消息处理模块
 * 负责处理来自 content script 和 popup 的消息
 */

import { updateContextMenuVisibility } from './contextMenu.js';
import { handleOCRRequest } from './ocr.js';

/**
 * 处理翻译请求
 */
function handleTranslate(request, sendResponse) {
  // 模拟翻译API调用
  const translatedText = request.text + 'x';

  // 发送翻译结果
  sendResponse({
    success: true,
    originalText: request.text,
    translatedText: translatedText
  });
}

/**
 * 处理添加到收藏列表
 */
function handleAddToFavorites(request) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['favorites'], (result) => {
      const favorites = result.favorites || [];

      // 检查是否已存在相同的收藏
      const exists = favorites.some(fav => fav.text === request.text && fav.url === request.url);

      if (!exists) {
        favorites.unshift({
          text: request.text,
          url: request.url,
          timestamp: request.timestamp || new Date().toISOString()
        });

        // 保持收藏列表在200条以内
        if (favorites.length > 200) {
          favorites.pop();
        }

        chrome.storage.local.set({ favorites }, () => {
          console.log('收藏已添加，当前收藏数量:', favorites.length);
          resolve({ success: true });
        });
      } else {
        console.log('收藏已存在，未重复添加');
        resolve({ success: true, message: '已存在' });
      }
    });
  });
}

/**
 * 处理打开收藏列表
 */
function handleOpenFavorites() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('modules/favorites/favorites.html')
  });
  return { success: true };
}

/**
 * 处理更新设置
 */
function handleUpdateSettings() {
  // 更新右键菜单显示状态
  updateContextMenuVisibility();
  return { success: true };
}

/**
 * 初始化消息处理模块
 */
export function setupMessageHandler() {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    let response = null;
    let isAsync = false;

    switch (request.action) {
      case 'updateSettings':
        response = handleUpdateSettings();
        break;

      case 'translate':
        handleTranslate(request, sendResponse);
        break;

      case 'performOCR':
        isAsync = true;
        handleOCRRequest(request).then(sendResponse);
        break;

      case 'addToFavorites':
        isAsync = true;
        handleAddToFavorites(request).then(sendResponse);
        break;

      case 'openFavorites':
        response = handleOpenFavorites();
        break;

      default:
        console.warn('[消息处理] 未知的 action:', request.action);
        response = { success: false, error: '未知 action' };
    }

    // 如果不是异步响应，立即发送响应
    if (!isAsync && response) {
      sendResponse(response);
    }

    // 返回true表示将异步发送响应
    return isAsync;
  });

  console.log('[消息处理] 消息监听器已设置');
}
