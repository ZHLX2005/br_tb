/**
 * video-progress-shell.js - 兼容旧 URL (/video-progress.html)
 * 内嵌化后改为 redirect 到 tabboard.html#videoProgress,由 tabboard.js 的 hash 路由接手。
 */

window.location.replace(
  chrome.runtime.getURL('modules/tabboard/tabboard.html#videoProgress')
);
