/**
 * Popup LC Sidebar Settings Module
 * 在 popup 快捷操作页控制 LeetCode 刷题侧边栏开关
 */

import { showToast } from './utils.js';

/**
 * 加载 LC Sidebar 设置状态
 */
export async function loadLcSidebarSetting() {
  try {
    const settingsRes = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
    const toggleEl = document.getElementById('popupShowLcSidebar');
    if (toggleEl) {
      toggleEl.checked = !!settings.showLcSidebar;
    }
  } catch (err) {
    console.error('[Popup] Failed to load LC sidebar setting:', err);
  }
}

/**
 * 绑定 LC Sidebar 开关事件
 */
export function bindLcSidebarEvents() {
  const toggleEl = document.getElementById('popupShowLcSidebar');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    const settingsRes = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
    settings.showLcSidebar = toggleEl.checked;
    await chrome.runtime.sendMessage({ action: 'updateSettings', settings });

    const container = document.querySelector('.app');
    showToast(container, toggleEl.checked ? '刷题侧边栏已开启（仅 LeetCode CN）' : '刷题侧边栏已关闭', 'success');
  });
}
