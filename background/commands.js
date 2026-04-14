/**
 * 快捷键命令处理
 */

import { addCurrentTabToDefaultGroup } from './groups.js';
import { collectCurrentWindowTabs, collectOtherTabs, openTabboard } from './timeline.js';

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

    // 动态注入 focus-search.js
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['content/focus-search.js']
    });

    // 发送显示消息
    await chrome.tabs.sendMessage(activeTab.id, { action: 'showFocusSearch' });
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
      case 'collect-other-tabs':
        collectOtherTabs();
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
