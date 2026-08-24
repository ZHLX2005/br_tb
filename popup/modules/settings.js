/**
 * Popup Settings Module
 * 设置管理功能
 */

/**
 * 加载设置(同步 — settings 由 popup.js 顶层 cache 后传入)
 * @param {Object} settings - 已从 storage 拿到的 settings 对象
 * @returns {Object} 设置对象(原样返回)
 */
export function loadSettings(settings) {
  const s = settings || {};
  document.getElementById('closeAfterCollect').checked = !!s.closeAfterCollect;
  document.getElementById('closeAfterRestore').checked = !!s.closeAfterRestore;
  document.getElementById('excludeEdgeUrls').checked = !!s.excludeEdgeUrls;

  return s;
}

/**
 * 保存设置
 * @param {Object} settings - 设置对象
 */
export async function saveSettings(settings) {
  await chrome.runtime.sendMessage({ action: 'updateSettings', settings });
}

/**
 * 绑定设置复选框事件
 * @param {string[]} checkboxIds - 复选框ID数组
 */
export function bindSettingsListeners(checkboxIds = ['closeAfterCollect', 'closeAfterRestore', 'excludeEdgeUrls']) {
  checkboxIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', async () => {
        const settings = {
          closeAfterCollect: document.getElementById('closeAfterCollect').checked,
          closeAfterRestore: document.getElementById('closeAfterRestore').checked,
          excludeEdgeUrls: document.getElementById('excludeEdgeUrls').checked
        };
        await saveSettings(settings);
      });
    }
  });
}
