/**
 * Popup Groups Module
 * 分组管理功能
 */

import { escapeHtml } from './utils.js';

const DEFAULT_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7',
  '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'
];

let selectedColor = DEFAULT_COLORS[0];

/**
 * 加载分组列表
 * @param {Object} options - 配置选项
 * @param {Function} options.onDelete - 删除分组回调
 * @param {Function} options.onSetDefault - 设置默认分组回调
 * @param {Function} options.onAddToFocus - 添加到专注搜索回调
 */
export async function loadGroups({ onDelete, onSetDefault, onAddToFocus } = {}) {
  const response = await chrome.runtime.sendMessage({ action: 'getGroups' });
  if (!response.success) return;

  // 获取设置以获取可见分组列表和专注搜索分组
  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse.settings || {};
  const visibleGroups = new Set(settings.visibleGroups || []);
  const focusSearchGroups = settings.focusSearchGroups || [];

  const groupsList = document.getElementById('groupsList');

  // 只显示可见的分组
  const visibleGroupsList = response.groups.filter(group => visibleGroups.has(group.id));

  if (visibleGroupsList.length === 0) {
    groupsList.innerHTML = '<div class="empty-state">暂无可显示的分组（请在看板中筛选）</div>';
    return;
  }

  groupsList.innerHTML = visibleGroupsList.map(group => {
    const isInFocusSearch = focusSearchGroups.includes(group.id);
    return `<div class="group-item" style="border-left-color: ${group.color}">
      <div class="group-color" style="background: ${group.color}"></div>
      <div class="group-name">${escapeHtml(group.name)}</div>
      ${group.isDefault ? '<span class="group-default-badge">目标</span>' : ''}
      ${isInFocusSearch ? '<span class="focus-search-badge">🔍</span>' : `<button class="add-to-focus" data-id="${group.id}">+搜索</button>`}
      <div class="group-actions-buttons">
        ${!group.isDefault ? `<button class="set-default" data-id="${group.id}">设为目标</button>` : ''}
        <button class="delete" data-id="${group.id}">删除</button>
      </div>
    </div>`;
  }).join('');

  // 绑定事件
  if (onSetDefault) {
    document.querySelectorAll('.set-default').forEach(btn => {
      btn.addEventListener('click', () => onSetDefault(btn.dataset.id));
    });
  }

  if (onDelete) {
    document.querySelectorAll('.delete').forEach(btn => {
      btn.addEventListener('click', () => onDelete(btn.dataset.id));
    });
  }

  if (onAddToFocus) {
    document.querySelectorAll('.add-to-focus').forEach(btn => {
      btn.addEventListener('click', () => onAddToFocus(btn.dataset.id));
    });
  }
}

/**
 * 设置目标分组（快捷键添加标签时的默认目标）
 * @param {string} groupId - 分组ID
 */
export async function setDefaultGroup(groupId) {
  await chrome.runtime.sendMessage({ action: 'setDefaultGroup', groupId });
}

/**
 * 删除分组
 * @param {string} groupId - 分组ID
 * @returns {Promise<boolean>} 是否删除成功
 */
export async function deleteGroup(groupId) {
  const confirmed = await window.modal.confirm('确定要删除这个分组吗？分组内的标签页也会被删除。', {
    title: '删除分组',
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消'
  });
  if (!confirmed) return false;

  await chrome.runtime.sendMessage({ action: 'deleteGroup', groupId });
  return true;
}

/**
 * 添加分组到专注搜索
 * @param {string} groupId - 分组ID
 */
export async function addToFocusSearch(groupId) {
  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse.settings || {};
  const focusSearchGroups = settings.focusSearchGroups || [];

  if (!focusSearchGroups.includes(groupId)) {
    focusSearchGroups.push(groupId);
    await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { focusSearchGroups }
    });
  }
}

/**
 * 添加分组
 * @param {string} name - 分组名称
 * @param {string} color - 分组颜色
 */
export async function addGroup(name, color) {
  if (!name?.trim()) {
    throw new Error('请输入分组名称');
  }

  await chrome.runtime.sendMessage({
    action: 'addGroup',
    name: name.trim(),
    color: color || selectedColor
  });
}

/**
 * 获取默认颜色列表
 * @returns {string[]} 颜色数组
 */
export function getDefaultColors() {
  return [...DEFAULT_COLORS];
}

/**
 * 获取当前选中的颜色
 * @returns {string} 当前颜色
 */
export function getSelectedColor() {
  return selectedColor;
}

/**
 * 设置选中的颜色
 * @param {string} color - 颜色值
 */
export function setSelectedColor(color) {
  selectedColor = color;
}
