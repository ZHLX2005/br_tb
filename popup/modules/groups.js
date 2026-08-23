/**
 * Popup Groups Module
 * 分组管理功能（已合并专注搜索控制）
 *
 * 所有 group 数据读写走后台消息(→ background/group-model.js 领域层),
 * 本模块不做 read-modify-write。
 */

import { escapeHtml } from './utils.js';

const DEFAULT_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7',
  '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'
];

let selectedColor = DEFAULT_COLORS[0];

/**
 * 加载全量分组列表 + 每行专注搜索勾选 + tab 计数
 * @param {Object} options
 * @param {Function} options.onDelete - 删除分组回调 (groupId)
 * @param {Function} options.onSetDefault - 设置默认分组回调 (groupId)
 * @param {Function} options.onToggleFocus - 切换专注搜索回调 (groupId, enabled, prevChecked)
 */
export async function loadGroups({ onDelete, onSetDefault, onToggleFocus } = {}) {
  const dataResponse = await chrome.runtime.sendMessage({ action: 'getAllData' });
  if (!dataResponse?.success) {
    document.getElementById('groupsList').innerHTML =
      '<div class="empty-state">加载分组失败</div>';
    return;
  }

  const groups = dataResponse.groups || [];
  const tabs = dataResponse.tabs || {};

  const groupsList = document.getElementById('groupsList');

  if (groups.length === 0) {
    groupsList.innerHTML = '<div class="empty-state">暂无分组,点击右上角新建</div>';
    return;
  }

  groupsList.innerHTML = groups.map(group => {
    const isInFocus = group.inFocusSearch === true;
    const tabCount = (tabs[group.id] || []).length;
    return `<div class="group-item" style="border-left-color: ${group.color}">
      <div class="group-row">
        <div class="group-color" style="background: ${group.color}"></div>
        <div class="group-name">${escapeHtml(group.name)}</div>
        ${group.isDefault ? '<span class="group-default-badge">目标</span>' : ''}
        <span class="group-tab-count">${tabCount} 个</span>
      </div>
      <div class="group-controls">
        <label class="group-focus-toggle">
          <input type="checkbox" class="focus-checkbox" data-id="${group.id}" ${isInFocus ? 'checked' : ''}>
          <span>专注搜索</span>
        </label>
        <div class="group-actions-buttons">
          ${!group.isDefault ? `<button class="set-default" data-id="${group.id}">设为目标</button>` : ''}
          <button class="delete" data-id="${group.id}">删除</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // 绑定事件
  if (onSetDefault) {
    groupsList.querySelectorAll('.set-default').forEach(btn => {
      btn.addEventListener('click', () => onSetDefault(btn.dataset.id));
    });
  }

  if (onDelete) {
    groupsList.querySelectorAll('.delete').forEach(btn => {
      btn.addEventListener('click', () => onDelete(btn.dataset.id));
    });
  }

  if (onToggleFocus) {
    groupsList.querySelectorAll('.focus-checkbox').forEach(box => {
      box.addEventListener('change', (e) => {
        onToggleFocus(box.dataset.id, e.target.checked, !e.target.checked);
      });
    });
  }
}

/**
 * 设置目标分组
 */
export async function setDefaultGroup(groupId) {
  await chrome.runtime.sendMessage({ action: 'setDefaultGroup', groupId });
}

/**
 * 删除分组（带确认）
 */
export async function deleteGroup(groupId) {
  const confirmed = await window.modal.confirm(
    '确定要删除这个分组吗?分组内的标签页也会被删除。',
    { title: '删除分组', type: 'danger', confirmText: '删除', cancelText: '取消' }
  );
  if (!confirmed) return false;
  await chrome.runtime.sendMessage({ action: 'deleteGroup', groupId });
  return true;
}

/**
 * 添加分组
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
 * 切换分组的专注搜索状态(走领域 API toggleGroupFocusSearch,不做本地 read-modify-write)
 */
export async function toggleFocusSearchGroup(groupId, enabled) {
  const response = await chrome.runtime.sendMessage({
    action: 'toggleGroupFocusSearch',
    groupId,
    value: enabled
  });
  if (!response?.success) {
    throw new Error(response?.error || 'toggleGroupFocusSearch failed');
  }
}

/**
 * 默认颜色相关（保留供 popup.js / colorPicker 使用）
 */
export function getDefaultColors() {
  return [...DEFAULT_COLORS];
}

export function getSelectedColor() {
  return selectedColor;
}

export function setSelectedColor(color) {
  selectedColor = color;
}
