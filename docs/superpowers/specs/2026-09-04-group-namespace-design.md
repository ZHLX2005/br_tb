# Group Namespace 设计文档

> 日期: 2026-09-04
> 范围: TabBoard「分组命名空间（namespace）」功能
> 状态: 设计稿（待评审 / 待实现）

> ⚠️ **文档结构与拆分**：本 spec 单文档覆盖设计 + 14 个测试用例 + 迁移计划 + 12 文件改动清单，体量过大、评审面互相纠缠。**v1 评审 / 落地时拆成 5 个独立 PR**，每个 PR 有独立 review surface、可以独立回滚：
>
> | PR | 范围 | 本 spec 涉及章节 |
> |---|---|---|
> | **PR-A** ns schema + model 层 | `group-model.js` 的新增 / 修改函数（§4.1 全部 + §4.2 + §9 迁移）+ 单测 | §4、§5、§9、§10 |
> | **PR-B** background 适配层 + 迁移触发 | `groups.js` adapter 新增 4 个 action + `incrementVisitCount` adapter 改造；`init.js` `ensureSettingsDefaults`；`focus.js` `getOrCreateHistoryGroup` ns 过滤 | §5、§7.3、§7.4、§9.2-§9.3 |
> | **PR-C** popup / board UI switcher | popup header 下拉框 + board view header 下拉框；`storage.onChanged` 监听 | §6.1、§6.2、§8.10 |
> | **PR-D** content-script refresh | `content/inject/goto.js` 重建圆环 + `content/gotoManagerRing.js` 重渲染；`storage.onChanged` 监听 | §7.1、§7.2、§8.8 |
> | **PR-E** 迁移测试计划 | 14 个 smoke test + 验证不变量检查（§附录 B）；逐 PR 跑 T1-T14 | §10、§附录 B |
>
> 本 spec 仍是 single source of truth，但落地时按 PR-A→E 顺序串行合入，每合一个跑一次 §附录 B 的不变量检查。

---

## 1. 背景与目标

### 1.1 背景
当前 TabBoard 把所有分组（group）放在一个扁平空间里。同一组用户既想用「工作」相关分组，也想用「学习」相关分组时，会出现以下痛点：

- **上下文混淆**：工作时打开的分组面板和学习的混在一起，切换场景要手动筛选。
- **快捷键冲突**：`Alt+Shift+A`（把当前页加入默认分组）无法区分场景 —— 在学习场景里加进「工作」默认分组是错的。
- **访问计数串味**：同一个 URL 在不同语境下的访问次数会互相污染（学习页和工作页被同等对待）。
- **默认分组 / History 分组语义不清**：跨场景共享「默认分组」「History」概念会丢失语义。

### 1.2 目标
引入「**namespace（命名空间，下文简称 ns）**」作为分组的顶层容器，让用户可以：

1. 在完全不相关的多个场景（工作 / 学习 / 调研 …）之间干净地切换分组集合。
2. 切 ns 时，已有的「默认分组」「History 分组」「goto 圆环」「访问计数」全部按 ns 重新解释，但**不丢失**任何旧数据。
3. 旧用户在升级后无感：默认 ns 名为 `"default"`，所有既有分组自动归到 `"default"` 下。
4. 完全不破坏 `group-model.js` 的「唯一读写入口」规约（CLAUDE.md）。

### 1.3 非目标
- 跨 ns 的合并 / 移动（v1 不做）。
- 嵌套 ns（ns 下面再分 ns）。
- ns 级别的导入 / 导出（v1 只支持全量）。
- 计时 / 配额 / 自动归档等 ns 元数据（v1 只有 name）。

---

## 2. 设计决策汇总

| # | 决策 | 说明 |
|---|---|---|
| 1 | **存储形态**：每个 `Group` 增加字段 `ns: string`，默认 `"default"`。`groups` 仍是扁平的 `Group[]`。 | 不嵌套 `groups[ns]`，避免破坏 model 与所有现有读写点。 |
| 2 | **当前 ns**：`settings.activeNamespace: string`，默认 `"default"`。 | 全局唯一，写到 settings 而不是顶层 storage key，便于将来扩展 ns 元数据时复用 settings 域。 |
| 3 | **Goto 圆环行为**：每页**一个** goto 圆环，active ns 切换时内容替换。 | 不在页面同时挂多圆环，避免 UI 遮挡和状态同步复杂度。 |
| 4 | **切换 UI**：popup header + board view header 各一个 ns 下拉框。切换 → `setActiveNamespace` → `storage.onChanged` 广播 → 所有 tab 重新拉取 goto 数据。 | popup / board 是双入口但行为完全一致。 |
| 5 | **预置 ns**：只有 `"default"` 一个。 | 首次启动不会自动创建多个空 ns，避免给老用户增加认知负担。 |
| 6 | **实现路径（Option A）**：model 内部隐式过滤。`group-model` 的所有读函数内部读 `settings.activeNamespace` 并按 `group.ns` 过滤；写函数默认写到 active ns。调用方**不**显式传 ns。新增 `getAllGroupsAcrossNamespaces()` 给导出等跨 ns 场景使用。 | 调用方改动最小；归一性强；`background/groups.js` 适配层基本不动。 |

---

## 3. 存储 schema

### 3.1 Group 新字段

```js
// Group
{
  id: string,           // 已有
  name: string,         // 已有
  color: string,        // 已有
  isDefault: boolean,   // 已有（语义改为「当前 ns 的默认分组」）
  goto: boolean,        // 已有
  inFocusSearch: boolean, // 已有
  visible: boolean,     // 已有
  ns: string,           // 【新增】命名空间标识，默认 "default"
}
```

约束：
- `ns` 缺省视为 `"default"`（向后兼容老数据）。
- `ns` 与 `id` 共同形成分组「内部 key」，但 `id` 仍全局唯一（见 8.6 碰撞风险）。

### 3.2 settings 新字段

```js
settings.activeNamespace: string  // 【新增】默认 "default"
```

**不要**通过通用 `updateSettings` action 写 `activeNamespace`（CLAUDE.md 规约）。新增专属 action `setActiveNamespace`。

### 3.3 迁移规则

