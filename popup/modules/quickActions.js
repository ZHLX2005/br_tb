/**
 * Popup QuickActions Module
 * 快捷操作功能
 */

/**
 * 打开看板
 */
export async function openTabboard() {
  await chrome.runtime.sendMessage({ action: 'openTabboard' });
  window.close();
}

/**
 * 打开侧边栏
 */
export async function openSidebar() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
}

/**
 * 收集并打开看板
 */
export async function collectAndOpen() {
  await chrome.runtime.sendMessage({ action: 'collectAndOpenTabboard' });
  window.close();
}

/**
 * 收集其他标签页（除了当前页面）
 */
export async function collectOtherTabs() {
  await chrome.runtime.sendMessage({ action: 'collectOtherTabs' });
  window.close();
}

/**
 * 绑定快捷操作按钮事件
 * @param {Object} handlers - 事件处理函数映射
 */
export function bindQuickActionsListeners(handlers = {}) {
  const actionMap = {
    'openTabboardBtn': handlers.onOpenTabboard || openTabboard,
    'openSidebarBtn': handlers.onOpenSidebar || openSidebar,
    'collectAndOpenBtn': handlers.onCollectAndOpen || collectAndOpen,
    'collectOtherTabsBtn': handlers.onCollectOtherTabs || collectOtherTabs
  };

  Object.entries(actionMap).forEach(([id, handler]) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', handler);
    }
  });
}
