# Group Namespace 实施计划

> 来源 spec: `docs/superpowers/specs/2026-09-04-group-namespace-design.md`
> 日期: 2026-09-04
> 计划范围: spec §4-§9 + §附录 A 的 14 文件改动
> 落地方式: 严格按 model → adapter → focus → UI → content → 验证 的依赖顺序串行合入

## 简介与全局约束

本计划为 **Group Namespace（分组命名空间）** 功能落地，每个步骤一个 atomic edit，足以交给一个 LLM subagent 在单次会话内完成。

### 改动文件清单（按依赖分层）

| 层 | 文件 | 改动 |
|---|---|---|
| model | `background/group-model.js` | 新增 6 函数；改 13 函数；加 `ns` 校验；加 ns 字符串校验 |
| model | `background/init.js` | 新增 `ensureSettingsDefaults()` 调用；install 钩子顺序化 |
| adapter | `background/groups.js` | 新增 4 个 action 分发；改 `incrementVisitCount` handler（多读 activeNamespace） |
| adapter | `background/focus.js` | `getOrCreateHistoryGroup` 按 `ns` 过滤；不改消息协议 |
| UI (popup) | `popup/popup.html` | header 区加 `<div class="ns-switcher">` DOM（含 `<datalist>` + `<input>`） |
| UI (popup) | `popup/popup.js` | 启动拉 active + across-ns；切 ns 后重渲染；监听 storage.onChanged |
| UI (popup) | `popup/popup.css` | ns-switcher 样式（与现有 header 一致） |
| UI (board) | `modules/group/view.js` | header 加 ns 下拉框；切换重渲染；监听 storage.onChanged |
| UI (board) | `modules/group/style.css` | ns 下拉框样式（如未合并到 popup.css） |
| content | `content/inject/goto.js` | 监听 storage.onChanged，变化时 `gotoRingEl.innerHTML = ''` 重建 |
| content | `content/gotoManagerRing.js` | 同上，监听 + 销毁侧边栏 DOM + 重新拉取 |
| content | `content/content.js` | **不变**（仍发 incrementVisitCount；adapter 层已做翻译） |

### 阶段顺序与依赖图

```
Phase 1 (Model) ─── Phase 2 (Adapter) ─── Phase 4 (Focus/History)
                            │
                            ↓
            Phase 3 (Popup UI) + Phase 4 (Board UI)
                            │
                            ↓
                Phase 6 (Content scripts)
                            │
                            ↓
                   Phase 7 (Final verification)
```

**重要**：Phase 1 完成且**所有** Phase 1 测试通过前，不要开始 Phase 2。Phase 3 必须等 Phase 2（依赖新增 action），但与 Phase 4（focus 改造）互相独立。Phase 5 必须在 Phase 3/4 完成后。Phase 6 等 Phase 2。Phase 7 永远最后。

---

## Phase 1 — Model 层 (`background/group-model.js` + `background/init.js`)

### 步骤 1.1 — 引入共享 `validateNamespace` 工具函数

**文件**: `background/group-model.js`

**改动说明**：
在文件顶部 `DEFAULT_GROUP_MAX_TABS` 之后添加 `validateNamespace(ns)` 函数（按 spec §4.1.19 字符集规则：`/^[\p{L}\p{N}_\- ]{1,64}$/u`）。同步添加一个 `NAMESPACE_NAME_MAX = 64` 常量与 `DEFAULT_NAMESPACE = 'default'` 常量，便于后面所有函数复用。**不要**导出此函数（model 内部专用；外部通过 `setActiveNamespace` 间接使用）。

**verify**：
- 在 `node --eval` 或 manual unit smoke：导入本文件后调 `validateNamespace('工作')` → `true`；调 `validateNamespace('<script>')` → `false`；调 `validateNamespace('a'.repeat(65))` → `false`。
- 在 `chrome://extensions` 开发者模式 reload 后 Console：`import('./background/group-model.js').then(m => console.log(typeof m.validateNamespace))` → 应该是 `undefined`（确认未导出）。

---

### 步骤 1.2 — 新增 `getActiveNamespace()` / `setActiveNamespace(ns)` 读写对

**文件**: `background/group-model.js`

**改动说明**：
按 spec §4.1.1、§4.1.2：
- `getActiveNamespace()`：用 `chrome.storage.local.get(['settings'])` 读 settings；缺 settings / 缺 `activeNamespace` / 类型错误 / 空串 一律回退 `'default'`；非字符串时 `console.warn` 后回退。
- `setActiveNamespace(ns)`：调 `validateNamespace(ns)` 校验；失败抛 `Error('INVALID_NAMESPACE')`；成功则 `chrome.storage.local.set({ settings: {...current, activeNamespace: ns} })`，**不** 直接覆盖整个 settings。
- 把 `DEFAULT_NAMESPACE` 替换到所有默认值位置。
- 在文件末尾 export 列表新增这两个函数。

