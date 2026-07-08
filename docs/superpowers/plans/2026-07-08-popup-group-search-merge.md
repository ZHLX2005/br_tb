# Popup 分组管理 & 专注搜索合并 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 撤掉 popup 顶部「专注搜索」Tab，将「分组管理」Tab 改为展示全量分组并在每行直接控制专注搜索勾选，行为合并、数据来源不变。

**Architecture:** 单页渲染：`groups.js#loadGroups` 拉取全量分组 + `getAllData` 的 tab 计数 + `settings.focusSearchGroups`，每行带 checkbox 切 `focusSearchGroups`，按钮沿用现有 `setDefaultGroup`/`deleteGroup`。`focusSearch.js` 文件删除，其 `toggleFocusSearchGroup` 逻辑内联到 `groups.js` 同一文件。popup.html 移除 focussearch 节点，popup.css 把 `.group-item` 升级为两行布局，删除已无引用的 `.focus-*` 选择器。

**Tech Stack:** Vanilla JS（ES Modules）, Chrome Extension Manifest V3, chrome.storage.local, chrome.runtime.sendMessage。

**Spec:** `docs/superpowers/specs/2026-07-08-popup-group-search-merge-design.md`

## Global Constraints

- 无构建系统：`.js` / `.html` / `.css` 改动在 chrome://extensions 刷新即可生效
- popup 宽 380px，行高目标 ~56–64px；超长分组名 `text-overflow: ellipsis`
- checkbox 视觉延续现有 `.focus-group-item input[type="checkbox"]:checked::after`（复制而非依赖 `focusSearch.js`）
- 5 套主题（neo-brutalism / classic / dark-cockpit / acid-graphics / japanese）走 CSS 变量继承，不新增主题规则
- `settings.focusSearchGroups` 是写入路径的唯一权威；看板/搜索侧栏按现有逻辑消费，本计划不修改它们
- 不改 chrome.storage schema
- Commit message 中文，简短前缀 + 范围

---

### Task 1: 删除 popup.html 中的 focussearch 节点

**Files:**
- Modify: `popup/popup.html:28-31` (删除 nav-tab)
- Modify: `popup/popup.html:129-136` (删除 page)

**Interfaces:**
- Consumes: 无（纯 HTML 结构变更）
- Produces: 顶部导航仅剩 3 个 Tab：actions / groups / videoprogress；DOM 中不再存在 `#page-focussearch`

- [ ] **Step 1: 移除 nav-tab focussearch**

在 `popup/popup.html` 中删除以下整段（行号约 28–31）：

```html
        <div class="nav-tab" data-page="focussearch">
          <span class="nav-tab-icon"></span>
          <span class="nav-tab-label">专注搜索</span>
        </div>
```

- [ ] **Step 2: 移除 page-focussearch**

在 `popup/popup.html` 中删除以下整段（行号约 129–136）：

```html
      <!-- 专注搜索页 -->
      <div class="page" id="page-focussearch">
        <div class="page-section-title">专注搜索分组</div>
        <p class="focus-hint">勾选分组以添加到专注搜索对象</p>
        <div id="focusSearchGroupsList" class="focus-search-groups-list">
          <!-- 动态生成 -->
        </div>
      </div>
```

- [ ] **Step 3: 校验 HTML 结构**

打开 `popup/popup.html`，确认：
- 顶部 `.nav-tabs` 内只有 3 个 `.nav-tab`：`actions` / `groups` / `videoprogress`
- `.page-container` 内只有 3 个 `.page`：`page-actions` / `page-groups` / `page-videoprogress`
- 全文件不再出现字符串 `focussearch` / `focusSearch`

- [ ] **Step 4: Commit**

```bash
git add popup/popup.html
git commit -m "feat(popup): 移除专注搜索 Tab 与页面节点"
```

---

### Task 2: popup.css 重构 .group-item 为两行布局 + 下线 focus-* 选择器

**Files:**
- Modify: `popup/popup.css:223-359`（.group-item、.focus-search-badge、.add-to-focus、.focus-* 一整段）

