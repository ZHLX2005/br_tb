/**
 * Popup VP Sidebar Settings Module
 * 控制「视频进度圆环」子开关（settings.showVpSidebar）
 * 受 master 总开关 ringSidebarEnabled 约束（master 关时本 checkbox 被 ringSettings 置灰）
 */

import { showToast } from './utils.js';

/**
 * 加载 VP 圆环开关状态(同步)
 */
export function loadVpSidebarSetting(settings) {
  const s = settings || {};
  const toggleEl = document.getElementById('popupShowVpSidebar');
  if (toggleEl) {
    toggleEl.checked = s.showVpSidebar !== false; // undefined 视为开启（默认开）
  }
}

/**
 * 绑定 VP 圆环开关事件
 */
export function bindVpSidebarEvents(settings) {
  const toggleEl = document.getElementById('popupShowVpSidebar');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { showVpSidebar: toggleEl.checked }
    });
    if (settings) settings.showVpSidebar = toggleEl.checked;

    const container = document.querySelector('.app');
    showToast(container, toggleEl.checked ? '视频进度圆环已开启' : '视频进度圆环已关闭', 'success');
  });
}