**verify**：
- 手动 smoke：DevTools console 跑
  ```js
  await chrome.storage.local.clear();
  await import('./background/group-model.js').then(m => m.getActiveNamespace()); // → 'default'
  ```
- 设一个非法值：
  ```js
  await m.setActiveNamespace('');  // → throw Error 'INVALID_NAMESPACE'
  await m.setActiveNamespace('<script>');  // → throw Error 'INVALID_NAMESPACE'
  await m.setActiveNamespace('study'); await m.getActiveNamespace(); // → 'study'
  ```
- 确认 settings 中除 `activeNamespace` 外其他 key 未被覆盖（先建一个测试 key 再改 ns）。

---

### 步骤 1.3 — 修改 `getGroups()` → `getAllGroups()` 为 ns 过滤读

**文件**: `background/group-model.js`

**改动说明**：
按 spec §4.1.4 重命名：
- `getGroups` → `getAllGroups`：内部 `await getActiveNamespace()`，filter `g.ns === activeNs`；缺 ns 当 default。
- **保留**一个 `@deprecated` 别名 `getGroups` 直接 `return getAllGroups()`，避免一次性动太多 caller（但**这一段要在 PR-A 末尾合并 PR-A 收尾的步骤 1.18 里彻底删掉**）。
- `getGroupsAcrossNamespaces`（spec §4.1.5）**同时**新增并导出。

> ⚠️ 本步骤**只是行为变化 + 新增导出**，不批量改所有调用方。批量改 caller 留到 Phase 2 adapter + Phase 4 focus。

**verify**：
- 写入 3 个 group：`{ ns: 'default', ... }`、`{ ns: 'default', ... }`、`{ ns: 'study', ... }`，settings.activeNamespace='default'。
- `await m.getAllGroups()` → 2 个；`await m.getAllGroupsAcrossNamespaces()` → 3 个。
- 切到 `study`：`await m.getAllGroups()` → 1 个。

---

### 步骤 1.4 — 修改 `createGroup` 自动注入 `ns`

**文件**: `background/group-model.js`

**改动说明**：
按 spec §4.1.3：
- 入参签名从位置参数改成对象：`createGroup({ name, color, isDefault = false, goto = false, inFocusSearch = false, visible = true })`（**这一改是破坏性**。Phase 2 adapter 同步修，详见步骤 2.1）。
- 实现：写 group 前 `await getActiveNamespace()`，生成的 object 加 `ns: activeNs`。
- 若 active ns 内已有 `isDefault === true` group，新 group 强制 `isDefault = false`；否则自动成为 `isDefault = true`。
- 保留 `seedGroupTabs` 接口与 `ensureGroupDefaults` 中 `createGroup(...)` 调用（这些已经在用对象参数）。

**verify**：
- 新建一个 group：`await m.createGroup({ name: 'A', color: '#fff' })` → 返回的 group 含 `ns: 'default'`。
- 在 `study` ns 下再建一个 group → `ns: 'study'`。
- 切回 `default` 再建一个 group `B`，`A.isDefault` 保持 `true`（不被新 group 抢占）。

---

### 步骤 1.5 — 修改 `getTabsMap()` 为 ns 过滤读，新增 `getAllTabsMapAcrossNamespaces()`

**文件**: `background/group-model.js`

**改动说明**：
按 spec §4.1.6：
- `getTabsMap()` 重命名为 `getAllTabs()`：先 `await getAllGroups()` 取 active ns 的 groupIds，然后只 return `tabs[groupId]` 中属于 groupIds 的 entry。
  - 实际写法：先取 active ns groups（id 集合），再读 `tabs`，过滤 `groupId ∈ activeGroupIds`。
- **不**重命名底层对象字面量 key（`tabs`），仍用 `{ [groupId]: Tab[] }`。
- 新增 `getAllTabsAcrossNamespaces()`：返回全量 tabs（跨 ns），供 export 用。
- 保留 `@deprecated getTabsMap` 别名。

**verify**：
- 设两个 group（一个 default / 一个 study），各自加 2 个 tab。
- active=default：`await m.getAllTabs()` → 2 个 groupId 入口；切到 study → 另一个 groupId 入口。
- `getAllTabsAcrossNamespaces()` → 全部。

---

### 步骤 1.6 — 修改 `addTabToGroup` / `moveTab` / `deleteGroup` 跨 ns 校验

**文件**: `background/group-model.js`

**改动说明**：
按 spec §4.1.7、§4.1.8、§4.1.9：
- `addTabToGroup(tab, groupId, opts)`：在拿到 groups 后先查找 `targetGroup = groups.find(g => g.id === groupId)`，不存在抛 `'GROUP_NOT_FOUND'`；若 `targetGroup.ns !== activeNs` 抛 `'CROSS_NAMESPACE_WRITE'`。
- `moveTab(payload)`：拿到 fromGroup / toGroup 两个 group；若它们 `ns` 不一致或都不等于 active ns，抛 `'CROSS_NAMESPACE_MOVE'`。
- `deleteGroup(groupId)`：类似，跨 ns 抛 `'CROSS_NAMESPACE_DELETE'`。被删 group 是 active ns 的 `isDefault: true` 时不自动迁移默认（保持 spec §4.1.9 附则）。
- `updateGroupName` / `setDefaultGroup`（spec §4.2）同样加 ns 校验。

