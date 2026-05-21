/**
 * Popup Settings Module
 * 设置管理功能
 */

/**
 * 加载设置
 * @returns {Promise<Object>} 设置对象
 */
export async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
  if (!response.success) return {};

  const settings = response.settings;
  document.getElementById('closeAfterCollect').checked = settings.closeAfterCollect || false;
  document.getElementById('closeAfterRestore').checked = settings.closeAfterRestore || false;
  document.getElementById('excludeEdgeUrls').checked = settings.excludeEdgeUrls || false;
  document.getElementById('showCourseProgressBar').checked = settings.showCourseProgressBar || false;

  return settings;
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
export function bindSettingsListeners(checkboxIds = ['closeAfterCollect', 'closeAfterRestore', 'excludeEdgeUrls', 'showCourseProgressBar']) {
  checkboxIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', async () => {
        const settings = {
          closeAfterCollect: document.getElementById('closeAfterCollect').checked,
          closeAfterRestore: document.getElementById('closeAfterRestore').checked,
          excludeEdgeUrls: document.getElementById('excludeEdgeUrls').checked,
          showCourseProgressBar: document.getElementById('showCourseProgressBar').checked
        };
        await saveSettings(settings);
      });
    }
  });
}
