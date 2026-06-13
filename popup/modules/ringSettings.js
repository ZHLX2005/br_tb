/**
 * Popup Ring Sidebar Master Switch
 * 总开关：控制 LC、VP 等 ring-sidebar 圆环是否显示
 * 关闭后所有 ring-sidebar 圆环从页面消失（各自 content script 监听 settings.ringSidebarEnabled）
 */

import { showToast } from './utils.js';

/**
 * 加载圆环总开关状态
 */
export async function loadRingSidebarSetting() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = res.success ? (res.settings || {}) : {};
    const enabled = settings.ringSidebarEnabled !== false; // undefined 视为开启（默认开）
    const toggleEl = document.getElementById('popupRingSidebarEnabled');
    if (toggleEl) {
      toggleEl.checked = enabled;
      updateSubToggles(enabled);
    }
  } catch (err) {
    console.error('[Popup] Failed to load ring sidebar setting:', err);
  }
}

/**
 * 绑定圆环总开关事件
 */
export function bindRingSidebarEvents() {
  const toggleEl = document.getElementById('popupRingSidebarEnabled');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    const enabled = toggleEl.checked;
    const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = res.success ? (res.settings || {}) : {};
    settings.ringSidebarEnabled = enabled;
    await chrome.runtime.sendMessage({ action: 'updateSettings', settings });

    updateSubToggles(enabled);

    const container = document.querySelector('.app');
    showToast(container, enabled ? '圆环侧边栏已开启' : '圆环侧边栏已关闭', 'success');
  });
}

/**
 * 总开关关闭时，子开关（LC、VP）置灰；开启时恢复
 */
function updateSubToggles(enabled) {
  ['popupShowLcSidebar', 'popupShowVpSidebar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}
