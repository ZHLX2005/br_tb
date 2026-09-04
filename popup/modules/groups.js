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

  // 3) 兜底:「default」是系统默认 ns,即使没有 group 在里面、即使迁移没跑,
  //    也必须出现在下拉框里 —— 否则用户切到新 ns 后无法切回 default。
  //    (老用户数据可能缺 ns 字段,或用户曾清空数据,droplist 都会看不到 default)
  nsSet.add('default');

  // 兜底:适配层两个 action 都还没实现 → 用 'default' 作为唯一已知 ns
  if (activeNs === null) {
    activeNs = 'default';
  }

  const nsList = Array.from(nsSet).sort();

  // 防御:如果 active ns 已知但不在列表里(理论不会发生,真发生则回退到首个)
  if (!activeNs || !nsSet.has(activeNs)) {
    activeNs = nsList[0];
  }

  // 不再用 <input list> + <datalist> 做选择器:它和 Chrome 自身的表单历史 autofill
  // 下拉冲突,历史输入会覆盖 datalist 内容。选择已有 ns 完全由下方 chips 承担(input 纯文本)。
  // 结构与 board view 一致(modules/group/view.js 同一处 nsSwitcherHtml)。
  container.innerHTML = `
    <div class="namespace-switcher">
      <label for="namespaceInput" class="namespace-label">ns:</label>
      <input id="namespaceInput" class="namespace-input" autocomplete="nope" autocorrect="off" autocapitalize="off" spellcheck="false"
        name="__tabboard_ns_input"
        placeholder="输入 ns 名(新名即新建)"
        value="${escapeHtml(activeNs)}" />
      <button id="namespaceNew" class="namespace-new" title="新建命名空间(清空并聚焦输入框,键入新名后按 Enter 或「应用」)">+ 新建</button>
      <button id="namespaceApply" class="namespace-apply" title="切换到该命名空间">应用</button>
      <span class="ns-help" title="切换命名空间会隐藏其他命名空间的分组，原数据不会被删除">?</span>
    </div>
    <div class="namespace-chips" id="namespaceChips">
      ${nsList.map(ns => `
        <button class="ns-chip${ns === activeNs ? ' active' : ''}" data-ns="${escapeHtml(ns)}" title="切换到「${escapeHtml(ns)}」">
          ${escapeHtml(ns)}
        </button>
      `).join('')}
    </div>
  `;

  const input = container.querySelector('#namespaceInput');
  if (!input) return;

  // stale active 兜底:UI 与 storage 实际值对齐
  if (input.value !== activeNs) {
    input.value = activeNs;
  }

  // 关键 UX 修复:点击 input 时全选已有文本,让用户键入直接替换(避免「default」+「study」=「defaultstudy」)
  input.addEventListener('focus', () => {
    // setTimeout 0 让浏览器先把光标定位到 click 位置,然后我们再 select all 覆盖之
    setTimeout(() => input.select(), 0);
  });

  // 「+ 新建」按钮:清空 input + 聚焦,用户键入新名后按 Enter / 「应用」即创建
  const newBtn = container.querySelector('#namespaceNew');
  if (newBtn) {
    newBtn.addEventListener('mousedown', (e) => {
      // mousedown 在 input blur 之前触发,避免 button click 因 input blur 丢失
      e.preventDefault();
      input.value = '';
      input.focus();
      input.placeholder = '输入新 ns 名,按 Enter 创建';
    });
  }

  /**
   * 提交 ns 切换。封装 async 逻辑,避免在多个事件处理器里重复样板。
   * - prevValue:失败时回滚 input 用的旧值
   * - newNs:已经 trim 过的目标 ns
   */
  async function commitSwitch(prevValue, newNs) {
    if (!newNs || newNs === activeNs) {
      input.value = activeNs;
      return;
    }
    const response = await trySendMessage({
      action: 'setActiveNamespace',
      namespace: newNs
    });
    if (!response || response.success === false || response.error) {
      showToast(document.querySelector('.app'), `切换失败: ${response?.error || '未知错误'}`, 'error');
      input.value = prevValue;
      return;
    }
    activeNs = newNs;
    if (typeof onChange === 'function') {
      await onChange(newNs);
    }
  }

  // ── 事件绑定 ──
  // 1) change 事件:用户按 Enter 或失焦时触发(popup 关闭前可能丢失,所以不能是唯一入口)
  input.addEventListener('change', (e) => {
    commitSwitch(activeNs, e.target.value.trim());
  });

  // 2) Enter 键:即时提交,不依赖 change / blur(在 popup 关闭前能保证发出去)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSwitch(activeNs, e.target.value.trim());
    }
  });

  // 3) input 事件 + 250ms 防抖:用户一边输一边自动保存,
  //    避免「输完直接点外面 popup 关闭 → change 没机会触发 → 没保存」这条丢保存路径
  let debounceTimer = null;
  input.addEventListener('input', (e) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    const newNs = e.target.value.trim();
    if (!newNs || newNs === activeNs) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      commitSwitch(activeNs, newNs);
    }, 250);
  });

  // 4) 「应用」按钮:显式保存入口,鼠标点击走 mousedown 防 popup blur
  const applyBtn = container.querySelector('#namespaceApply');
  if (applyBtn) {
    applyBtn.addEventListener('mousedown', (e) => {
      // mousedown 在 input blur 之前触发,避免 popup 因 input blur 而关闭导致 click 丢失
      e.preventDefault();
      commitSwitch(activeNs, input.value.trim());
    });
  }

  // 5) chip 列表:点哪个直接切哪个(active chip 高亮)
  container.querySelectorAll('.ns-chip').forEach(chip => {
    chip.addEventListener('mousedown', (e) => {
      // mousedown 优先于 click/blur,避免 popup 因 input blur 关闭
      e.preventDefault();
      const targetNs = chip.dataset.ns;
      commitSwitch(activeNs, targetNs);
    });
  });
}