| 旧数据形态 | 迁移后 |
|---|---|
| Group 缺 `ns` | 补为 `"default"` |
| `settings` 缺 `activeNamespace` | 补为 `"default"` |
| 老的「全局默认分组」`isDefault === true` | 保留 `isDefault: true`，但语义变为「ns=`"default"` 下的默认分组」。其他 ns 里若没有任何 `isDefault: true` 的 group，迁入时在该 ns 内把**最早创建**的 group 标为 `isDefault: true`（兜底）。 |
| 老的「全局 History 分组」（focus.js 创建的） | 在 `ensureGroupDefaults` 末尾按 ns 维度懒创建（见 §9）。 |

---

## 4. 领域层 (group-model.js) 改动

> 规约：所有新函数 / 修改函数都住在 `group-model.js`。其他模块只能通过 `chrome.runtime.sendMessage` 调 `background/groups.js` 适配层，由适配层转发到 model。

### 4.1 新增函数

#### 4.1.1 `getActiveNamespace()`

```js
/**
 * 读取 settings.activeNamespace，缺省回退到 "default"。
 * 内部走 chrome.storage.local.get(['settings'])，是 model 允许的特例。
 * @returns {Promise<string>}
 */
```

**边界**：
- settings 不存在 → 返回 `"default"`。
- `activeNamespace` 字段缺失 → 返回 `"default"`。
- `activeNamespace` 是非字符串 / 空串 → 回退 `"default"`，并在 console.warn（便于发现用户数据被外部工具损坏的情况）。

#### 4.1.2 `setActiveNamespace(ns)`

```js
/**
 * 切换当前 ns。空串 / 非法字符串一律拒绝。
 * 成功后通过 settings 域的 onChanged 自动广播。
 * @param {string} ns
 * @returns {Promise<void>}
 * @throws {Error("INVALID_NAMESPACE")} 当 ns 不是合法字符串
 */
```

**边界**：
- ns 必须是非空字符串，长度 1 ~ 64。
- 字符集：Unicode 字母（含中日韩）+ 数字 + `_` + `-` + 半角空格（用于如 `"work project"`）。正则参考：`/^[\p{L}\p{N}_\- ]{1,64}$/u`。
- 不校验 ns 是否已存在（用户可以提前切到一个不存在的 ns，然后创建第一个 group；model 在 `createGroup` 时会做软纠正，见 §4.1.3）。
- 不删除 ns 也没有的 group —— 切换是软切换。

#### 4.1.3 `createGroup(name, color, opts?)`

```js
/**
 * 在 active ns 下创建新 group。
 * @param {string} name
 * @param {string} color
 * @param {{ ns?: string }} [opts] - 内部调用时允许显式传 ns（默认走 active ns）
 * @returns {Promise<Group>}
 */
```

**改动点**：
- 写入前取 `await getActiveNamespace()`，写入时填 `ns`。
- 若当前 ns 内**已有 `isDefault: true` 的 group**，新 group 标 `isDefault: false`；否则标 `isDefault: true`（自动成为该 ns 的默认分组）。
- 返回前确保调用 `ensureGroupDefaults` 路径上的 group 形状齐全。

#### 4.1.4 `getAllGroups()`（修改）

```js
/**
 * 返回 active ns 下的所有 group。
 * @returns {Promise<Group[]>}
 */
```

**改动**：从「返回所有 group」改为「先 `getActiveNamespace()`，再 `filter(g => g.ns === activeNs)`」。

**兼容性**：所有调用方原本假设「全部 group」，现在得到「当前 ns 的 group」。这是设计意图（Option A）。

#### 4.1.5 `getAllGroupsAcrossNamespaces()`

```js
/**
 * 返回所有 ns 下的全部 group。仅供导出 / 跨 ns 迁移 / 调试使用。
 * 调用方需明确意识到这是跨 ns 视图。
 * @returns {Promise<Group[]>}
 */
```

**用途**：export 功能、`clearAllGroups` 的「跨 ns」变体（如有）。

#### 4.1.6 `getAllTabs()`（修改）

```js
/**
 * 返回 active ns 下所有 group 的 tabs（结构同前：`{ [groupId]: Tab[] }`）。
 * @returns {Promise<{[groupId: string]: Tab[]}>}
 */
```

**改动**：`getAllGroups()` 已经按 ns 过滤了，所以 tabs 也自然只含当前 ns 的内容。`groupId` 仍全局唯一，因此 map 结构本身不需要改。

#### 4.1.7 `addTabToGroup(tab, groupId, opts?)`（修改）

```js
/**
 * 把 tab 加到指定 group。
 * @param {Tab} tab
 * @param {string} groupId
 * @param {{ maxTabs?: number, initVisitCount?: boolean }} [opts] - History 分组用 maxTabs=200 + initVisitCount=true
 * @returns {Promise<boolean>} true 表示新增,false 表示同 URL 已存在
 */
```

**改动点**：
- 写入前校验 `groupId` 属于 active ns —— 否则拒绝写入并抛 `Error("CROSS_NAMESPACE_WRITE")`。
- 沿用现有函数名 `addTabToGroup`(不要改名为 `addTab`,避免与消息 action `addTab` 命名混淆)。
- 保留现有 opts 参数(`maxTabs` / `initVisitCount`)—— focus.js 仍依赖它创建 History 分组的 200 条上限 + 访问计数初始化。

#### 4.1.8 `moveTab({ fromGroup, toGroup, tabId, afterTabId })`（修改）

```js
/**
 * 移动 tab 从一个 group 到另一个。
 * @param {{ fromGroup: string, toGroup: string, tabId: string, afterTabId?: string }} payload
 * @returns {Promise<void>}
 */
```

**改动点**：
- 沿用现有对象参数签名（不要改成 4 个位置参数；model 当前就是对象参数，groups.js:165 也是按对象转发）。
- 新增校验：`fromGroup` 和 `toGroup` 必须属于同一 ns，且该 ns === active ns。否则抛 `Error("CROSS_NAMESPACE_MOVE")`。
- 如果原 group 没找到，从所有 group 中查找（保留现有兜底逻辑）。

**理由**：跨 ns 移动是 v1 非目标；强制同 ns 移动可以把非法操作前置暴露。

#### 4.1.9 `deleteGroup(groupId)`（修改）

