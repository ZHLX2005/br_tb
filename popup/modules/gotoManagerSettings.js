/**
 * Popup Goto Manager Ring Settings
 * goto 管理圆环的 popup 开关控制(走 updateSettings action 合并语义)
 */
import { showToast } from './utils.js';

export async function loadGotoManagerSetting() {
  try {
    const settingsRes = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
    const toggleEl = document.getElementById('popupShowGotoManagerSidebar');
    if (toggleEl) {
      toggleEl.checked = settings.showGotoManagerSidebar !== false;
    }
  } catch (err) {
    console.error('[Popup] Failed to load goto manager setting:', err);
  }
}

export function bindGotoManagerEvents() {
  const toggleEl = document.getElementById('popupShowGotoManagerSidebar');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    const settingsRes = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsRes.success ? (settingsRes.settings || {}) : {};
    settings.showGotoManagerSidebar = toggleEl.checked;
    const response = await chrome.runtime.sendMessage({ action: 'updateSettings', settings });
    if (response?.success) {
      showToast(document.querySelector('.app'), '已' + (toggleEl.checked ? '显示' : '隐藏') + ' goto 管理圆环', 'success');
    } else {
      // 回滚 UI
      toggleEl.checked = !toggleEl.checked;
      showToast(document.querySelector('.app'), '设置失败: ' + (response?.error || '未知错误'), 'error');
    }
  });
}