**Interfaces:**
- Consumes: 由 Task 3 渲染出的 `.group-item` 结构（第一行：色点+名称+目标 badge+计数；第二行：checkbox+设目标按钮+删除按钮）
- Produces: 新 `.group-item` 样式 + 下线的 `.focus-search-badge` / `.add-to-focus` / `.focus-hint` / `.focus-search-groups-list` / `.focus-group-item` / `.focus-group-checkbox-wrapper` / `.focus-color-dot` / `.focus-group-name` / `.focus-group-count` / `.focus-group-remove`

- [ ] **Step 1: 用新样式替换 .group-item 段落**

将 `popup/popup.css` 行号约 223–359 整段（含 `.group-item` 系列 + `.focus-search-badge` + `.add-to-focus` + `.focus-hint` 起始）替换为以下内容：

```css
/* ========== 分组管理页（合并后） ========== */

.groups-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
}

.group-item .group-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-item .group-color {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.group-item .group-name {
  flex: 1;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-item .group-default-badge {
  font-size: 9px;
  padding: 2px 6px;
  flex-shrink: 0;
}

.group-item .group-tab-count {
  font-size: 10px;
  flex-shrink: 0;
  margin-left: auto;
  padding: 2px 6px;
}

.group-item .group-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-item .group-focus-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  flex: 1;
}

.group-item .group-focus-toggle input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  margin: 0;
  border: var(--border-width) solid var(--border-color);
  background: var(--bg-surface);
}

.group-item .group-focus-toggle input[type="checkbox"]:checked {
  background: var(--color-accent);
}

.group-item .group-focus-toggle input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 5px;
  height: 9px;
  border: solid var(--text-on-accent);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.group-item .group-actions-buttons {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.group-item .group-actions-buttons button {
  padding: 3px 7px;
  font-size: 10px;
  cursor: pointer;
}
```

- [ ] **Step 2: 删除旧的 focus-* 样式段**

在 `popup/popup.css` 中删除以下整段（行号约 281–359，紧接 `.add-to-focus` 之后）：

```css
/* ========== 专注搜索页 ========== */

.focus-hint {
  font-size: 11px;
  margin-bottom: 10px;
}

.focus-search-groups-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.focus-group-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.focus-group-item input[type="checkbox"] {
  appearance: none;
  width: 18px;
  height: 18px;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
}

.focus-group-item input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 5px;
  height: 9px;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.focus-group-checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  cursor: pointer;
}

.focus-color-dot {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.focus-group-name {
  flex: 1;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.focus-group-count {
  font-size: 10px;
  margin-left: auto;
}

.focus-group-remove {
  width: 22px;
  height: 22px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
```

- [ ] **Step 3: 校验 CSS**

打开 `popup/popup.css`，确认：
- 仍有 `.group-item` / `.group-color` / `.group-name` / `.group-default-badge` / `.group-actions-buttons` 选择器
- 新增 `.group-row` / `.group-tab-count` / `.group-controls` / `.group-focus-toggle`
- 全文件不再出现字符串 `.focus-` / `.focus-hint`

- [ ] **Step 4: Commit**

```bash
git add popup/popup.css
git commit -m "feat(popup): group-item 升级为两行布局,下线 focus-* 选择器"
```

---

### Task 3: groups.js 重写 loadGroups（全量 + 每行 checkbox + 计数 + 内联 toggle）

**Files:**
- Modify: `popup/modules/groups.js`（整体替换）
- Delete: `popup/modules/focusSearch.js`

**Interfaces:**
- Consumes: 无外部依赖（仅 `escapeHtml` from `./utils.js`）
- Produces:
  - `loadGroups({ onDelete, onSetDefault, onToggleFocus })` 全量渲染，每行两个 row，事件分别触发回调
  - `setDefaultGroup(groupId)` — 调 background `setDefaultGroup`
  - `deleteGroup(groupId)` — 走 `window.modal.confirm`，调 `deleteGroup`
  - `addGroup(name, color)` — 调 background `addGroup`
  - `getSelectedColor()` / `getDefaultColors()` / `setSelectedColor()` / `resetColorPicker()` 仍然被 popup.js 引用（colorPicker 模块提供 `resetColorPicker`；颜色状态留在 groups.js）
  - `toggleFocusSearchGroup(groupId, enabled)` — 直接写 `settings.focusSearchGroups`
- 注意：`groups.js` 删除了 `addToFocusSearch`（被 `toggleFocusSearchGroup` 取代）

