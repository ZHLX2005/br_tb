/**
 * sort-videos-shell.js - 兼容旧 URL (/sort-videos.html?groupId=XXX)
 * 内嵌化后改为 redirect 到 tabboard.html#videoProgress&sort=GID,
 * tabboard.js 会自动开 in-app 排序弹窗。
 */

const groupId = new URLSearchParams(window.location.search).get('groupId') || '';
window.location.replace(
  chrome.runtime.getURL(`modules/tabboard/tabboard.html#videoProgress&sort=${encodeURIComponent(groupId)}`)
);