**verify**：
- active=default，尝试给 study ns 的 groupId 调 `addTabToGroup({...}, 'study-id')` → 抛 `CROSS_NAMESPACE_WRITE`。
- active=default，尝试 move across groups where one is in study → `CROSS_NAMESPACE_MOVE`。
- active=default，delete default ns 的 isDefault group 后，`getDefaultGroupId()` 返回 `null`（不应自动 fallback 到其他 ns 的 group）。

---

### 步骤 1.7 — 修改 `setGroupAsGoto` / `toggleGroupFocusSearch` / `setGroupsVisibility` 跨 ns 校验

**文件**: `background/group-model.js`

**改动说明**：
按 spec §4.1.10-§4.1.12：
- 三个函数在动手前取 `await getActiveNamespace()`，对传入的 groupId 做 `find(g => g.id === groupId && g.ns === activeNs)` 校验。
- 跨 ns 依次抛 `'CROSS_NAMESPACE_GOTO'` / `'CROSS_NAMESPACE_FOCUS'` / `'CROSS_NAMESPACE_VISIBILITY'`。
- `setGroupsVisibility`：对列表中任一非法 id，按 spec 选「整批拒绝」语义（保证调用方能立刻发现错误；避免半成品写入）。

**verify**：
- 在 `study` ns 下建一个 group，goto: false。active=default，尝试 `await m.setGroupAsGoto(study-group-id, true)` → 抛错。
- `setGroupsVisibility([legit-default-id, study-id])` → 抛 `CROSS_NAMESPACE_VISIBILITY`。

---

### 步骤 1.8 — 修改 `getDefaultGroupId` 为 per-ns，新增 `getDefaultGroup`

**文件**: `background/group-model.js`

**改动说明**：
按 spec §4.1.14、§4.1.14a：
- `getDefaultGroupId()`：先 `getActiveNamespace()`，filter `g.ns === activeNs && g.isDefault`，取首个；没有则 fallback 到 active ns 内 `groups[0]`；active ns 完全空 → return `null`（**不是 undefined**）。
- 新增 `getDefaultGroup()`：返回完整 group 对象；找不到时 `null`。
- `getGotoMenuData` / `getGotoGroupsFull`：保持 signature；model 内部走 `getGroups`（已被过滤）的产物，**自然**只含 active ns 的 goto group。**无需显式过滤**——这是 spec §4.1.15 重点。

**verify**：
- 在 default ns 建 isDefault=true 的 group，在 study ns 也建 isDefault=true 的 group（通过先切到 study 再 createGroup 走自动默认）。
- active=default：`getDefaultGroupId()` → default ns 的 isDefault group id。
- 切到 study：`getDefaultGroupId()` → study ns 的 isDefault group id。
- 在新空 ns（无 group）下：`getDefaultGroup()` → `null`。

---

### 步骤 1.9 — 修改 `incrementVisitCount(url, activeNs)` 签名 + ns scoping

**文件**: `background/group-model.js`

**改动说明**：
按 spec §4.1.16：
- 函数签名改为 `incrementVisitCount(url, activeNs)`：`activeNs` 必须由调用方显式传入；model 内部**不再**读 settings。
- 循环里先过滤 `g.ns === activeNs` 只在 active ns 内查找。
- 仍返回 `Promise<boolean>`（found）。
- 行为兼容：active ns 内找不到 url → 不新建 group（保持现状）。
- 在 JSDoc 中显式记录 race window（spec §4.1.16 末尾）。

**verify**：
- 两 ns 各建一个 group（同名不同 id），各加一个相同 URL 的 tab。
- `await m.incrementVisitCount('https://example.com', 'default')` → `true`，且只 default 里的 tab.visitCount +1。
- `await m.incrementVisitCount('https://example.com', 'study')` → `true`，只 study 里的 +1。

---

### 步骤 1.10 — 修改 `clearAllGroups({ scope })` + `importGroupsAndTabs` + `exportAllData`（如缺则补）

**文件**: `background/group-model.js`

**改动说明**：
按 spec §4.1.17、§4.1.19、§8.5：
- `clearAllGroups({ scope = 'active' } = {})`：
  - scope='active'：取 active ns 的 groupId 集合，filter 删除；tabs 同步清理这些 groupId。
  - scope='all'：全清。
- `importGroupsAndTabs(groups, tabs)`：
  - 先对每个 group 做 `validateNamespace(ns)`（缺则补 'default'，不合规则整批 reject `'INVALID_NAMESPACE_IN_IMPORT'`）。
  - 校验通过才写 storage。
