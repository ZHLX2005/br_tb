/**
 * archive-shell.js - 兼容旧 URL (/archive.html)
 * 内嵌化后改为 redirect 到 tabboard.html#videoProgress&archive=1,让 tabboard 切到归档模式。
 */

window.location.replace(
  chrome.runtime.getURL('modules/tabboard/tabboard.html#videoProgress&archive=1')
);
