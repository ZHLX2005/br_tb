# 设计文档:添加当前标签页到默认分组 — Toggle 行为

**日期**: 2026-07-27
**范围**: `background/groups.js`, `background/commands.js`(仅间接影响)
**类型**: 行为变更 / 小型重构

## 背景

`Alt+Shift+A` 快捷键调用 `addCurrentTabToDefaultGroup`,内部通过 `addTabToGroup` 检查 URL 是否已存在于默认分组:

- 若不存在 → 添加,toast「已保存到 X 组」
- 若已存在 → **不做操作**,toast「该标签已在 X 组中」

前端手动添加(通过 `chrome.runtime.sendMessage({ action: 'addTab', ... })`)走同一底层函数,行为一致。

## 目标

将上述"已存在则忽略"的语义改为 **toggle**:

- 若不存在 → 添加,toast「已保存到 X 组」
- 若已存在 → **从目标分组移除**,toast「已从 X 组移除」

两条调用路径(快捷键 / `addTab` 消息)都需要 toggle 语义。

## 非目标

- 不改动前端 UI(前端调用 `addTab` 消息即可获得新语义)。
- 不修改 `moveTab` / `deleteTab` 等其他消息处理。
- 不引入新的存储字段或 schema 变化。
- 不影响 timeline snapshot / recording 相关代码。

## 架构

在 `background/groups.js` 内做函数级重构,拆分职责:

```
addTabToGroup(tab, groupId)      // 原子操作:只添加,已存在返回 false
removeTabFromGroup(tab, groupId) // 原子操作:只移除,精确 URL 匹配
toggleTabInGroup(tab, groupId)   // 组合:先尝试 add,失败则 remove
```

`addCurrentTabToDefaultGroup` 与 `addTab` 消息处理器都改用 `toggleTabInGroup`。

### 接口

**`addTabToGroup(tab, groupId): Promise<boolean>`**
- 保留现有实现(含 100 条截断、URL/title 校验)。
- 已存在返回 `false`,已添加返回 `true`。

**`removeTabFromGroup(tab, groupId): Promise<boolean>`**
- 精确按 `tab.url === t.url` 匹配。
- 找到并移除返回 `true`,未找到返回 `false`。
- 不遍历其他分组,只操作 `tabs[groupId]`。

**`toggleTabInGroup(tab, groupId): Promise<'added' | 'removed' | 'noop'>`**
- 先调用 `addTabToGroup`,返回 `true` → resolve 为 `'added'`。
- 否则调用 `removeTabFromGroup`,返回 `true` → resolve 为 `'removed'`。
- 极端情况下(并发)两者都返回 `false` → resolve 为 `'noop'`(兜底,不应发生)。

## 数据流

```
Alt+Shift+A
  → commands.js: addCurrentTabToDefaultGroup()
    → 前置校验(特殊页面、空白页、空标题、默认分组存在)
    → toggleTabInGroup(tab, defaultGroupId)
      → addTabToGroup   → tabs[groupId].unshift(...)
      或
      → removeTabFromGroup → tabs[groupId] = tabs[groupId].filter(...)
    → chrome.storage.local.set({ tabs })
    → showToast(...)   // 根据 'added' / 'removed' / 'noop' 选择文案

前端 → sendMessage({ action: 'addTab', tab, groupId })
  → groups.js addTab handler → toggleTabInGroup(...)
  → sendResponse({ success: true, action: 'added' | 'removed' | 'noop' })
```

## Toast 文案

| 场景 | type | title | message |
|---|---|---|---|
| added | success | 已添加 | 已保存到「{groupName}」 |
| removed | info | 已移除 | 已从「{groupName}」移除 |
| noop | info | 标签已存在 | 该标签已在「{groupName}」中 |
| 特殊页面 | info | 无法添加 | 无法添加特殊页面 |
| 空白页/空标题 | info | 无法添加 | 无法添加空白页/无效页面 |
| 无默认分组 | error | 添加失败 | 没有找到目标分组 |

`added` 保持 `showOpenButton: true`,`removed` 不显示打开按钮。

## 错误处理

- **特殊页面**(`chrome://`, `chrome-extension://`, `edge://`)、空白页、空标题:保留 `addCurrentTabToDefaultGroup` 内的前置拦截,不进入 toggle 流程。
- **默认分组缺失**:同上,拦截并 toast。
- **100 条上限**:由 `addTabToGroup` 内部 slice 处理,与现有行为一致。
- **remove 时未匹配到**:通过 `noop` 状态兜底,不抛错。
- **前端 addTab 路径**:失败沿用现有 `try/catch → sendResponse({ success: false, error })` 结构。

## 影响分析

**修改文件**
- `background/groups.js` — 拆函数、改 `addCurrentTabToDefaultGroup` 与 `addTab` handler

**未修改**
- `background/commands.js` — 仅调用签名未变
- `background/index.js` — 不涉及

**同步更新**
- `manifest.json` — 将 `add-current-tab` 命令的 `description` 由「添加当前标签页到默认分组」改为「切换当前标签页在默认分组中的状态（已存在则移除）」,匹配新行为

**间接影响**
- 前端(`modules/tabboard/**`)通过 `addTab` 消息添加标签的入口(如手动新增按钮)将获得 toggle 语义;若前端存在依赖「已存在则报错」的 UX(例如显式"重复"提示对话框),需要复审。经代码检索,前端目前仅在 `DataManager` 里做透传,无强依赖。

## 测试计划(人工)

1. 全新标签 + `Alt+Shift+A` → 添加,toast「已保存到 X 组」
2. 同一页面再按 `Alt+Shift+A` → 从默认分组移除,toast「已从 X 组移除」
3. 标签在非默认分组 A 中,`Alt+Shift+A` → 添加到默认分组,A 组保持不变
4. 默认分组不存在 → toast「没有找到目标分组」
5. `chrome://settings` → toast「无法添加特殊页面」
6. 空白页 `about:blank` → toast「无法添加空白页」
7. 前端 `sendMessage({ action: 'addTab', tab: {url: X}, groupId })` 两次连续调用 → 第一次添加,第二次移除

## 兼容性

- 存储 schema 不变。
- 已有分组数据无需迁移。
- `chrome.runtime.sendMessage({ action: 'addTab' })` 的 request 契约不变,response 新增 `action` 字段属兼容扩展。

## 风险

| 风险 | 缓解 |
|---|---|
| 用户误按快捷键导致标签被移除 | Toast 文案区分「已保存」vs「已移除」,视觉上足够明显 |
| 前端调用方期望"重复即错" | 已代码检索,前端目前无此依赖;response 增加 `action` 字段可供前端识别 |
| 并发写(极小概率) | 沿用现有 `get → 修改 → set` 模式,与其他 handler 一致,不引入新问题 |