校验目标 group 属于 active ns。否则抛 `Error("CROSS_NAMESPACE_DELETE")`。

**附则**：
- 若被删的 group 是该 ns 的 `isDefault: true`，**不**自动把另一个 group 升为默认 —— 由 UI 后续动作（创建 group / 用户手动指定）触发。
- 删 group 时，**不**清理 `settings.focusSearchGroups` / `settings.visibleGroups`（它们已经迁移到 group 字段上，删 group 时自然清理）。

#### 4.1.10 `setGroupAsGoto(groupId, value)`（修改）

校验 group 属于 active ns。否则抛 `Error("CROSS_NAMESPACE_GOTO")`。

**理由**：goto 圆环只显示当前 ns 的内容；往非当前 ns 的 group 上设 goto 会让 content script 永远拿不到它。

#### 4.1.11 `toggleGroupFocusSearch(groupId, value)`（修改）

校验 group 属于 active ns。否则抛 `Error("CROSS_NAMESPACE_FOCUS")`。

#### 4.1.12 `setGroupsVisibility(visibleGroupIds)`（修改）

校验每个 id 都属于 active ns。否则抛 `Error("CROSS_NAMESPACE_VISIBILITY")` 或在 console.warn 后静默丢弃非法 id（实现层选择，前端消息建议抛错以便发现）。

#### 4.1.13 `setDefaultGroup(groupId)`（修改）

行为不变，但校验 group 属于 active ns。语义变为「把 active ns 的默认分组设为这个」。

#### 4.1.14 `getDefaultGroup()`（新增）

> 原 §4.1.14 草稿误标为「修改」—— 现 model 只有 `getDefaultGroupId()`（返回 id），没有返回完整 Group 的函数。本节为**新增**函数。

```js
/**
 * 返回 active ns 的默认分组完整对象。
 * @returns {Promise<Group | null>} 找不到时返回 null（不是 undefined，便于前端判断）
 */
```

**行为**：取 active ns 内 `isDefault: true` 的 group；找不到则取该 ns 最早创建的 group（兜底）；ns 内完全无 group 时返回 `null`。

#### 4.1.14a `getDefaultGroupId()`（修改）

> ⚠️ v1 必须改。原实现（group-model.js:29）是全局 `groups.find(g => g.isDefault)`，**不带 ns 过滤**。`addTab` action（groups.js:151-152）在 `groupId` 缺省时 fallback 到 `getDefaultGroupId()`，会把 `Alt+Shift+A` 路由到 ns=`default` 的默认 group，违反 §10 T6。

```js
/**
 * 返回 active ns 的默认分组 id。专供 `addTab` action 等「groupId 缺省」场景使用。
 * @returns {Promise<string | null>} 找不到时返回 null
 */
```

**改动**：内部读 `getActiveNamespace()`，`filter(g => g.ns === activeNs && g.isDefault)` 取首个；找不到再 fallback 到该 ns 内最早创建的 group；ns 内无 group 返回 `null`。

**重要**：这是 model 层的私有改动，调用方接口（groups.js:75 `addCurrentTabToDefaultGroup`）保持不变——它本来就要走 active ns 默认分组。

#### 4.1.15 `getGotoMenuData()`（修改）

行为不变 —— 之前就是从 model 取所有 `goto === true` 的 group，再取每个 group 的前 6 个 tab。现在因为 `goto` 操作有 ns 校验，非 active ns 的 group 不会被标 goto，所以结果天然只含 active ns 的内容。**无需显式过滤**。

#### 4.1.16 `incrementVisitCount(url, activeNs)`（修改）

```js
/**
 * 在 active ns 内的 group 中查找 url，命中的 tab 计数 +1。
 * 不在 active ns 内的 tab 一律不计数。
 * @param {string} url
 * @param {string} activeNs - 由调用方显式传入,避免内部再读一次 storage
 * @returns {Promise<boolean>} found - 是否命中(保持现有返回值,不要改成 Promise<void>)
 */
```

**关键改动**：
- **新增 `activeNs` 参数**（显式）。
- 内部查找循环用 `g.ns === activeNs` 过滤；只在该 ns 内的 group 中查找 url。
- 「active ns 内找不到匹配 url」时：保留现有语义（当前实现是「找不到就跳过，不新建 group」—— group-model.js:315-336 现状）。**v1 沿用此语义，不要在迁移时改变**。
- 保持现有返回值 `Promise<boolean>`（即 `{ found }`），不要改为 `Promise<void>`。当前 groups.js:312 已经返回 `{ success, found }`，调用方若读 `response.found` 会静默失效。

**关于 `currentTab` 参数**：删除。原 §4.1.16 草稿中误加的 `currentTab: Tab` 参数无对应行为（model 当前是「找到就 +1，找不到就跳过」，不存在「找不到就建 group / 建 tab」逻辑），属于死参数。

**调用方**：`background/groups.js`（content script 发来 `incrementVisitCount` 时由它调用）。

**关于竞态窗口（race window）**：
- adapter 层（groups.js:309）从 storage 读一次 `activeNamespace`，连同 url 一起传给 model。
- 在「adapter 读 ns」到「model 写 storage」之间，另一个 tab 可能调用 `setActiveNamespace` 切了 ns。`incrementVisitCount` 此时会用**陈旧的 activeNs** 写入。
- v1 接受这个竞态（窗口 < 1ms，统计意义可忽略）。**不要**在 model 层再读一次 ns（会绕开调用方显式传参的优化）。
- 文档化此 tradeoff 在 §7.4；future v2 可考虑「读 ns + 写操作」放入一次 `chrome.storage.session` 锁或事务。

#### 4.1.17 `clearAllGroups(opts?)`（修改）

```js
/**
 * 清空 group 域。
 * @param {{ scope?: 'active'|'all' }} [opts] - 'active' 默认，只清当前 ns；'all' 清全部 ns（带 confirm）
 * @returns {Promise<void>}
 */
```

**关键改动**：
- 默认 scope = `'active'`，只清 active ns 的 group（以及这些 group 在 `tabs` 里的对应条目）。
- scope = `'all'` 时遍历所有 ns 全部删除。
- **必须在调用方做 confirm**（见 §8.4）。

