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

// 规范化 URL：B站视频页保留 BV 和分P(p=x)，去掉追踪参数与 hash，非B站保持原样
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('bilibili.com') && u.pathname.startsWith('/video/')) {
      let path = u.pathname;
      if (path.endsWith('/')) path = path.slice(0, -1);
      const p = u.searchParams.get('p');
      if (p) {
        return `${u.protocol}//${u.hostname}${path}?p=${p}`;
      }
      return `${u.protocol}//${u.hostname}${path}`;
    }
    return url;
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