- 新增 `exportAllData()`：返回 `{ groups: await getAllGroupsAcrossNamespaces(), tabs: await getAllTabsAcrossNamespaces(), settings: await chrome.storage.local.get(['settings']), activeNamespace: await getActiveNamespace() }`。

**verify**：
- 两个 ns 都有 group，`clearAllGroups({ scope: 'active' })` 在 active=default 时只清 default。
- import 一份 group 数组，其中一个 group 的 `ns: '<xss>'`：调用方应捕获 `'INVALID_NAMESPACE_IN_IMPORT'`，storage 状态未变。
- export 包含 `activeNamespace` 字段。

---

### 步骤 1.11 — 修改 `ensureGroupDefaults` 做 ns 字段补全 + isDefault 兜底

**文件**: `background/group-model.js`

**改动说明**：
按 spec §9.1：
- 在原 group 字段补全循环里追加：
  ```js
  if (g.ns === undefined) { g.ns = 'default'; groupsUpdated = true; }
  ```
- **追加兜底**：检查所有 `ns === 'default'` 的 group，若全部 `!isDefault`，把数组中**第一个** group 标 `isDefault: true`。其他 ns 不动（升级瞬间无 group）。
- 保持首装 seed 行为**完全不变**（3 个默认 + 📄 面包 goto），只是 seed 的 group 都补 `ns: 'default'`。

**verify**：
- 模拟老 storage：`chrome.storage.local.set({ groups: [{ id:'a', name:'X', isDefault:true }, { id:'b', name:'Y' }] })`，清 settings。
- 调 `ensureGroupDefaults()` 后：两个 group 都获得 `ns: 'default'`；第一个仍是 isDefault（已经 true，兜底无副作用）。
- 验证不变量 7：seed 后 `getAllGroups()` 返回的 group 数 = 4（3 默认 + 1 面包），与 spec §8.7 一致。

---

### 步骤 1.12 — 新增 `ensureSettingsDefaults()` 并改造 `background/init.js`

**文件**: `background/init.js`, `background/group-model.js`

**改动说明**：
- 在 `group-model.js` 新增 `ensureSettingsDefaults()`：读 settings；缺 `activeNamespace` 或不是合法 ns → 补 `'default'`；写回 settings。
- 把 `ensureSettingsDefaults` 和 `ensureGroupDefaults` 加入 export。
- 修改 `background/init.js` 的 install / startup 钩子：
  - 顺序：`ensureGroupDefaults()` → `ensureSettingsDefaults()`。
  - **不要**经过通用 `updateSettings` message path（spec §3.2）。

**verify**：
- 清 storage 后调 `ensureGroupDefaults(); await m.ensureSettingsDefaults();` → settings 含 `activeNamespace: 'default'`。
- 模拟老用户：`chrome.storage.local.set({ settings: { unrelatedKey: 1 } })` → 调 `ensureSettingsDefaults` 后 settings 多出 `activeNamespace`，`unrelatedKey` 不丢。

---

### 步骤 1.13 — 清理 `@deprecated` 别名 + 校验 export 列表完整

**文件**: `background/group-model.js`

**改动说明**：
- 删除步骤 1.3/1.5 加的 `getGroups` / `getTabsMap` deprecated 别名（**仅在确认所有 caller 已迁移到新函数后才删**；这一步骤在 Phase 1 收尾、Phase 2 adapter 完成后执行）。
- 校对 export 列表：所有改过的 + 所有新增的都要导出（特别注意 `getAllGroups`、`getAllTabs`、`getAllGroupsAcrossNamespaces`、`getAllTabsAcrossNamespaces`、`getActiveNamespace`、`setActiveNamespace`、`getDefaultGroup`、`getDefaultGroupId`（已存在，注意是否被改名）、`exportAllData`）。

**verify**：
- `node -e "import('./background/group-model.js').then(m => console.log(Object.keys(m).sort()))"` 列出全部 export，与 spec §附录 A 函数表逐项核对。
- grep `background/*.js` 内代码确认**除 group-model.js 外**再无 `chrome.storage.local.get(['groups'])` / `set({ groups })` / `set({ tabs })` / `set({ settings })`（不变量 1、3）。

> 注：本步骤必须在 Phase 2 adapter 全部改完后执行，因为删除别名之前所有 caller 必须先切换到新名字。

---

## Phase 2 — Adapter 层 (`background/groups.js`)

> 依赖：Phase 1 全部完成（model 新函数已 export）。

### 步骤 2.1 — 切换所有 caller 从 `getGroups` / `getTabsMap` 到新名字

**文件**: `background/groups.js`

**改动说明**：
- 把 adapter 内所有 `groupModel.getGroups()` → `groupModel.getAllGroups()`。
- 把 `groupModel.getTabsMap()` → `groupModel.getAllTabs()`。
- `groupModel.createGroup(args)` 调用站点：`args` 已经是对象参数，与 spec §4.1.3 重构后的签名兼容，无需改调用方格式，仅确认参数不变。
- 改完跑一次 Phase 7 的不变量 grep。