#### 4.1.18 `ensureGroupDefaults()`（修改）

见 §9「迁移计划」。

#### 4.1.19 `importGroupsAndTabs(groups, tabs)`（修改）

**改动**：
- 行为不变 —— 导入是全量替换（含全部 ns）。
- **新增校验**：导入的 payload 中若 group 缺 `ns`，补 `"default"`。
- **新增 ns 字符串校验**（防止恶意 import 绕过 §4.1.2 正则）：
  - 复用 §4.1.2 的 `validateNamespace(ns)` 函数（见下文）。
  - 任意 group 含非法 ns 时，**整次 import 拒绝**，抛 `Error("INVALID_NAMESPACE_IN_IMPORT")`，不让任何 group 写入（避免半成品状态）。
  - 合法 ns 但缺失 → 补 `"default"`。
  - 合法 ns 且存在 → 保留。

```js
/**
 * 校验 ns 字符串合法性(§4.1.2 与 §4.1.19 共用)
 * @param {unknown} ns
 * @returns {boolean}
 */
function validateNamespace(ns) {
  return typeof ns === 'string'
    && /^[\p{L}\p{N}_\- ]{1,64}$/u.test(ns);
}
```

**风险场景**：
- 恶意 / 意外 JSON 编辑：`ns: '<script>alert(1)</script>'`、``ns: '../../etc'``、`ns: 'a'.repeat(10000)` —— 全部应被拒绝。
- 防御对象：导入路径（用户在 popup 上传 JSON、手动编辑 storage 备份文件、第三方工具改写 chrome.storage）。

### 4.2 修改但语义不变的函数

| 函数 | 修改说明 |
|---|---|
| `updateGroupName(groupId, name)` | 加 ns 校验（必须是 active ns 的 group）。 |
| `openTab` / `openGroup` | 不需要 ns 校验（这些是「读 + 打开」操作，content script 永远拿 active ns 的视图）。 |
| `getGroupsByPredicate(predicate)`（若存在） | 文档说明谓词内应自带 `g.ns === activeNs` 过滤；否则结果可能混入其他 ns。 |

---

## 5. 消息协议改动

### 5.1 新增 action

| action | 入参 | 出参 | 适配层实现 |
|---|---|---|---|
| `setActiveNamespace` | `ns: string` | `{ success: true, activeNamespace }` 或 `{ error: 'INVALID_NAMESPACE' }` | `await groupModel.setActiveNamespace(ns)` |
| `getActiveNamespace` | — | `{ activeNamespace }` | `await groupModel.getActiveNamespace()` |
| `getAllGroupsAcrossNamespaces` | — | `{ groups }` | `await groupModel.getAllGroupsAcrossNamespaces()` |
| `getDefaultGroup` | — | `{ group: Group }` 或 `{ group: null }`（统一用 `group: null` 而非无 group 字段，便于前端 `result.group?.id` 判断） | `await groupModel.getDefaultGroup()` |

### 5.2 修改 action

| action | 改动 |
|---|---|
| `getGroups` | 不变 —— 自动得到 active ns 的 group（model 内部过滤）。 |
| `getAllData`（popup 用） | 不变 —— `tabs` 已经只含 active ns 的内容。 |
| `clearAllGroups` | 新增可选入参 `scope: 'active' \| 'all'`，默认 `'active'`。adapter 层转发到 `groupModel.clearAllGroups({ scope })`。 |
| `importGroupsAndTabs` | 不变 —— 全量替换（含全部 ns）。 |
| `incrementVisitCount` | adapter 层从 storage 读一次 `activeNamespace`（**这是唯一一处适配层读 settings**），连同 url 一起传入 model 的新签名 `incrementVisitCount(url, activeNs)`。返回值仍是 `Promise<boolean>`（保持 `{ success, found }` 响应），不改为 `Promise<void>`。 |

### 5.3 不变的 action

所有 tab / group 操作 action（`addGroup`、`addTab`、`moveTab`、`deleteGroup`、`openTab`、`openGroup`、`getGotoMenuData`、`getGotoGroupsFull`、`setGroupAsGoto`、`toggleGroupFocusSearch`、`setGroupsVisibility`、`setDefaultGroup`、`updateGroupName`、`sortTabsByVisitCount`、`updateBoardOrder`、`extractMarkedAsGroup` 等）—— 出参不变，语义不变，只是底层 model 多了 ns 校验。

---

## 6. UI 改动

### 6.1 Popup

**位置**：`popup/popup.html` 的 header 区（标题下方、搜索框上方），新增一行 `<div class="ns-switcher">`：

```
[ ns: ▾ 工作 ]   ← 下拉框，仅显示已存在的 ns 名
```

**数据源**：popup 启动时发 `getActiveNamespace` + `getAllGroupsAcrossNamespaces`，聚合出「所有出现过的 ns 名 + 当前 active」，渲染 `<select>`。

**事件**：
- 用户选 ns → `setActiveNamespace(newNs)`。
- 成功后 `popup.js` 重新发 `getAllData` 并重渲染整个 popup（最简单可靠，避免部分状态没刷新）。
- **stale active 兜底**：若 UI 拿到一份「active 不在已知 ns 列表里」（理论不会发生，但防御），强制把下拉框 value 拉回 storage 实际值。

**空状态**：只有 `"default"` 一个 ns 时，下拉框不显示（「单 ns 模式」），避免给用户增加多余控件。

### 6.2 Board view

**位置**：`modules/group/view.js` 的 header 工具栏（与视图切换 tab 并列），同样一个下拉框。

**数据源**：同 popup。

**事件**：
- 用户选 ns → 同样发 `setActiveNamespace` + 重渲染 board。
- board 还要监听 `chrome.storage.onChanged`，当 `activeNamespace` 变化时强制重拉（应对其他来源切换 —— 如 popup 切了 ns、content script 切了 ns）。

### 6.3 创建 ns

v1 **不**做「+ 新建命名空间」按钮。用户的隐式创建路径是：

1. 在 popup / board view 的 ns 下拉框里**直接输入**一个当前 ns 列表中没有的名字（输入框或 `<datalist>` 形式的 input + select 组合）。
2. model 的 `setActiveNamespace` 不校验 ns 是否「已存在」（见 §4.1.2），所以「切到一个还不存在的 ns」是合法动作。
3. 用户在新 ns 里创建第一个 group —— model 的 `createGroup` 自动把它标为该 ns 的 `isDefault: true`。

