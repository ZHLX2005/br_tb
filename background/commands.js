/**
 * 快捷键命令处理
 */

import { addCurrentTabToDefaultGroup } from './groups.js';
import { collectCurrentWindowTabs, openTabboard } from './timeline.js';
// 快捷键命令驱动进行注入
async function triggerFocusSearch() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) return;

    // 检查是否为特殊页面
    const specialProtocols = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];
    if (activeTab.url && specialProtocols.some(p => activeTab.url.startsWith(p))) {
      console.log('[FocusSearch] Cannot inject into special page:', activeTab.url);
      return;
    }

    // 检查是否已注入（通过页面变量检测）
    const alreadyInjected = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => window.__focusSearchReady === true
    }).then(results => results?.[0] === true).catch(() => false);

    if (!alreadyInjected) {
      // 动态注入 CSS 和 JS
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['content/focus-search.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: activeTab.id },
        files: ['content/focus-search.css']
      });
    }

    // 发送显示消息 - defer to allow content script to register listener
    setTimeout(() => {
      chrome.tabs.sendMessage(activeTab.id, { action: 'showFocusSearch' }).catch(() => {
        // Silently ignore if tab was closed or navigation happened
      });
    }, 0);
  } catch (e) {
    console.error('[FocusSearch] Failed to trigger:', e);
  }
}

// 快捷键命令处理
export { initCommands, triggerFocusSearch };

function initCommands() {
  chrome.commands.onCommand.addListener(async (command) => {
    switch (command) {
      case 'add-current-tab':
        addCurrentTabToDefaultGroup();
        break;
      case 'collect-all-tabs':
        collectCurrentWindowTabs();
        break;
      case 'open-tabboard':
        openTabboard();
        break;
      case 'focus-search':
        await triggerFocusSearch();
        break;
      default:
        console.warn('Unknown command:', command);
    }
  });
}
