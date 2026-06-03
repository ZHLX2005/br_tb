/**
 * Popup Goto Ring Settings Module
 * 在 popup 快捷操作页控制悬浮 goto 圆环开关
 */

import { showToast } from './utils.js';

/**
 * 加载 Goto Ring 设置状态
 */
export async function loadGotoRingSetting() {
  try {
    const settingsRes = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
    const toggleEl = document.getElementById('popupShowGotoRing');
    if (toggleEl) {
      toggleEl.checked = !!settings.showGotoRing;
    }
  } catch (err) {
    console.error('[Popup] Failed to load goto ring setting:', err);
  }
}

/**
 * 绑定 Goto Ring 开关事件
 */
export function bindGotoRingEvents() {
  const toggleEl = document.getElementById('popupShowGotoRing');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    const settingsRes = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
    settings.showGotoRing = toggleEl.checked;
    await chrome.runtime.sendMessage({ action: 'updateSettings', settings });

    const container = document.querySelector('.app');
    showToast(
      container,
      toggleEl.checked ? 'goto 圆环已开启' : 'goto 圆环已关闭',
      'success'
    );
  });
}