> 实现提示：下拉框用 `<input list="ns-list">` + `<datalist>` 即可同时支持「从已有 ns 选」和「键入新 ns」。

### 6.4 删除 ns

v1 不做（避免误删全部 group）。见 §11。

---

## 7. content script 改动

### 7.1 goto 圆环（`content/inject/goto.js`）

**刷新触发**：
- 当前是 `chrome.runtime.onMessage` 监听 `getGotoMenuData` 响应。重写为「主动轮询 + 事件触发」：
  - 启动时拉一次。
  - 监听 `chrome.storage.onChanged`，当 `settings.activeNamespace`、`groups`、`tabs` 任一变化时，重新拉一次。
  - 当 ns 切换时，**销毁旧圆环 DOM，重建新圆环**（保证圆环内容确实是新 ns 的 group）。

**单圆环保证**：v1 已经只有一个圆环，无需改 DOM 拓扑；只需要在重建前 `gotoRingEl.innerHTML = ''` 并重新填充。

### 7.2 goto manager 侧边栏（`content/gotoManagerRing.js`）

> ⚠️ 原 §7.2 草稿自相矛盾：「改用 `getAllGroupsAcrossNamespaces` + 本地 `getActiveNamespace` 过滤」与 §5.3 把 `getGotoGroupsFull` 列为「不变 action」冲突。v1 采用 §5.3 的立场：**`getGotoGroupsFull` 不变**，model 内部自然只返回 active ns 的 goto group。

**过滤器**：
- `getGotoGroupsFull` 在 model 内部走 `getAllGroups()`（§4.1.4 已加 ns 过滤），再 `filter(g => g.goto === true)` —— **结果天然只含 active ns 的 goto group**（与 `getGotoMenuData` 行为一致，见 §4.1.15）。无需额外过滤。
- content script **不**额外调 `getActiveNamespace`（避免 §5.1 列表外的内部状态传递）；不引入 `getAllGroupsAcrossNamespaces`（不需要跨 ns 视图）。
- 监听 `chrome.storage.onChanged`，当 `settings.activeNamespace`、`groups`、`tabs` 任一变化时重新拉取并重渲染。
- 切 ns 时直接销毁旧 sidebar 内容 + 重新拉取重建。

**创建 / 删除 / 重命名 group**：
- 这三个操作当前是 manager 直接发 message 给 background 的（已经走 `background/groups.js` 适配层），无需改。
- 但**必须**保证它们操作的是 active ns 的 group —— model 层的 ns 校验会强制这一点。

### 7.3 focus.js（History 分组）

**背景**：focus.js 当前在用户首次进入 focus 搜索时自动创建一个名为「History」的 group，并把搜索过的 tab 都加进去。

**改造**：
- focus.js 是 **background 内部模块**（CLAUDE.md 规约：background 内部模块直接 `import { ... } from './group-model.js'`，不走消息往返）。**不要**新增 `createHistoryGroup` message action。
- focus.js 已有的 `getOrCreateHistoryGroup`（focus.js:13-23）已直接 import `createGroup`。改造时只需：
  1. `createGroup` 内部已自动 `await getActiveNamespace()` 写入 `ns` 字段（§4.1.3），focus.js **不**显式传 `{ ns: activeNs }`。
  2. `getOrCreateHistoryGroup` 的 lookup 改为 `groups.find(g => g.name === 'History' && g.ns === activeNs)`，确保每个 ns 各取自己的 History。
- 该 ns 内已有 History group → 复用，不重复创建。
- 切 ns 后，新 ns 第一次进 focus 搜索时，**自动在该 ns 下创建一个新的 History group**（独立 groupId，因 groupId 全局唯一）。
- 删除 / 归档：v1 沿用现有逻辑（保留 group 只清 tabs）。

**与 §4.1.3 的一致性**：§4.1.3 说 `createGroup` 自动从 active ns 读 ns 并写入；§7.3 此前错写为 `createGroup('History', color, { ns: activeNs })`——这是**冗余且矛盾**的。v1 严禁显式传 `ns` 参数给 `createGroup`，统一走 model 内部隐式填充。

### 7.4 content.js（`incrementVisitCount` 触发）

**不变**：
- content.js 仍发 `incrementVisitCount` message，附 `{ url, title, favicon }`。
- `background/groups.js` 适配层收到后，**读一次 `settings.activeNamespace`**，连同 url 一起转给 `groupModel.incrementVisitCount(url, activeNs)`。
- **不要**在 model 写入函数里再隐式读 ns（adapter 已经传进来）。model 写函数统一在入口拿到 activeNs 缓存到局部变量，避免多次 storage 读。

**竞态窗口（race window）**：
- adapter 读 ns 到 model 写 storage 之间，另一个 tab 可能调 `setActiveNamespace` 切了 ns。`incrementVisitCount` 此时会用**陈旧的 activeNs** 写入。
- v1 接受此竞态（窗口 < 1ms，统计意义可忽略；详见 §4.1.16）。
- v2 可考虑：把「读 ns + 写操作」放进 `chrome.storage.session` 锁或事务。**v1 不实现**。

---

## 8. 边界 case 处理

### 8.1 `isDefault` per-ns vs 全局

- 升级时：老用户的所有 `isDefault: true` 的 group 都归到 `"default"` ns 下。
- 切到新 ns 时：UI 不主动在该 ns 下挑一个默认；model 在 `createGroup` 时自动把第一个 group 设为默认（见 §4.1.3）。
- 老代码里假设「全局只有一个 isDefault」的，需要改成「当前 ns 只有一个 isDefault」。

### 8.2 visit count ns scoping

- 见 §4.1.16。同一 URL 在 ns A 的 group 里有 5 次访问，在 ns B 的 group 里仍然从 0 开始。
- `sortTabsByVisitCount` 操作的是当前 ns 的 group（model 内部过滤），不会跨 ns 排序。

### 8.3 `clearAllGroups` 范围

