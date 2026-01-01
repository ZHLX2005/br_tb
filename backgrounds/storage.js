/**
 * 存储管理模块
 * 负责初始化和管理 chrome.storage
 */

import { updateContextMenuVisibility } from './contextMenu.js';

/**
 * 初始化收藏列表存储
 */
function initFavoritesStorage() {
  chrome.storage.local.get(['favorites'], (result) => {
    if (!result.favorites) {
      chrome.storage.local.set({
        favorites: []
      });
      console.log('[存储] 收藏列表已初始化');
    }
  });
}

/**
 * 监听 storage 变化
 */
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) {
      console.log('[存储] 检测到设置变化，更新右键菜单');
      updateContextMenuVisibility();
    }
  });

  console.log('[存储] Storage 监听器已设置');
}

/**
 * 初始化存储模块
 */
export function setupStorage() {
  initFavoritesStorage();
  setupStorageListener();
}
