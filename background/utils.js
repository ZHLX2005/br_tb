/**
 * 共享工具函数
 */

// 默认分组颜色
export const DEFAULT_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7',
  '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'
];

// 生成唯一ID
export function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
}

// 获取 URL 基础部分（忽略查询参数和 hash）
export function getUrlBase(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.origin + urlObj.pathname;
  } catch {
    return url;
  }
}

// 显示 toast 消息
export function showToast(tabId, options) {
  chrome.tabs.sendMessage(tabId, {
    action: 'showToast',
    ...options
  }).catch(() => {});
}
