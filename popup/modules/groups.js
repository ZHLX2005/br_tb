/**
 * Popup Groups Module
 * 分组管理功能（已合并专注搜索控制）
 *
 * 所有 group 数据读写走后台消息(→ background/group-model.js 领域层),
 * 本模块不做 read-modify-write。
 */

import { escapeHtml, showToast } from './utils.js';

const DEFAULT_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7',
  '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'
];

let selectedColor = DEFAULT_COLORS[0];

/**
 * 发送消息 + 超时兜底(适配层尚未实现 namespace 相关 action 时不卡死)
 * @param {Object} message
 * @param {number} [timeoutMs=1500]
 * @returns {Promise<any|null>} 响应对象,或 null(超时/无响应)
 */
async function trySendMessage(message, timeoutMs = 1500) {
  try {
    return await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise((_, reject) => setTimeout(() => reject(new Error('NO_RESPONSE')), timeoutMs))
    ]);
  } catch (_) {
    return null;
  }
}

/**
 * 加载命名空间下拉框 + 渲染到 #namespaceSelector
 *
 * 数据源全部走 message(CLAUDE.md Group 数据访问规约:popup 不允许直接读 chrome.storage 拿 groups/tabs/settings.activeNamespace):
 *  - getActiveNamespace          → 当前 ns
 *  - getAllGroupsAcrossNamespaces → 跨 ns group 列表(从中聚合所有 ns 名)
 *
 * 适配层尚未实现这两个 action 时,优雅降级:渲染仅含 active ns 的下拉框。
 *
 * @param {Object} options
 * @param {Function} [options.onChange] - (newNs) => void,setActiveNamespace 成功后调用
 */
export async function loadNamespaces({ onChange } = {}) {
  const container = document.getElementById('namespaceSelector');
  if (!container) return;

  let activeNs = null;
  const nsSet = new Set();

  // 1) 读当前 ns
  const activeResp = await trySendMessage({ action: 'getActiveNamespace' });
  if (activeResp?.activeNamespace) {
    activeNs = activeResp.activeNamespace;
    nsSet.add(activeNs);
  }

  // 2) 读跨 ns group 列表 → 聚合所有 ns 名
  const crossResp = await trySendMessage({ action: 'getAllGroupsAcrossNamespaces' });
  if (crossResp?.groups) {
    crossResp.groups.forEach(g => {
      if (g && typeof g.ns === 'string' && g.ns) nsSet.add(g.ns);
    });
  }

  // 兜底:适配层两个 action 都还没实现 → 用 'default' 作为唯一已知 ns
  if (nsSet.size === 0) {
    activeNs = activeNs || 'default';
    nsSet.add(activeNs);
  }

  const nsList = Array.from(nsSet).sort();

  // 防御:如果 active ns 已知但不在列表里(理论不会发生,真发生则回退到首个)
  if (!activeNs || !nsSet.has(activeNs)) {
    activeNs = nsList[0];
  }

  // 任务描述:始终渲染 input+datalist(active ns 作为 value 兜底);其他 ns 出现时再追加为 datalist option
  // 用 <input list> + <datalist> 而不是 <select>,以便用户可以键入新 ns 名(spec §6.3);
  // 结构与 board view 一致(modules/group/view.js 同一处 nsSwitcherHtml)。
  container.innerHTML = `
    <div class="namespace-switcher">
      <label for="namespaceInput" class="namespace-label">ns:</label>
      <input id="namespaceInput" class="namespace-input" list="namespaceList" autocomplete="off" value="${escapeHtml(activeNs)}" />
      <datalist id="namespaceList">
        ${nsList.map(ns =>
          `<option value="${escapeHtml(ns)}"></option>`
        ).join('')}
      </datalist>
      <span class="ns-help" title="切换命名空间会隐藏其他命名空间的分组，原数据不会被删除">?</span>
    </div>
  `;

  const input = container.querySelector('#namespaceInput');
  if (!input) return;

  // stale active 兜底:UI 与 storage 实际值对齐
  if (input.value !== activeNs) {
    input.value = activeNs;
  }

  input.addEventListener('change', async (e) => {
    const newNs = e.target.value.trim();
    // 空值 / 未变化 → 回退到当前 active,避免误删
    if (!newNs || newNs === activeNs) {
      e.target.value = activeNs;
      return;
    }
    const prevValue = activeNs;
    const response = await trySendMessage({
      action: 'setActiveNamespace',
      namespace: newNs
    });
    if (!response || response.success === false || response.error) {
      showToast(document.querySelector('.app'), `切换失败: ${response?.error || '未知错误'}`, 'error');
      e.target.value = prevValue;
      return;
    }
    activeNs = newNs;
    if (typeof onChange === 'function') {
      await onChange(newNs);
    }
  });
}

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
