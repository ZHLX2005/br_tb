/**
 * Popup Capture Ring Settings Module
 * 控制「捕获视频圆环」子开关（settings.showCaptureRing）
 * 受 master 总开关 ringSidebarEnabled 约束
 */

import { showToast } from './utils.js';

/**
 * 加载捕获视频圆环开关状态
 */
export async function loadCaptureRingSetting() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = res.success ? (res.settings || {}) : {};
    const toggleEl = document.getElementById('popupShowCaptureRing');
    if (toggleEl) {
      toggleEl.checked = settings.showCaptureRing !== false;
    }
  } catch (err) {
    console.error('[Popup] Failed to load capture ring setting:', err);
  }
}

/**
 * 绑定捕获视频圆环开关事件
 */
export function bindCaptureRingEvents() {
  const toggleEl = document.getElementById('popupShowCaptureRing');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = res.success ? (res.settings || {}) : {};
    settings.showCaptureRing = toggleEl.checked;
    await chrome.runtime.sendMessage({ action: 'updateSettings', settings });

    const container = document.querySelector('.app');
    showToast(container, toggleEl.checked ? '捕获视频圆环已开启' : '捕获视频圆环已关闭', 'success');
  });
}