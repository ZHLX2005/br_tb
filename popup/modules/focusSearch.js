/**
 * Popup FocusSearch Module
 * 专注搜索分组功能 - 全量分组+勾选模式
 */

import { escapeHtml } from './utils.js';

/**
 * 加载全量分组及勾选状态
 * @param {Object} options
 * @param {Function} options.onToggle - 勾选切换回调 (groupId, enabled)
 */
export async function loadFocusSearchGroups({ onToggle } = {}) {
  const groupsResponse = await chrome.runtime.sendMessage({ action: 'getGroups' });
  if (!groupsResponse.success) return;

  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse.settings || {};
  const enabledGroupIds = settings.focusSearchGroups || [];

  const tabsResponse = await chrome.runtime.sendMessage({ action: 'getAllData' });
  const tabs = tabsResponse.tabs || {};

  const container = document.getElementById('focusSearchGroupsList');

  // 全量分组
  const allGroups = groupsResponse.groups;

  if (allGroups.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无可用分组<br><small>请先在分组管理中创建</small></div>';
    return;
  }

  container.innerHTML = allGroups.map(group => {
    const isEnabled = enabledGroupIds.includes(group.id);
    const tabCount = tabs[group.id] ? tabs[group.id].length : 0;
    return `<div class="focus-group-item ${isEnabled ? 'enabled' : ''}">
      <label class="focus-group-checkbox-wrapper">
        <input type="checkbox" class="focus-group-checkbox"
               data-id="${group.id}"
               ${isEnabled ? 'checked' : ''}>
        <span class="focus-color-dot" style="background:${group.color}"></span>
        <span class="focus-group-name">${escapeHtml(group.name)}</span>
        <span class="focus-group-count">${tabCount}个</span>
      </label>
    </div>`;
  }).join('');

  // 绑定勾选事件
  if (onToggle) {
    container.querySelectorAll('.focus-group-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        onToggle(e.target.dataset.id, e.target.checked);
      });
    });
  }
}

/**
 * 切换分组的专注搜索状态
 * @param {string} groupId - 分组ID
 * @param {boolean} enabled - 是否启用
 */
export async function toggleFocusSearchGroup(groupId, enabled) {
  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse.settings || {};
  let focusSearchGroups = settings.focusSearchGroups || [];

  if (enabled) {
    if (!focusSearchGroups.includes(groupId)) {
      focusSearchGroups.push(groupId);
    }
  } else {
    focusSearchGroups = focusSearchGroups.filter(id => id !== groupId);
  }

  await chrome.runtime.sendMessage({
    action: 'updateSettings',
    settings: { focusSearchGroups }
  });
}

/**
 * 移除分组（从专注搜索中）
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