- v1 默认行为：**只清当前 ns**。
- popup / board 调用前**必须**弹 confirm，文案：

  ```
  确定清空命名空间「工作」下的所有分组吗？该命名空间内的所有分组和标签页会被删除，且无法恢复。其他命名空间不受影响。
  ```

  - 显示当前 ns 名（关键，避免用户误以为是全局清空）。
  - 用户确认后调 `clearAllGroups({ scope: 'active' })`。
- 进阶：「清空所有命名空间」是 v1 的隐藏入口（不在 UI 上暴露），保留给将来。**当前不暴露**给 UI。

### 8.4 `incrementVisitCount` 范围

- 只在 active ns 内的 group 计数。
- active ns 内找不到 url → 按现有实现语义处理（迁移时不悄悄改变，见 §4.1.16）。
- adapter 层从 storage 多读一次 activeNamespace（见 §7.4）。

### 8.5 导出 / 导入

- **导出**：使用 `getAllGroupsAcrossNamespaces` + 全量 `tabs`（model 内部允许一个 export 函数 `exportAllData()`，跨 ns 读）。导出的 JSON 文件**包含 `activeNamespace`**（顶层字段），便于用户换机后保持 ns 状态。
- **导入**：全量替换（包括所有 ns 的 group 和 `settings.activeNamespace`）。导入文件缺 `activeNamespace` 时默认 `"default"`。

### 8.6 groupId 碰撞风险

- 现状：groupId 由 `generateId()` 生成，**全局**唯一。
- v1 保持现状：groupId 全局唯一，跨 ns 不复用。这样所有依赖 groupId 的代码（`tabs` map、`message` action）都不需要改。
- 如果未来支持「同 ns 内 group 名重复但 id 不同」，现有结构完全支持，无需额外改动。
- **风险点**：跨 ns 移动（v2）才会真正产生 id 重用需求；v1 不动。

### 8.7 首次启动行为

> ⚠️ **保持现有 seed 行为，不要悄悄破坏老用户的首装体验。** 原 §8.7 草稿说 `groups = []`（空），与当前 `ensureGroupDefaults`（group-model.js:354-391）行为冲突——当前实现首装会建 3 个默认分组（`工作`/`学习`/`娱乐`，见 group-model.js:361-365）+ 一个 `📄 面包` goto seed 分组（group-model.js:374-391）。若按原草稿把 groups 初始化改为空，老用户升级瞬间会看到「我之前的分组都没了」的错觉，且失去 goto 圆环的 6 个示例 tab。

**v1 行为**：
1. **fresh install**（group-model.js:360-367）：
   - `groups = [工作(isDefault), 学习, 娱乐]`，全部 `ns: "default"`。
   - 若无 `goto === true` 的 group，额外建 `📄 面包` goto seed group（group-model.js:374-391，含 6 个示例 tab）。
2. **老用户升级**：
   - `ensureGroupDefaults` 给每个 group 补 `ns: "default"`（缺失时）。
   - `activeNamespace` 缺则补 `"default"`。
   - 老的「全局默认分组」`isDefault: true` 保留，语义改为「ns=default 的默认分组」（详见 §8.1）。
   - 其他字段保持不变。
3. **其他 ns 永远是空启动**（用户主动切到一个新 ns 名时，该 ns 内零 group，用户通过 `createGroup` 隐式建第一个 group，自动成为该 ns 的 `isDefault: true`）。

**回归断言**：升级后，`getAllGroups()` 返回的 group 数与升级前**完全一致**（见 §附录 B 验证不变量 5）。任何让 group 数变少的改动都视为回归。

### 8.8 升级时的「分组显示丢失」感知

- 升级瞬间，UI 不变（仍是全部老 group）。
- 用户切到非 `"default"` 的 ns 时，老 group 全部消失 —— 这是预期行为，但必须在「切换 ns UI」tooltip / 帮助文案里写明。
- 加一个轻量提示：popup ns 下拉框的右侧加 `(?)` 帮助图标，hover 显示「切换命名空间会隐藏其他命名空间的分组，原数据不会被删除」。

### 8.9 tab 的 `ns` 字段

- `Tab` 对象**不**新增 `ns` 字段。
- 理由：tab 的归属由 `tabs[groupId]` 决定，groupId → ns 映射天然存在。给 tab 也加 ns 字段会引入冗余和「两边不同步」的风险。

### 8.10 切 ns 时正在编辑的 group 名 / 颜色

- UI 在切 ns 时强制重渲染。正在编辑的输入框直接丢弃（这是当前 popup 重渲染的既有行为，v1 沿用）。
- 不做「切 ns 前先保存未提交的编辑」的优雅处理 —— v2 再说。

---

## 9. 迁移计划

### 9.1 `ensureGroupDefaults` 改动

当前职责：补全 group 缺省字段（`goto: false`、`inFocusSearch: false`、`visible: true`）。

新职责：
1. **保持**原有行为。
2. **新增**：对每个 group，若缺 `ns`，补 `"default"`。
3. **新增**：对每个 group，若缺 `isDefault` 或 `isDefault === undefined`，保持 false（**不要自动标默认**，避免破坏老用户的默认分组设置）。
4. **新增兜底**：检查所有 `ns === "default"` 的 group，若其中没有任何 `isDefault: true`，把**最早创建**的 group（按 `groups` 数组在 storage 中的插入顺序判定 —— Chrome 序列化 JSON 对象时键顺序是有定义的，按 `chrome.storage` 的写入顺序保留）标为 `isDefault: true`。其他 ns 不动（其他 ns 在升级瞬间不可能有 group）。如果兜底无法确定先后顺序，跳过兜底，由用户首次在该 ns 创建 group 时由 `createGroup` 自动设默认（见 §4.1.3）。

### 9.2 `background/init.js` 改动

- 当前在 `install` / `startup` 时调用 `ensureGroupDefaults` 并设置 settings 默认值。
- 新增：**在 settings 默认值集合里**加 `activeNamespace: "default"`（通过 model 新函数 `ensureSettingsDefaults()` 或直接在 init.js 里写）。**不要**通过通用 `updateSettings` 写。
- 监听 `chrome.storage.onChanged` 中 `activeNamespace` 的变化 ——**不**需要额外逻辑（setter 自己负责广播）。

### 9.3 升级顺序

