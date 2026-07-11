/**
 * Popup Speed Ring Settings Module
 * Controls the "speed ring" sub-switch (settings.showSpeedRing)
 * Constrained by master switch ringSidebarEnabled
 */

import { showToast } from './utils.js';

/**
 * Load the speed ring switch state
 */
export async function loadSpeedRingSetting() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = res.success ? (res.settings || {}) : {};
    const toggleEl = document.getElementById('popupShowSpeedRing');
    if (toggleEl) {
      toggleEl.checked = settings.showSpeedRing !== false;
    }
  } catch (err) {
    console.error('[Popup] Failed to load speed ring setting:', err);
  }
}

/**
 * Bind speed ring switch events
 */
export function bindSpeedRingEvents() {
  const toggleEl = document.getElementById('popupShowSpeedRing');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = res.success ? (res.settings || {}) : {};
    settings.showSpeedRing = toggleEl.checked;
    await chrome.runtime.sendMessage({ action: 'updateSettings', settings });

    const container = document.querySelector('.app');
    showToast(container, toggleEl.checked ? '倍速控制圆环已开启' : '倍速控制圆环已关闭', 'success');
  });
}
