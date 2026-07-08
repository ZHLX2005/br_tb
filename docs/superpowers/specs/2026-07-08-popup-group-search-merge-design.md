# Popup 分组管理 & 专注搜索合并 — 设计文档

日期：2026-07-08
状态：approved（用户口头确认 "yy"）

## 1. 背景

TabBoard popup 顶部导航当前有 4 个 Tab：

| Tab | 内容 |
|---|---|
| 快捷操作 | 收集/打开/侧边栏 + 录制 + 基础设置 + 圆环设置 |
| 分组管理 | 仅 `visibleGroups` 子集，每行带 `+搜索` / `Search` 切换 + 设为目标 + 删除 |
| 专注搜索 | 全量分组 + 勾选框 + tab 计数 |
| 视频进度 | 视频捕获 / 列表 / 设置 |

两条路径（分组管理行的 `+搜索` 按钮、专注搜索页的 checkbox）都改 `settings.focusSearchGroups`，但呈现位置/入口不同。需求：把专注搜索 Tab 撤掉，统一并入「分组管理」Tab，由分组页承担「分组 CRUD + 是否参与专注搜索」的全部控制权。

## 2. 目标

- 撤掉 popup 顶部「专注搜索」Tab
- 「分组管理」Tab 改为展示全量分组 + 每行直接控制专注搜索勾选
- `settings.focusSearchGroups` 仍然由 popup 写入，看板 / 搜索侧栏照常读取

## 3. 不在范围内

- 不动看板 UI / 可见性筛选 / tab 计数来源
- 不重命名 Tab，不动其它 Tab 内容
- 不改 `chrome.storage` schema
- 不引入新组件库或构建步骤
- 不在 popup 中重新引入 `visibleGroups` 过滤入口（原本只展示可见分组的逻辑下线）

## 4. UI

### 4.1 顶部导航

撤掉后仅剩 3 个 Tab：

```
[快捷操作] [分组管理] [视频进度]
```

### 4.2 分组管理页

单标题「分组管理」+ 右上「+ 新建」按钮 + 单列表。

行布局（每个 `.group-item` 内部两行 flex column，容器 380px 宽）：

```
┌──────────────────────────────────────────────────────────┐
│ ●  分组名称              [目标]              N个  ▸    │
│    ☑ 专注搜索                  [设为目标] [删除]         │
└──────────────────────────────────────────────────────────┘
```

第一行：色点 + 名称（flex:1）+ 目标 badge（条件）+ tab 计数 + 箭头（可选，下方三角提示下排）。
第二行：checkbox（专注搜索）+ 设为目标按钮（条件）+ 删除按钮。

具体列：

| 列 | 控件 | 说明 |
|---|---|---|
| 色点 | `8px` 圆角色块 | 显示 `group.color` |
| 名称 | 文字 | `escapeHtml` 后渲染，超长 `ellipsis` |
| tab 计数 | 数字 | 取自 `tabs[groupId].length`（`getAllData`） |
| 目标 badge | pill | 仅 `isDefault === true` 时显示，文字「目标」 |
| 专注搜索 | checkbox | 勾选状态 = `focusSearchGroups.includes(group.id)`；切换写 `settings.focusSearchGroups` |
| 设为目标 | 按钮 | 非默认时显示，点击调 `setDefaultGroup` |
| 删除 | 按钮 | 走 `modal.confirm` 二次确认 |

约束：

- 行高 ~56–64px，popup 宽 380px 内排开
- checkbox 样式复用现有 `.focus-group-item input[type="checkbox"]:checked::after` 视觉语言
- 「+ 新建」按钮继续打开现有 `addGroupDialog`（名称 + 颜色），不变

## 5. 数据流

```
[用户勾选 checkbox]
  → toggleFocusSearchGroup(groupId, enabled)         [popup/modules/focusSearch.js]
  → chrome.runtime.sendMessage({ action:'updateSettings', settings:{ focusSearchGroups }})
  → background/init.js (updateSettings 分支)
  → chrome.storage.local.set({ settings })
```