- [ ] **Step 1: 用新实现整体替换 groups.js**

将 `popup/modules/groups.js` 整个文件替换为以下内容：

```js
/**
 * Popup Groups Module
 * 分组管理功能（已合并专注搜索控制）
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
  const groupsResponse = await chrome.runtime.sendMessage({ action: 'getGroups' });
  if (!groupsResponse?.success) {
    document.getElementById('groupsList').innerHTML =
      '<div class="empty-state">加载分组失败</div>';
    return;
  }

  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse?.settings || {};
  const focusSearchGroups = settings.focusSearchGroups || [];

  const dataResponse = await chrome.runtime.sendMessage({ action: 'getAllData' });
  const tabs = dataResponse?.tabs || {};

  const groupsList = document.getElementById('groupsList');
  const groups = groupsResponse.groups || [];

  if (groups.length === 0) {
    groupsList.innerHTML = '<div class="empty-state">暂无分组,点击右上角新建</div>';
    return;
  }

  groupsList.innerHTML = groups.map(group => {
    const isInFocus = focusSearchGroups.includes(group.id);
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
 * 切换分组的专注搜索状态
 * @param {string} groupId
 * @param {boolean} enabled
 */
export async function toggleFocusSearchGroup(groupId, enabled) {
  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse?.settings || {};
  let focusSearchGroups = settings.focusSearchGroups || [];

  if (enabled) {
    if (!focusSearchGroups.includes(groupId)) focusSearchGroups.push(groupId);
  } else {
    focusSearchGroups = focusSearchGroups.filter(id => id !== groupId);
  }

  await chrome.runtime.sendMessage({
    action: 'updateSettings',
    settings: { focusSearchGroups }
  });
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
```

- [ ] **Step 2: 删除 popup/modules/focusSearch.js**

```bash
rm popup/modules/focusSearch.js
```

- [ ] **Step 3: 校验**

- 打开 `popup/modules/groups.js`，确认导出 `loadGroups` / `setDefaultGroup` / `deleteGroup` / `addGroup` / `toggleFocusSearchGroup` / `getDefaultColors` / `getSelectedColor` / `setSelectedColor`
- 确认不再导出 `addToFocusSearch` / `loadFocusSearchGroups`
- 确认 `popup/modules/focusSearch.js` 已删除

- [ ] **Step 4: Commit**

```bash
git add popup/modules/groups.js popup/modules/focusSearch.js
git commit -m "feat(popup): loadGroups 全量+每行专注搜索,删除 focusSearch.js"
```

---

### Task 4: popup.js 收尾 wiring + 手动验证清单

**Files:**
- Modify: `popup/popup.js:7-9`（imports）
- Modify: `popup/popup.js:107-169`（callback 段）
- Modify: `popup/popup.js:227-242`（init 并发加载段）

**Interfaces:**
- Consumes: 由 Task 3 提供的 `loadGroups({ onDelete, onSetDefault, onToggleFocus })` 和 `toggleFocusSearchGroup`
- Produces: popup 启动时不再请求 `loadFocusSearchGroups`；勾选/取消勾选走 `handleToggleFocus`；失败时回滚 checkbox

- [ ] **Step 1: 替换 imports**

将 `popup/popup.js` 行 7–9：

```js
import { loadGroups, setDefaultGroup, deleteGroup, addToFocusSearch, addGroup, getSelectedColor } from './modules/groups.js';
import { loadSettings, bindSettingsListeners } from './modules/settings.js';
import { loadFocusSearchGroups, toggleFocusSearchGroup } from './modules/focusSearch.js';
```

替换为：

```js
import { loadGroups, setDefaultGroup, deleteGroup, addGroup, toggleFocusSearchGroup, getSelectedColor } from './modules/groups.js';
import { loadSettings, bindSettingsListeners } from './modules/settings.js';
```

- [ ] **Step 2: 替换 handleAddToFocus + handleToggleFocusSearch**

将 `popup/popup.js` 行 145–169：

