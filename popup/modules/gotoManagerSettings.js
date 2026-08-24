/**
 * Popup Goto Manager Ring Settings(同步 — settings 由 popup.js 顶层 cache 后传入)
 */
import { showToast } from './utils.js';

export function loadGotoManagerSetting(settings) {
  const s = settings || {};
  const toggleEl = document.getElementById('popupShowGotoManagerSidebar');
  if (toggleEl) {
    toggleEl.checked = s.showGotoManagerSidebar !== false;
  }
}

export function bindGotoManagerEvents(settings) {
  const toggleEl = document.getElementById('popupShowGotoManagerSidebar');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    const response = await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { showGotoManagerSidebar: toggleEl.checked }
    });
    if (response?.success) {
      if (settings) settings.showGotoManagerSidebar = toggleEl.checked;
      showToast(document.querySelector('.app'), '已' + (toggleEl.checked ? '显示' : '隐藏') + ' goto 管理圆环', 'success');
    } else {
      // 回滚 UI
      toggleEl.checked = !toggleEl.checked;
      showToast(document.querySelector('.app'), '设置失败: ' + (response?.error || '未知错误'), 'error');
    }
  });
}