**verify**：
- `rg 'groupModel\.getGroups\b' background/groups.js` → 0 命中（确认全部切到 `getAllGroups`）。
- `rg 'groupModel\.getTabsMap\b' background/groups.js` → 0 命中。
- reload 扩展，console 无 error。

---

### 步骤 2.2 — 新增 4 个 message action：`getActiveNamespace` / `setActiveNamespace` / `getAllGroupsAcrossNamespaces` / `getDefaultGroup`

**文件**: `background/groups.js`

**改动说明**：
按 spec §5.1 在 switch-case 中加 4 个 case：
- `getActiveNamespace`：return `{ activeNamespace: await groupModel.getActiveNamespace() }`。
- `setActiveNamespace({ ns })`：try/catch catch `INVALID_NAMESPACE` → return `{ error: 'INVALID_NAMESPACE' }`；成功 return `{ success: true, activeNamespace: ns }`。
- `getAllGroupsAcrossNamespaces`：return `{ groups: await groupModel.getAllGroupsAcrossNamespaces() }`。
- `getDefaultGroup`：return `{ group: await groupModel.getDefaultGroup() }`（找不到时 `{ group: null }`，**统一字段名 group**便于前端 `result.group?.id` 兜底）。

**verify**：
- 在 popup DevTools console 发 `chrome.runtime.sendMessage({ action: 'getActiveNamespace' }, console.log)` → `{ activeNamespace: 'default' }`。
- 发 `chrome.runtime.sendMessage({ action: 'setActiveNamespace', ns: '' })` → `{ error: 'INVALID_NAMESPACE' }`。
- 切换 ns 后 `getActiveNamespace` 反映新值。

---

### 步骤 2.3 — 改造 `incrementVisitCount` adapter handler

**文件**: `background/groups.js`

**改动说明**：
按 spec §5.2、§7.4：
- handler 从 `{ url, title, favicon }` 中取 `url`。
- 多读一次 `chrome.storage.local.get(['settings'])` 取 `activeNamespace`（**这是 adapter 层唯一一次读 settings**，spec §附录 B 不变量 3 的例外）。
- 转调 `groupModel.incrementVisitCount(url, activeNamespace)`。
- 返回值仍是 `{ success, found }`（不要改成 `{ success }`）。

**verify**：
- 写两个 ns 各一个 tab 同 URL，分别在两个 ns 下 reload 页面触发 content script incrementVisitCount。
- console 后台记录 `found: true` 两次，分别命中各自 ns 的 tab。
- 不变量 grep：仅 `background/groups.js` 的 `incrementVisitCount` handler 内**一处** `chrome.storage.local.get(['settings'])`。

---

### 步骤 2.4 — `clearAllGroups` action 适配新 opts 参数

**文件**: `background/groups.js`

**改动说明**：
- handler 取 `message.scope`（缺省 `'active'`），转 `groupModel.clearAllGroups({ scope })`。
- 在 handler 入口**不做** confirm（confirm 在 UI 层做；adapter 只负责转发；spec §8.3 兜底）。

**verify**：
- 发 `chrome.runtime.sendMessage({ action: 'clearAllGroups' })` → 默认清 active ns。
- 发 `{ action: 'clearAllGroups', scope: 'all' }` → 全清（需要 confirm UI 配合；这一步只验 adapter 转发）。

---

## Phase 3 — Focus / History 模块 (`background/focus.js`)

> 依赖：Phase 1 完成（model 的 `createGroup` 已支持 ns + `ensureGroupDefaults`）。

### 步骤 3.1 — `getOrCreateHistoryGroup` 加 ns 过滤

**文件**: `background/focus.js`

**改动说明**：
按 spec §7.3：
- 函数 lookup 改为：
  ```js
  const groups = await groupModel.getAllGroups();
  const activeNs = await groupModel.getActiveNamespace();
  let hist = groups.find(g => g.name === 'History' && g.ns === activeNs);
  ```
- 找不到时调 `groupModel.createGroup({ name: 'History', color: '#xxx', ... })`（**不**显式传 ns）。
- **不**新增 message action（`focus.js` 是 background 内部模块，按 spec §7.3 / CLAUDE.md 规约）。

**verify**：
- active=default 进入 focus 搜索 → ns=default 下出现「History」group（含 tab）。
- active=study 在 study ns 下进入 focus 搜索 → 新建一个**另一个** id 的 History group（groups 数 +1，不与 default 的合并）。
- 切回 default → History group 仍是原 id。

---

## Phase 4 — Popup UI (`popup/popup.html` + `popup/popup.js` + `popup/popup.css`)

> 依赖：Phase 2 完成（4 个 action 已可用）。

### 步骤 4.1 — popup.html 添加 ns-switcher DOM

**文件**: `popup/popup.html`

