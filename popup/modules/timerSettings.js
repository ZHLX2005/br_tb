/**
 * Popup Timer Sidebar Settings Module
 * 控制「计时圆环」子开关（settings.showTimerSidebar）
 * 受 master 总开关 ringSidebarEnabled 约束
 */

import { showToast } from './utils.js';

/**
 * 加载计时圆环开关状态
 */
export async function loadTimerSidebarSetting() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = res.success ? (res.settings || {}) : {};
    const toggleEl = document.getElementById('popupShowTimerSidebar');
    if (toggleEl) {
      toggleEl.checked = settings.showTimerSidebar !== false;
    }
  } catch (err) {
    console.error('[Popup] Failed to load timer sidebar setting:', err);
  }
}

/**
 * 绑定计时圆环开关事件
 */
export function bindTimerSidebarEvents() {
  const toggleEl = document.getElementById('popupShowTimerSidebar');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = res.success ? (res.settings || {}) : {};
    settings.showTimerSidebar = toggleEl.checked;
    await chrome.runtime.sendMessage({ action: 'updateSettings', settings });

    const container = document.querySelector('.app');
    showToast(container, toggleEl.checked ? '计时圆环已开启' : '计时圆环已关闭', 'success');
  });
}