新增 / 删除 / 设为目标的链路不变（沿用 `addGroup` / `deleteGroup` / `setDefaultGroup`）。

每次任一交互后：

- 调 `loadGroups(...)` 重渲染当前列表
- 不再调 `loadFocusSearchGroups(...)`（其渲染职责被并入 `loadGroups`）

## 6. 模块改动

| 文件 | 改动 |
|---|---|
| `popup/popup.html` | 删除 `<div class="nav-tab" data-page="focussearch">` 与 `<div class="page" id="page-focussearch">` |
| `popup/popup.js` | 删除 `loadFocusSearchGroups` / `toggleFocusSearchGroup` / `handleToggleFocusSearch` / `handleAddToFocus` 的导入与调用；分组管理行内 checkbox 走单一 `handleToggleFocusSearch` |
| `popup/modules/groups.js` | `loadGroups` 改为全量（去掉 `visibleGroups` 过滤），渲染每行带 checkbox + tab 计数；保留 `setDefaultGroup` / `deleteGroup` / `addGroup`；删除 `addToFocusSearch` |
| `popup/modules/focusSearch.js` | 删除（`toggleFocusSearchGroup` 的逻辑并入 `groups.js` 内联；不向 popup.js 暴露） |
| `popup/popup.css` | `.group-item` 引入 checkbox 视觉（沿用现有 `.focus-group-item input[type="checkbox"]:checked::after` 的勾选样式片段，复制而非依赖 `focusSearch.js`）；`.focus-group-item` / `.focus-search-badge` / `.add-to-focus` / `.focus-hint` 选择器下线 |

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| `getGroups` / `getAllData` 失败 | `success:false` 即停在 empty state，不弹 toast |
| `updateSettings` 失败 | `toggleFocusSearchGroup` 抛错时 popup.js catch 后 `showToast` 提示，**并将 checkbox 状态回滚到点击前的值**（保存 `prevChecked`，set 后比对） |
| 删除 / 设默认失败 | 沿用现有 toast 处理 |

## 8. 主题兼容

checkbox 复选样式已在 `popup.css` 的 `.focus-group-item input[type="checkbox"]:checked::after` 中存在。`.group-item` 引入同样的勾选样式，5 套主题（neo-brutalism / classic / dark-cockpit / acid-graphics / japanese）走 CSS 变量继承，**无需新增主题规则**。

## 9. 测试

无现有自动化测试。按现有约定：手动 `chrome://extensions` 加载 → 修改 popup 文件后刷新 extension card → 在 popup 内操作验证。

验证清单：

- [ ] 顶部导航仅剩 3 个 Tab（快捷操作 / 分组管理 / 视频进度）
- [ ] 分组管理页展示所有分组（含未启用 visibleGroups 的）
- [ ] 勾选 / 取消勾选 → `settings.focusSearchGroups` 持久化；看板搜索侧栏生效
- [ ] 设默认目标 → 列表 badge 即时切换
- [ ] 删除分组走 confirm 对话框
- [ ] 5 套主题切换无视觉破图
- [ ] 刷新 popup 后勾选状态保留

## 10. Trade-off

- 「可见性」职责让位给看板：用户想在 popup 屏蔽某个分组，得去看板。该 trade-off 已被本次需求确认。
- 单页分组 + 专注搜索 checkbox + 计数 + 两个按钮 → 行内信息密度高。Chrome popup 宽 380px，超长分组名继续 ellipsis。

## 11. 验收

完成上述 7 条验证清单即可视为完成。

## 12. 相关

- 看板与 chrome.storage 中 `settings.focusSearchGroups` 的读取方不受影响（看板 / 搜索侧栏继续按现有逻辑消费该字段）
- 模块通信仍走 `chrome.runtime.sendMessage`，无新增协议