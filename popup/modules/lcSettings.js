/**
 * Popup LC Sidebar Settings Module
 * 在 popup 快捷操作页控制 LeetCode 刷题侧边栏开关
 */

import { showToast } from './utils.js';

/**
 * 加载 LC Sidebar 设置状态(同步,settings 由 popup.js 顶层一次 cache 后传入)
 */
export function loadLcSidebarSetting(settings) {
  const s = settings || {};
  const toggleEl = document.getElementById('popupShowLcSidebar');
  if (toggleEl) {
    toggleEl.checked = !!s.showLcSidebar;
  }
}

/**
 * 绑定 LC Sidebar 开关事件
 */
export function bindLcSidebarEvents(settings) {
  const toggleEl = document.getElementById('popupShowLcSidebar');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    // 直接发局部 patch,后台 updateSettings 合并语义不会丢其他 key
    await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { showLcSidebar: toggleEl.checked }
    });
    if (settings) settings.showLcSidebar = toggleEl.checked;

    const container = document.querySelector('.app');
    showToast(container, toggleEl.checked ? '刷题侧边栏已开启（仅 LeetCode CN）' : '刷题侧边栏已关闭', 'success');
  });
}