```js
/**
 * 添加到专注搜索处理
 */
async function handleAddToFocus(groupId) {
  await addToFocusSearch(groupId);
  await loadGroups({
    onDelete: handleDeleteGroup,
    onSetDefault: handleSetDefaultGroup,
    onAddToFocus: handleAddToFocus
  });
  await loadFocusSearchGroups({
    onToggle: handleToggleFocusSearch
  });
  showToast(document.querySelector('.app'), '已添加到专注搜索', 'success');
}

/**
 * 切换专注搜索分组
 */
async function handleToggleFocusSearch(groupId, enabled) {
  await toggleFocusSearchGroup(groupId, enabled);
  await loadFocusSearchGroups({
    onToggle: handleToggleFocusSearch
  });
}
```

整体替换为：

```js
/**
 * 切换专注搜索分组（行内 checkbox）
 */
async function handleToggleFocus(groupId, enabled, prevChecked) {
  try {
    await toggleFocusSearchGroup(groupId, enabled);
  } catch (e) {
    const box = document.querySelector(`.focus-checkbox[data-id="${groupId}"]`);
    if (box) box.checked = prevChecked;
    showToast(document.querySelector('.app'), `专注搜索更新失败: ${e.message}`, 'error');
  }
}
```

- [ ] **Step 3: 替换剩余 loadGroups 调用点**

全文搜索 `loadGroups({` 并替换三次（handleAddGroup / handleSetDefaultGroup / handleDeleteGroup / init），把 `onAddToFocus: handleAddToFocus` 替换为 `onToggleFocus: handleToggleFocus`。

以 `handleAddGroup`（行号约 107–116）为例，从：

```js
    await loadGroups({
      onDelete: handleDeleteGroup,
      onSetDefault: handleSetDefaultGroup,
      onAddToFocus: handleAddToFocus
    });
```

改为：

```js
    await loadGroups({
      onDelete: handleDeleteGroup,
      onSetDefault: handleSetDefaultGroup,
      onToggleFocus: handleToggleFocus
    });
```

对 `handleSetDefaultGroup` / `handleDeleteGroup` / `init` 中的 `loadGroups({ ... })` 三处执行同样替换。

- [ ] **Step 4: 替换 init 中的并发加载**

将 `popup/popup.js` 行 232–242：

```js
  // 加载各模块数据
  await Promise.all([
    loadSettings(),
    loadGroups({
      onDelete: handleDeleteGroup,
      onSetDefault: handleSetDefaultGroup,
      onAddToFocus: handleAddToFocus
    }),
    loadFocusSearchGroups({
      onToggle: handleToggleFocusSearch
    })
  ]);
```

替换为：

```js
  // 加载各模块数据
  await Promise.all([
    loadSettings(),
    loadGroups({
      onDelete: handleDeleteGroup,
      onSetDefault: handleSetDefaultGroup,
      onToggleFocus: handleToggleFocus
    })
  ]);
```

- [ ] **Step 5: 校验 popup.js**

- 全文不再出现 `loadFocusSearchGroups` / `handleAddToFocus` / `handleToggleFocusSearch` / `addToFocusSearch`
- 顶部 imports 不再 import `./modules/focusSearch.js`
- `loadGroups({...})` 三处均使用 `onToggleFocus: handleToggleFocus`

- [ ] **Step 6: Commit**

```bash
git add popup/popup.js
git commit -m "feat(popup): 收尾 wiring,专注搜索走单页 toggle 回调"
```

- [ ] **Step 7: 手动验证（按 spec §9 验证清单）**

按以下顺序在 chrome://extensions 加载并刷新 extension card：

1. 顶部导航仅剩 3 个 Tab（快捷操作 / 分组管理 / 视频进度）
2. 分组管理页展示所有分组（含不在 `visibleGroups` 中的）
3. 勾选 / 取消勾选行内 checkbox → 关闭 popup 再打开，状态保留
4. 切到看板触发专注搜索侧栏，确认勾选过的分组在搜索结果里出现
5. 设默认目标 → 该行显示「目标」badge，其他行的「设为目标」按钮消失
6. 删除分组 → 走 confirm 对话框
7. 切换 5 套主题（neo-brutalism / classic / dark-cockpit / acid-graphics / japanese）→ 行布局无破图，checkbox 勾选态可视
8. 刷新 popup（F5 in popup? — chrome 扩展 popup 不能 F5，关闭再打开即可）后勾选状态保留

任一失败：回退对应 Task 的 commit，不通过即不动下一项。