/**
 * Popup Ring Sidebar Master Switch
 * 总开关：控制 LC、VP 等 ring-sidebar 圆环是否显示
 * 关闭后所有 ring-sidebar 圆环从页面消失（各自 content script 监听 settings.ringSidebarEnabled）
 */

import { showToast } from './utils.js';

/**
 * 加载圆环总开关状态(同步)
 */
export function loadRingSidebarSetting(settings) {
  const s = settings || {};
  const enabled = s.ringSidebarEnabled !== false; // undefined 视为开启（默认开）
  const toggleEl = document.getElementById('popupRingSidebarEnabled');
  if (toggleEl) {
    toggleEl.checked = enabled;
    updateSubToggles(enabled);
  }
}

/**
 * 绑定圆环总开关事件
 */
export function bindRingSidebarEvents(settings) {
  const toggleEl = document.getElementById('popupRingSidebarEnabled');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    const enabled = toggleEl.checked;
    await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { ringSidebarEnabled: enabled }
    });
    if (settings) settings.ringSidebarEnabled = enabled;

    updateSubToggles(enabled);

    const container = document.querySelector('.app');
    showToast(container, enabled ? '圆环侧边栏已开启' : '圆环侧边栏已关闭', 'success');
  });
}

/**
 * 总开关关闭时，子开关（LC、VP）置灰；开启时恢复
 */
function updateSubToggles(enabled) {
  ['popupShowLcSidebar', 'popupShowVpSidebar', 'popupShowCaptureRing', 'popupShowSpeedRing', 'popupShowGotoManagerSidebar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}