`install` 钩子：
1. `ensureGroupDefaults()` —— 给老 group 补 `ns`。
2. `ensureSettingsDefaults()` —— 给 settings 补 `activeNamespace`。
3. 升级完成，老用户看到的 UI 完全无变化（activeNamespace 是 `"default"`，所有老 group 也都在 `"default"`）。

### 9.4 老的「全局默认分组」History

- focus.js 升级时**不**主动建 History group（保持「懒创建」语义）。
- 老用户的旧 History group（如果有）已经在 `ensureGroupDefaults` 里被标 `ns: "default"`，继续可用。
- 新 ns 下 History group 按 §7.3 规则懒创建。

---

## 10. 测试策略

> TabBoard 没有自动化测试基础设施，全部为手动 smoke test。每个测试用例给出「前置 / 操作 / 预期」三段。

### 10.1 隔离不变量测试

**T1 — 写 ns A，切到 ns B，A 数据不可见**
- 前置：active ns = `default`，已有 2 个 group「工作A1」「工作A2」。
- 操作：发 `setActiveNamespace("study")`，创建新 group「学习B1」。
- 预期：
  - `getAllGroups()` 返回「学习B1」1 个。
  - `getAllGroupsAcrossNamespaces()` 返回 3 个（含「工作A1」「工作A2」「学习B1」）。
  - 切回 `"default"`，「学习B1」消失，「工作A1」「工作A2」重新出现。

**T2 — goto 圆环随 ns 切换**
- 前置：ns `default` 下 group A 标 goto=true，ns `study` 下 group B 标 goto=true。
- 操作：浏览器开任意 tab，分别观察 goto 圆环。
- 预期：
  - active = `default` → 圆环显示 group A 的 tab。
  - active = `study` → 圆环显示 group B 的 tab。
  - active 切换通过 `storage.onChanged` 自动触发（无需刷新页面）。

**T3 — History per-ns**
- 前置：active = `default`，进入 focus 搜索任意关键字。
- 操作：搜索后切到 `study`，再次进入 focus 搜索。
- 预期：
  - ns `default` 下有一个名为「History」的 group，含搜索过的 tab。
  - ns `study` 下有一个**新的**名为「History」的 group（含独立 groupId），含新搜索过的 tab。
  - 切回 `default`，History 仍然是「原来的那个」。

**T4 — visit count per-ns**
- 前置：ns `default` 下有 group「工作」含 tab X（访问 5 次）。
- 操作：切到 `study`，访问同一 URL X 3 次。
- 预期：
  - `default` 下「工作」的 tab X `visitCount === 5`。
  - `study` 下要么没有 tab X（如果没在 `study` 创建过 group），要么 `study` 内的 group 里 tab X `visitCount === 3`（如果在 `study` 创建过）。
  - **关键断言**：切回 `default`，tab X 的 `visitCount` 仍是 5（不被 ns `study` 内的访问污染）。

### 10.2 关键路径测试

**T5 — popup / board 切换 ns**
- 操作：在 popup 下拉框切 ns，board view 是否同步刷新？
- 预期：board 自动重渲染，header 下拉框的 value 也跟 popup 同步。

**T6 — `addCurrentTabToDefaultGroup` 走 active ns**
- 前置：active = `study`，ns `study` 有默认 group「学习默认」。
- 操作：按 `Alt+Shift+A` 把当前页加入默认分组。
- 预期：tab 加到「学习默认」，**不是** ns `default` 下的默认 group。

**T7 — `clearAllGroups` 只清 active ns**
- 前置：ns `default` 有 2 个 group、ns `study` 有 1 个 group。
- 操作：active = `study`，发 `clearAllGroups({ scope: 'active' })`。
- 预期：
  - `study` 下 group 数变 0。
  - `default` 下 group 不受影响。
  - popup 文案显示「确定清空命名空间「study」下的所有分组吗？」。

**T8 — gotoManager 侧边栏只显示 active ns 的 goto group**
- 前置：ns `default` 有 2 个 goto group、ns `study` 有 1 个 goto group。
- 操作：active = `default`，打开侧边栏。
- 预期：侧边栏显示 2 个 group（ns `default` 的）。切到 `study` 显示 1 个 group。

### 10.3 边界 / 回归测试

**T9 — 跨 ns 写入被拒绝**
- 操作：active = `default`，尝试通过 `addTab(tab, groupIdFromStudyNs)`。
- 预期：抛 `CROSS_NAMESPACE_WRITE`，tab 不写入。

**T10 — 导出包含所有 ns**
- 操作：ns `default` 有 2 个 group、ns `study` 有 1 个 group，导出。
- 预期：导出 JSON 包含全部 3 个 group + `activeNamespace: "default"`（即当前 active 的）。

**T11 — 导入全量替换**
- 前置：本地有 ns `default` 和 `study`。
- 操作：导入一份只含 ns `work` 的备份。
- 预期：本地 `default` 和 `study` 全部消失，只剩导入的 `work`。`activeNamespace` 变为 `"default"`（导入文件缺该字段时的默认值）。

**T12 — 升级老用户无感**
- 前置：模拟老 storage（group 无 `ns`，settings 无 `activeNamespace`）。
- 操作：触发 `ensureGroupDefaults` + `ensureSettingsDefaults`。
- 预期：所有 group 获得 `ns: "default"`，settings 获得 `activeNamespace: "default"`。UI 显示与升级前完全一致。

**T13 — 切 ns 后再切回，原数据完整**
- 操作：ns `default` → 切 `study` → 创建 group「学习1」+ 加 3 个 tab → 切回 `default` → 再切回 `study`。
- 预期：group「学习1」和 3 个 tab 完整存在。

**T14 — content script 单圆环**
- 前置：ns `default` 下 goto group A 含 tab a1；ns `study` 下 goto group B 含 tab b1。
- 操作：active = `default`，goto 圆环显示 a1；切到 `study`，圆环内容**就地替换**为 b1。
- 预期：DOM 中始终只有一个 `.goto-ring` 节点（不出现两个圆环叠加）。

---

## 11. 未决 / 留给未来

