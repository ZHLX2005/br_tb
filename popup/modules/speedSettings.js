/**
 * Popup Speed Ring Settings Module
 * Controls the "speed ring" sub-switch (settings.showSpeedRing)
 * Constrained by master switch ringSidebarEnabled
 */

import { showToast } from './utils.js';

/**
 * Load the speed ring switch state (同步)
 */
export function loadSpeedRingSetting(settings) {
  const s = settings || {};
  const toggleEl = document.getElementById('popupShowSpeedRing');
  if (toggleEl) {
    toggleEl.checked = s.showSpeedRing !== false;
  }
}

/**
 * Bind speed ring switch events
 */
export function bindSpeedRingEvents(settings) {
  const toggleEl = document.getElementById('popupShowSpeedRing');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { showSpeedRing: toggleEl.checked }
    });
    if (settings) settings.showSpeedRing = toggleEl.checked;

    const container = document.querySelector('.app');
    showToast(container, toggleEl.checked ? '倍速控制圆环已开启' : '倍速控制圆环已关闭', 'success');
  });
}
