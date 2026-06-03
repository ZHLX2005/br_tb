/**
 * Goto 模块 - 处理 goto 圆环相关消息
 * 提供 openUrl 消息：复用同域 path 前缀的标签页，否则新开
 */

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
    return false;
  });
}

export { setupGotoListeners };