**改动说明**：
按 spec §6.1：
- 在 header 区（标题下方、搜索框上方）添加：
  ```html
  <div class="ns-switcher" hidden>
    <label for="ns-input">ns:</label>
    <input id="ns-input" list="ns-list" autocomplete="off" />
    <datalist id="ns-list"></datalist>
    <span class="ns-help" title="切换命名空间会隐藏其他命名空间的分组，原数据不会被删除">?</span>
  </div>
  ```
- 默认 `hidden`，等 popup.js 判定有 ≥2 个 ns 后才显示（spec §6.1 空状态）。

**verify**：
- DevTools 查 popup DOM，确认 `.ns-switcher` 存在但 hidden。
- 单 ns 场景下保持隐藏。

---

### 步骤 4.2 — popup.js 启动时拉 ns 列表并渲染下拉框

**文件**: `popup/popup.js`

**改动说明**：
按 spec §6.1：
- 新增 `async function loadNamespaceSwitcher()`：
  - 并发发 `getActiveNamespace` + `getAllGroupsAcrossNamespaces`。
  - 从 groups 聚合出 ns 集合（`new Set(groups.map(g => g.ns))`，加入 active 兜底）。
  - 个数 ≥2 才显示 `.ns-switcher`，填 `<datalist>` 的 options，并设 `<input>` 的 value = active ns。
  - 单 ns 时保持 hidden，不渲染。
- 在 `DOMContentLoaded` 主流程 `loadAllData` 之前（或同时并发）调 `loadNamespaceSwitcher()`。

**verify**：
- 仅 default ns 时下拉框 hidden。
- 切到 study（active=study）后 reload popup → 下拉框可见，datalist 含 `default`、`study`，value=`study`。
- 点击切换 → 调 `setActiveNamespace`，通过 storage.onChanged 触发后续重渲染。

---

### 步骤 4.3 — popup.js 切换 ns 时发 `setActiveNamespace` 并重渲染

**文件**: `popup/popup.js`

**改动说明**：
按 spec §6.1 事件：
- input 监听 `change`（或防抖 `input`）→ 调 `chrome.runtime.sendMessage({ action: 'setActiveNamespace', ns: inputValue })`。
- 错误响应 `{ error: 'INVALID_NAMESPACE' }` 时：UI 提示 + 把 input value 回退到 storage 实际 active ns。
- 成功响应：直接 `loadAllData()` 重渲染整个 popup（spec §6.1 「最简单可靠」）。
- 同步监听 `chrome.storage.onChanged`：当 `settings.activeNamespace` 变化（来自其他来源切了 ns）→ `loadNamespaceSwitcher()` 同步 input.value + `loadAllData()`。

**verify**：
- 手动输入 `study`（不在列表里）→ 弹错（ILLEGAL 校验）或成功创建并自动重渲染（取决于 spec §4.1.2 是否显式拒绝未知 ns；当前 spec 是允许切到未存在的 ns）。
- 在 popup 切到 study 后立刻打开 board view → board 也已重渲染（active 已写入 storage）。

---

### 步骤 4.4 — popup.css 加 ns-switcher 样式

**文件**: `popup/popup.css`

**改动说明**：
- `.ns-switcher` flex 行内布局，与现有 header 视觉一致。
- input 宽度约 120px，datalist 沿用浏览器原生 style（无需自绘 select）。
- `.ns-help` hover 时 `cursor: help`；保持视觉低调（不抢 popup 已有 header 的注意力）。
- 不动色板，避免破坏 dark mode / 已有主题。

**verify**：
- 单 ns 隐藏无副作用。
- 多 ns 时下拉框与 header 现有控件视觉协调。

---

## Phase 5 — Board View UI (`modules/group/view.js` + `modules/group/style.css`)

> 依赖：Phase 2 完成（action 可用）；与 Phase 4 并行安全（互不依赖代码）。

### 步骤 5.1 — board view header 加 ns 下拉框 + 启动加载

**文件**: `modules/group/view.js`

**改动说明**：
按 spec §6.2：
- 在 view header 工具栏（与视图切换 tab 并列）添加 ns-switcher DOM（结构与 popup 同，复用 `<input list>` + `<datalist>`）。
- `init` / `render` 流程并发拉 `getActiveNamespace` + `getAllGroupsAcrossNamespaces` 渲染 input.value。
- 单 ns（仅 default）时仍渲染 input 但不传 datalist options，或隐藏（与 popup 一致）。

**verify**：
- 打开 board view → header 出现下拉框（多 ns 情况下）。
- 切到不存在 ns → value 立刻更新。

---

### 步骤 5.2 — 监听 `chrome.storage.onChanged` 自动重渲染

**文件**: `modules/group/view.js`

**改动说明**：
- 新增 listener（注意 binding / cleanup；board view 切走时记得移除以免内存泄漏）：
  ```js
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.settings?.newValue?.activeNamespace !== changes.settings?.oldValue?.activeNamespace) {
      await renderNamespaceSwitcher();
      await refreshBoardData(); // 重拉 group / tabs
    } else if (changes.groups || changes.tabs) {
      await refreshBoardData();
    }
  });
  ```
