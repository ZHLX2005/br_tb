/**
 * Popup Capture Ring Settings Module
 * 控制「捕获视频圆环」子开关（settings.showCaptureRing）
 * 受 master 总开关 ringSidebarEnabled 约束
 */

import { showToast } from './utils.js';

/**
 * 加载捕获视频圆环开关状态(同步)
 */
export function loadCaptureRingSetting(settings) {
  const s = settings || {};
  const toggleEl = document.getElementById('popupShowCaptureRing');
  if (toggleEl) {
    toggleEl.checked = s.showCaptureRing !== false;
  }
}

/**
 * 绑定捕获视频圆环开关事件
 */
export function bindCaptureRingEvents(settings) {
  const toggleEl = document.getElementById('popupShowCaptureRing');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { showCaptureRing: toggleEl.checked }
    });
    if (settings) settings.showCaptureRing = toggleEl.checked;

    const container = document.querySelector('.app');
    showToast(container, toggleEl.checked ? '捕获视频圆环已开启' : '捕获视频圆环已关闭', 'success');
  });
}