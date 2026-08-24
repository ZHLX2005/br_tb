/**
 * Popup Note Ring Settings Module
 * 控制「笔记圆环」开关（settings.showNoteRing）
 *
 * 这是与「圆环侧边栏（总开关）」平级的独立顶层入口，不受 ringSidebarEnabled 约束。
 * popup 中显示为"笔记圆环（独立注入）"，与其他 ring-sub 缩进项区分。
 */

import { showToast } from './utils.js';

/**
 * 加载笔记圆环开关状态(同步)
 */
export function loadNoteRingSetting(settings) {
  const s = settings || {};
  const toggleEl = document.getElementById('popupShowNoteRing');
  if (toggleEl) {
    // 默认开；undefined 视为开（向后兼容）
    toggleEl.checked = s.showNoteRing !== false;
  }
}

/**
 * 绑定笔记圆环开关事件
 */
export function bindNoteRingEvents(settings) {
  const toggleEl = document.getElementById('popupShowNoteRing');
  if (!toggleEl) return;

  toggleEl.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { showNoteRing: toggleEl.checked }
    });
    if (settings) settings.showNoteRing = toggleEl.checked;

    const container = document.querySelector('.app');
    showToast(
      container,
      toggleEl.checked ? '笔记圆环已开启' : '笔记圆环已关闭',
      'success'
    );
  });
}