/**
 * 加载全量分组列表 — 扁平化单行布局
 * 每行:色点 + 名称 + tab 数 + 三个状态 toggle(Goto ★ / 专注 🔍 / 默认 🎯)+ 删除
 * 状态 toggle 激活时 accent 高亮,再点取消;未激活时半透明,点击即激活。
 *
 * @param {Object} options
 * @param {Function} options.onDelete - 删除分组回调 (groupId)
 * @param {Function} options.onSetDefault - 设置默认分组回调 (groupId)
 * @param {Function} options.onToggleFocus - 切换专注搜索回调 (groupId, enabled, prevChecked)
 * @param {Function} [options.onToggleGoto] - 切换 goto 回调 (groupId, enabled)
 */
export async function loadGroups({ onDelete, onSetDefault, onToggleFocus, onToggleGoto } = {}) {
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
    // 拉一下当前 ns,把「其他 ns 有分组」的事实告诉用户,避免以为默认分组被删了
    const activeNsResp = await trySendMessage({ action: 'getActiveNamespace' });
    const activeNs = activeNsResp?.activeNamespace || activeNsResp?.namespace || '';
    groupsList.innerHTML = `
      <div class="empty-state">
        <div>当前命名空间「${escapeHtml(activeNs)}」暂无分组</div>
        ${activeNs && activeNs !== 'default'
          ? `<div style="margin-top:6px;font-size:12px;color:#888;">默认分组在「default」中,可从上方 ns chips 切换回来</div>`
          : `<div style="margin-top:6px;font-size:12px;color:#888;">点击「+ 添加分组」创建第一个</div>`}
      </div>`;
    return;
  }

  groupsList.innerHTML = groups.map(group => {
    const isGoto = group.goto === true;
    const isInFocus = group.inFocusSearch === true;
    const isDefault = group.isDefault === true;
    const tabCount = (tabs[group.id] || []).length;
    return `
      <div class="group-item${isDefault ? ' is-default' : ''}" data-id="${group.id}" style="--group-color: ${group.color}">
        <span class="group-color" title="${escapeHtml(group.color)}"></span>
        <span class="group-name" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</span>
        <span class="group-tab-count">${tabCount}</span>
        <div class="group-toggles">
          <button class="gt-toggle gt-goto${isGoto ? ' on' : ''}" data-id="${group.id}" data-action="toggle-goto"
            title="${isGoto ? '已在 goto 圆环展示,点击取消' : '设为 goto 圆环展示源'}">★</button>
          <button class="gt-toggle gt-focus${isInFocus ? ' on' : ''}" data-id="${group.id}" data-action="toggle-focus"
            title="${isInFocus ? '已加入专注搜索,点击移除' : '加入专注搜索'}">🔍</button>
          <button class="gt-toggle gt-default${isDefault ? ' on' : ''}" data-id="${group.id}" data-action="set-default" ${isDefault ? 'disabled' : ''}
            title="${isDefault ? '当前默认分组(快捷添加目标)' : '设为默认分组(快捷添加目标)'}">🎯</button>
          <button class="gt-toggle gt-delete" data-id="${group.id}" data-action="delete"
            title="删除分组">✕</button>
        </div>
      </div>`;
  }).join('');

  // ── 事件绑定(统一按 data-action 委托) ──
  groupsList.querySelectorAll('[data-action]').forEach(btn => {
    const groupId = btn.dataset.id;
    const action = btn.dataset.action;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      switch (action) {
        case 'toggle-goto': {
          if (onToggleGoto) await onToggleGoto(groupId, !btn.classList.contains('on'));
          break;
        }
        case 'toggle-focus': {
          if (onToggleFocus) await onToggleFocus(groupId, !btn.classList.contains('on'), btn.classList.contains('on'));
          break;
        }
        case 'set-default': {
          if (onSetDefault) await onSetDefault(groupId);
          break;
        }
        case 'delete': {
          if (onDelete) await onDelete(groupId);
          break;
        }
      }
    });
  });
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
 * 切换分组的 goto 状态(走 setGroupAsGoto 消息 → model toggleGoto)
 */
export async function toggleGotoGroup(groupId) {
  const response = await chrome.runtime.sendMessage({
    action: 'setGroupAsGoto',
    groupId
  });
  if (!response?.success) {
    throw new Error(response?.error || 'setGroupAsGoto failed');
  }
  return response.isGoto;
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