- 走 popup 切 ns 后，board 自动同步（spec §6.2）。

**verify**：
- 在 popup 切 ns → 不 reload board 的情况下 board 自动刷新（前提 board 当前正在 DOM 中）。
- 切离 board view 时 listener 被移除（用 Chrome devtools memory snapshot 或 console listener count 验证，不变量 6 反面验证）。

---

### 步骤 5.3 — modules/group/style.css 加 ns 样式（如未合并）

**文件**: `modules/group/style.css`

**改动说明**：
- 与 popup 的 ns 样式保持一致。复用同一组 class（`.ns-switcher` / `.ns-help`），便于以后单点维护。

**verify**：
- DOM 中 `.ns-switcher` 显示与 popup 视觉一致。

---

## Phase 6 — Content Scripts (`content/inject/goto.js` + `content/gotoManagerRing.js`)

> 依赖：Phase 2 完成。content script 不需要新增 message（model 内部已自动按 ns 过滤，spec §5.3）。
> content.js **不变**（spec §7.4）。

### 步骤 6.1 — `content/inject/goto.js` 监听 storage.onChanged 重建圆环

**文件**: `content/inject/goto.js`

**改动说明**：
按 spec §7.1、§附录 B 不变量 6：
- 在现有 `chrome.runtime.onMessage` 监听旁新增 `chrome.storage.onChanged` listener：
  - 只在 `changes.settings?.newValue?.activeNamespace` / `changes.groups` / `changes.tabs` 任一变化时触发。
  - 触发动作：清空当前 goto ring DOM（`gotoRingEl.innerHTML = ''`），重发 `getGotoMenuData`，重新渲染。
- **圆环单实例保证**：销毁后重建，DOM 中始终只有一个 `.goto-ring`（不变量 6 + 测试 T14）。

**verify**：
- 在 default / study 各设一个 goto group（A→tab a；B→tab b）。
- 在 content script 注入的页面上切 ns → 圆环内容就地刷新；DOM inspector 中 `.goto-ring` 节点保持 1 个。
- 切离 board view 后 listener 仍在（content script 寿命 ≠ board view 寿命，无须 cleanup）。

---

### 步骤 6.2 — `content/gotoManagerRing.js` 监听 storage.onChanged 重渲染侧边栏

**文件**: `content/gotoManagerRing.js`

**改动说明**：
按 spec §7.2：
- 监听 `chrome.storage.onChanged`：同样三 key (`settings.activeNamespace` / `groups` / `tabs`)。
- 触发动作：清空 sidebar 容器的内容 + 重发 `getGotoGroupsFull` + 重新渲染。
- 注意：`getGotoGroupsFull` 内部走 `getGroups`（已过滤），**无需** 显式调 `getActiveNamespace` 来二次过滤（spec §7.2 已警告）。

**verify**：
- 各 ns 有一个 goto group 时，active=default 侧边栏显示 default 的那个；切 study → 显示 study 的那个，DOM 中不出现两个 group 块叠加。
- 测试 T8。

---

### 步骤 6.3 — content script 不变项验证

**文件**: `content/content.js`

**改动说明**：
**不**改此文件。仅记录：content.js 仍发 `incrementVisitCount` message；Phase 2 步骤 2.3 已实现翻译。

**verify**：
- Grep `content/content.js` 确认仍发 `incrementVisitCount`。
- Grep 后台 handler 确认 adapter 层只读一次 `settings`。

---

## Phase 7 — Final Verification（不变量 + 14 测试用例回归）

> 必须在 Phase 1-6 **全部**合入并 reload 后执行。失败任意一项 → 不能发 PR。

### 步骤 7.1 — 不变量 grep 检查（spec §附录 B）

**文件**: — （grep 命令）

**改动说明**：
执行 8 条不变量检查（部分已在 Phase 1 步骤 1.13 准备）：
1. `rg -nP "chrome\.storage\.local\.(get|set)\(\[['\"](groups|tabs)" background/ popup/ modules/ content/ --glob '!background/group-model.js'` → 应为 0 命中（不变量 1）。
2. `rg -nP "activeNamespace" background/popup/modules/content/` → 写入路径应只在 `background/group-model.js` 的 `setActiveNamespace`；其他位置应只有读取（不变量 2、3）。
3. `rg "updateSettings.*activeNamespace"` → 0 命中。
4. `background/groups.js` 中 `chrome.storage.local.get(['settings'])` 应**只**出现 1 次（`incrementVisitCount` handler 内；不变量 3 例外）。
5. `rg "sendMessage.*\b(createGroup|setDefaultGroup|getDefaultGroup)\b" background/focus.js background/goto.js background/init.js` → 0 命中（不变量 5：background 内部不走消息）。
6. grep `content/inject/goto.js` 中圆环创建点是否在 storage.onChanged 回调内调用销毁+重建（不变量 6）。
7. `ensureGroupDefaults` 后 `getAllGroups()` 数 == 升级前 group 数（不变量 7）；用 node 单元模拟或手动 smoke。
8. `rg "INVALID_NAMESPACE_IN_IMPORT"` 应在 `importGroupsAndTabs` 调用方全部 try/catch（不变量 8）。

