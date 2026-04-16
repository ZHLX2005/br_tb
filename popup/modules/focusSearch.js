/**
 * Popup FocusSearch Module
 * 专注搜索分组功能
 */

import { escapeHtml } from './utils.js';

/**
 * 加载专注搜索分组
 * @param {Function} options.onRemove - 移除分组回调
 */
export async function loadFocusSearchGroups({ onRemove } = {}) {
  const groupsResponse = await chrome.runtime.sendMessage({ action: 'getGroups' });
  if (!groupsResponse.success) return;

  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse.settings || {};
  const enabledGroupIds = settings.focusSearchGroups || [];

  const tabsResponse = await chrome.runtime.sendMessage({ action: 'getAllData' });
  const tabs = tabsResponse.tabs || {};

  const container = document.getElementById('focusSearchGroupsList');

  // 只显示已在 focusSearchGroups 中勾选的分组
  const enabledGroups = groupsResponse.groups.filter(group => {
    return enabledGroupIds.includes(group.id);
  });

  if (enabledGroups.length === 0) {
    container.innerHTML = '<div class="empty-state">暂未选择任何分组<br><small>请到分组管理中添加</small></div>';
    return;
  }

  container.innerHTML = enabledGroups.map(group => {
    const tabCount = tabs[group.id] ? tabs[group.id].length : 0;
    return `<div class="focus-group-item">
      <span class="focus-color-dot" style="background:${group.color}"></span>
      <span class="focus-group-name">${escapeHtml(group.name)}</span>
      <span class="focus-group-count">${tabCount}个</span>
      <button class="focus-group-remove" data-id="${group.id}">×</button>
    </div>`;
  }).join('');

  // 移除按钮事件
  if (onRemove) {
    container.querySelectorAll('.focus-group-remove').forEach(btn => {
      btn.addEventListener('click', () => onRemove(btn.dataset.id, enabledGroupIds));
    });
  }
}

/**
 * 从专注搜索中移除分组
 * @param {string} groupId - 分组ID
 * @param {string[]} currentGroupIds - 当前的分组ID列表
 */
export async function removeFromFocusSearch(groupId, currentGroupIds) {
  const newEnabled = currentGroupIds.filter(id => id !== groupId);
  await chrome.runtime.sendMessage({
    action: 'updateSettings',
    settings: { focusSearchGroups: newEnabled }
  });
}

/**
 * 保存专注搜索分组选择
 * @param {string[]} enabledGroupIds - 启用的分组ID列表
 */
export async function saveFocusSearchGroups(enabledGroupIds) {
  await chrome.runtime.sendMessage({
    action: 'updateSettings',
    settings: { focusSearchGroups: enabledGroupIds }
  });
}