| 项 | 说明 | 影响 |
|---|---|---|
| 创建 ns 的 UI | v1 允许「切到新 ns 名 + 自动建第一个 group」的隐式路径；不做显式「+ 新建命名空间」按钮。 | 用户认知：「我什么时候多了一个 ns？」需要在文档里说清楚。 |
| 删除 ns | v1 不暴露。ns 内 group 全删后 ns「空」但仍存在；用户可继续往里加 group。 | 误操作风险低；不需要「空 ns 列表」。 |
| 重命名 ns | v1 不暴露。ns 名只用作内部标识，UI 永远用「这个名字」展示。 | UI 上的 ns 名和实际 ns id 是否一致需要核对；建议 v1 把 ns 名当作内部 id，不引入「显示名」概念。 |
| 跨 ns 移动 group / tab | v1 禁止（model 抛错）。v2 考虑「拖拽到 ns 边界」。 | 暂时用户只能在新 ns 重建。 |
| ns 级导出 | v1 只支持全量。 | 大数据量用户可能需要按 ns 导出备份。 |
| ns 元数据（图标 / 描述 / 创建时间） | v1 只有 ns 名。 | UI 难以做 ns 列表展示；未来加 ns 卡片视图时会用到。 |
| popup 重渲染时机 | v1 切 ns 后整个 popup 重渲染。 | 大数据量下可能有闪烁，v2 考虑局部刷新。 |
| 切 ns 时未保存编辑的丢失 | v1 沿用「重渲染即丢」。 | 详见 §8.10。 |
| 老的「全局 History」自动迁移到「ns=default History」 | v1 隐式处理（依赖 `ensureGroupDefaults` 给老 History group 补 `ns: "default"`）。 | 大部分情况无感。 |
| 多 ns 同时打开 board | v1 不做（一次只能看一个 ns）。 | 复杂 UI 工作量大，先验证 ns 概念本身。 |

---

## 附录 A — 文件改动清单

| 文件 | 改动类型 |
|---|---|
| `background/group-model.js` | **核心**：新增 `getActiveNamespace` / `setActiveNamespace` / `getAllGroupsAcrossNamespaces` / `getDefaultGroup`，修改 `createGroup` / `getDefaultGroupId` / `getAllGroups` / `getAllTabs` / `addTabToGroup` / `moveTab` / `deleteGroup` / `setGroupAsGoto` / `toggleGroupFocusSearch` / `setGroupsVisibility` / `setDefaultGroup` / `getGotoMenuData` / `incrementVisitCount` / `clearAllGroups` / `importGroupsAndTabs` / `ensureGroupDefaults` |
| `background/groups.js` | 适配层：新增 `setActiveNamespace` / `getActiveNamespace` / `getAllGroupsAcrossNamespaces` / `getDefaultGroup` 分发；`incrementVisitCount` handler 多读一次 `activeNamespace` 并转调新签名 |
| `background/init.js` | 调用 `ensureSettingsDefaults()`，settings 默认值加 `activeNamespace` |
| `background/focus.js` | History group 创建走 `createGroup`，自动带 active ns（已通过 model 内部 `getActiveNamespace` 实现） |
| `content/inject/goto.js` | 监听 `storage.onChanged` 重建圆环 |
| `content/gotoManagerRing.js` | `getGotoGroupsFull` 不变（model 内部已按 ns 过滤）；监听 `storage.onChanged` 自动重渲染 |
| `content/content.js` | 不变（仍发 `incrementVisitCount`） |
| `popup/popup.html` | header 区新增 ns 下拉框 DOM |
| `popup/popup.js` | 启动时拉 `getActiveNamespace` + `getAllGroupsAcrossNamespaces`，渲染下拉框；切换时发 `setActiveNamespace` + 重渲染 |
| `popup/popup.css` | ns 下拉框样式 |
| `modules/group/view.js` | board view header 新增 ns 下拉框；监听 `storage.onChanged` 自动重渲染 |
| `modules/group/index.js` | 不变 |
| `modules/group/css/...` | ns 下拉框样式（如有独立 css 文件） |
| `manifest.json` | 不变 |

## 附录 B — 验证不变量

> 这些不变量直接来自 CLAUDE.md「Group 数据访问规约」。任一违反即视为回归。

1. `chrome.storage.local.get(['groups'])` / `chrome.storage.local.get(['tabs'])` / `chrome.storage.local.set({ groups })` / `chrome.storage.local.set({ tabs })` 的调用点**只**出现在 `background/group-model.js` 内。其他模块（含 groups.js adapter、popup、board view、content script）一律禁止。
2. `settings.activeNamespace` 的写入**只**出现在 `background/group-model.js` 的 `setActiveNamespace` 函数内。**禁止**通过通用 `updateSettings` action 写 `activeNamespace`（CLAUDE.md §3.2 规约）。
3. 新增字段 `Group.ns` 的读取 / 写入**只**通过 model 暴露的函数：
   - 读：`getActiveNamespace` / `getAllGroups` / `getAllGroupsAcrossNamespaces` / `getDefaultGroup` / `getDefaultGroupId`（§4.1）。
   - 写：`setActiveNamespace` / `createGroup`（自动写入 active ns）/ `importGroupsAndTabs`（含校验）。
   - **禁止**任何模块直接 `chrome.storage.local.get/set(['settings'])` 拿 `activeNamespace` —— 包括 groups.js adapter；只有 `incrementVisitCount` adapter handler 例外（§7.4）。
4. `background/groups.js` 适配层不持有「当前 ns」缓存 —— 每次消息处理都从 model 重新读，避免 ns 在中途被切导致脏读。
5. `background/focus.js` / `goto.js` 等 background 内部模块**直接 import** `{ createGroup, ... } from './group-model.js'`，**不**通过 `chrome.runtime.sendMessage` 走消息往返（CLAUDE.md §规约）。
6. `content/inject/goto.js` 的 goto 圆环 DOM 在 ns 切换时被销毁重建，而不是「刷新内容」。
7. 老用户升级后，`getAllGroups()` 返回的 group 数与升级前一致（首装 seed 行为保留：3 个默认分组 + 1 个 📄 面包 goto seed，详见 §8.7）。
8. importGroupsAndTabs 对非法 ns 字符串（含 XSS / 路径穿越 / 超长字符串）整批拒绝，不允许半成品状态（§4.1.19）。
