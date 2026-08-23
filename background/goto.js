/**
 * Goto 模块 - 处理 goto 圆环相关消息
 *
 * 数据来源：圆环的内容由 groups 中 goto=true 的 group 决定。
 * group/view 的 Goto 按钮调用 background/groups.js 的 setGroupAsGoto 切换 goto 状态。
 * 本模块负责 openUrl 消息处理(open 复用同域 path 前缀的标签页),
 * 以及 getGotoMenuData(数据统一从 group-model 取,content script 不再直读存储)。
 */

import { getGotoMenuData, getGotoGroupsFull } from './group-model.js';

async function handleOpenUrl(targetUrl) {
  let targetDomain = '';
  let targetPath = '';
  try {
    const urlObj = new URL(targetUrl);
    targetDomain = urlObj.hostname;
    targetPath = urlObj.pathname;
  } catch (e) {
    console.error('[Goto] Invalid URL:', targetUrl, e);
    return { status: 'error', message: 'Invalid URL' };
  }

  const tabs = await chrome.tabs.query({});
  let existingTab = null;
  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith('chrome://')) continue;
    try {
      const tabUrlObj = new URL(tab.url);
      if (tabUrlObj.hostname === targetDomain && tabUrlObj.pathname.startsWith(targetPath)) {
        existingTab = tab;
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { active: true });
    await chrome.windows.update(existingTab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: targetUrl });
  }
  return { status: 'ok' };
}

function setupGotoListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openUrl') {
      handleOpenUrl(request.url).then(sendResponse);
      return true;
    }
    if (request.action === 'getGotoMenuData') {
      getGotoMenuData()
        .then(menu => sendResponse({ success: true, menu }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (request.action === 'getGotoGroupsFull') {
      getGotoGroupsFull()
        .then(menu => sendResponse({ success: true, menu }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    return false;
  });
}

export { setupGotoListeners };