**verify**：
- 8 条全部通过。

---

### 步骤 7.2 — 14 测试用例 smoke test 执行（spec §10）

**文件**: — （手动 + DevTools）

**改动说明**：
按 spec §10 跑 T1-T14。每个用例给「前置 / 操作 / 预期」三段：
- T1 ns 隔离读写 → expected。
- T2 goto 圆环随 ns。
- T3 History per-ns。
- T4 visit count per-ns。
- T5 popup / board 同步。
- T6 Alt+Shift+A 走 active ns 默认 group。
- T7 clearAllGroups scope=active。
- T8 gotoManager 侧边栏 per-ns。
- T9 跨 ns 写入拒绝。
- T10 导出含 activeNamespace。
- T11 导入全量替换。
- T12 老用户升级无感。
- T13 切回原数据完整。
- T14 content script 单圆环。

**verify**：
- T1-T14 全部 pass。任一失败 → 视为该 sub-PR 阻断，不合入。

---

### 步骤 7.3 — PR 拆分 & merge 顺序确认

**文件**: `docs/superpowers/plans/...`

**改动说明**：
按 spec 第 7 行拆分 PR-A 到 PR-E：
- PR-A：本计划 Phase 1 全部（步骤 1.1-1.13）。同时新增 `validateNamespace` unit smoke（手测即可）。
- PR-B：本计划 Phase 2 + Phase 3（步骤 2.1-2.4 + 步骤 3.1），并触发 `ensureGroupDefaults` + `ensureSettingsDefaults`（属 background 适配层 + 迁移）。
- PR-C：本计划 Phase 4 + Phase 5（步骤 4.1-4.4 + 步骤 5.1-5.3）。
- PR-D：本计划 Phase 6（步骤 6.1-6.3）。
- PR-E：本计划 Phase 7（步骤 7.1-7.3）。逐 PR 合并后跑 T1-T14。

**verify**：
- 4 个 PR 各自能独立回滚（每个 PR 改动的文件互不重叠）。
- 合并顺序：A → B → C → D → E。每合一个跑 §附录 B 一次。

---

## 依赖关系小结

```
步骤 1.1 ─┬─→ 1.2 ─→ 1.3 ─→ 1.4 ─→ 1.5 ─→ 1.6 ─→ 1.7 ─→ 1.8 ─→ 1.9 ─→ 1.10 ─→ 1.11 ─→ 1.12 ─→ 1.13
          └─→ (validateNamespace 必须先于 1.2/1.10)
                                                  │
                                                  ↓
                          2.1 ─→ 2.2 ─→ 2.3 ─→ 2.4
                                                  │
                  ┌───────────────────────────────┼───────────────────────────────┐
                  ↓                               ↓                               ↓
              3.1 (focus)                     4.1-4.4 (popup)                  5.1-5.3 (board)
                                                  │                               │
                                                  └─────────┬─────────────────────┘
                                                            ↓
                                                  6.1 (goto.js) + 6.2 (manager)
                                                            │
                                                            ↓
                                                  7.1 (不变量 grep) → 7.2 (T1-T14) → 7.3 (PR 拆分)
```

**关键依赖说明**：
- 1.4 修改 `createGroup` 签名必须在 2.1 之前（adapter 调用点必须在 model 重构后切到新签名），但其实**当前** `createGroup` 已经是对象参数（`group-model.js:66`），所以 1.4 只是内部行为变更，对外兼容。
- 1.5 的 deprecated 别名必须在 2.1 后、1.13 前存在。
- 步骤 3.1（focus）独立于 Phase 4/5/6，可放在 PR-B 末尾或 PR-B 与 PR-C 之间的空闲 commit。
- Phase 6（content scripts）必须等 Phase 2 adapter 完整，但**不**依赖 Phase 4/5 UI。
- Phase 7 永远最后。

---

## 不变量速查（从 spec §附录 B 复制，每步骤 verify 时核对）

1. `chrome.storage.local.get/set(['groups'/'tabs'])` 只在 `background/group-model.js`。
2. `settings.activeNamespace` 写入只在 `groupModel.setActiveNamespace`。
3. `Group.ns` 读写只通过 model 函数；adapter 唯一例外是 `incrementVisitCount` handler 多读一次 `settings.activeNamespace`。
4. adapter 不持 ns 缓存；每次消息处理从 model 重读。
5. background 内部模块直接 import `group-model.js`，不走 sendMessage。
6. goto 圆环 DOM 在 ns 切换时**销毁重建**。
7. 升级后 `getAllGroups()` 数 = 升级前 group 数。
8. `importGroupsAndTabs` 对非法 ns **整批拒绝**。
