/**
 * Popup Goto Ring Settings Module
 * 在 popup 快捷操作页控制悬浮 goto 圆环开关
 */

import { showToast } from './utils.js';

/**
 * 加载 Goto Ring 设置状态(同步)
 */
export function loadGotoRingSetting(settings) {
  const s = settings || {};
  const toggleEl = document.getElementById('popupShowGotoRing');
  if (toggleEl) {
    toggleEl.checked = !!s.showGotoRing;
  }
}

/**
 * 绑定 Goto Ring 开关事件
 */
export function bindGotoRingEvents(settings) {
  const toggleEl = document.getElementById('popupShowGotoRing');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { showGotoRing: toggleEl.checked }
    });
    if (settings) settings.showGotoRing = toggleEl.checked;

    const container = document.querySelector('.app');
    showToast(
      container,
      toggleEl.checked ? 'goto 圆环已开启' : 'goto 圆环已关闭',
      'success'
    );
  });
}
