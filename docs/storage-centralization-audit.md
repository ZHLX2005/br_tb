# 存储层集中度审计

> 范围：`D:\code\a_js\proj\js\test_feature` 全部 JS 文件
> 方法：grep `chrome.storage.(local|sync|onChanged)` → 49 个文件 / 391 次触碰
> 结论先行：**groups/tabs 一个域做对了，其他 7+ 个域全是散写**

## TL;DR

| 维度 | 现状 |
|---|---|
| 官方规约 | 仅 `groups` / `tabs` 写了强制规则（`background/group-model.js:2` / `CLAUDE.md:164`） |
| 实际中心化 | **只对 `groups`/`tabs` 真正集中**。其他域（notes/recording/timeline/videoProgress/ring-settings/bilibili/leetcode/UI 偏好）**没有集中层**，直接 `chrome.storage.local.get/set` 散在 49 个文件里 |
| 消费侧规约 | `.claude/skills/module-extension-guide/SKILL.md:150` 规定"view.js 不直接读 storage，走 dataManager"——**但仅有 `modules/group/view.js` 真正遵守** |
| 中心化骨架 | 已有 `modules/shared/data-manager.js`（声明"负责所有数据的加载、存储和同步"）但**它自己也直接读 chrome.storage**（line 29-31），不是真正的中心层 |
| 新加的 `exportAllStorage`/`importAllStorage` | 是**事实上的"全量层"**——把整个 storage 当成黑盒dump/restore，不绕任何域的细节。这是当前唯一在 storage 边界上"集中"的入口 |

## 规约现状（从源码里搜出来的"明文规定"）

只有 **2 条硬规则**：

1. **`CLAUDE.md:164`** 与 **`background/group-model.js:2`**（重复声明）
   > `groups` / `tabs` 是 group 域的底层数据结构。任何模块（background / popup / view / content script）对它们的读写，**必须**经过 `background/group-model.js` 导出的程序语言接口，不允许直接 `chrome.storage.local.get/set(['groups'|'tabs'])`。

2. **`.claude/skills/module-extension-guide/SKILL.md:150`**（soft）
   > `view.js` 不要直接读 `chrome.storage.local`，全部走 `dataManager.sendMessage` 或 `dataManager.loadData()`。

→ 规约**只覆盖了 groups/tabs**。其他所有 storage key 没有成文规则。

## 审计表：每个 storage key 的"中心化程度"

| Storage key | 读写点（file:count） | 是否集中 | 状态 |
|---|---|---|---|
| `groups` / `tabs` | 全部走 `group-model.js`；消费侧走 `groups.js` 适配层 | ✅ **已集中** | 规约明确，落地完整 |
| `settings`（尤其 `activeNamespace`） | group-model 写 + 6+ 消费侧直读 | ⚠️ **半集中** | 写集中，读散（"取一个 theme 值也要直接读"） |
| `notes` / `notePages` | `background/notes.js` 写 + `modules/note/view.js` + `content/noteRing.js` + `content/x/tripleSpace/tripleSpace.js` 直读直写 | ❌ **未集中** | 3 个写点 + 3 个读点，没有 adapter 层 |
| `recordings` / `recordingState` | `background/recording.js:15` + `data-manager.js` 直读 | ❌ **未集中** | background 写，view 直读 |
| `videoGroups` / 视频进度相关 | `background/videoProgress.js:26` + `data-manager.js` 直读 | ❌ **未集中** | videoProgress.js 26 次写入/读取——**全栈单文件** |
| `timelineSnapshots` | `background/timeline.js:16` + `data-manager.js` 直读 | ❌ **未集中** | 写集中，读散 |
| `ringSettings`（goto 圆环大小/背景） | `background/ring-settings.js:8` | ✅ **集中** | 但 popup / content 仍直读 settings 全量 |
| `leetcodeProgress` | `background/...` 缺失 + `modules/leetcode/view.js` + `data-manager.js` 直读直写 | ❌ **未集中** | view 直写直读，没有 domain model |
| `bilibiliHistoryCookies` | `modules/bilibili-history/view.js` | ⚠️ **单点** | 1 个文件，没有跨消费者 |
| `tabboard_global_video_speed` | `content/speedRing.js` + `content/videoSpeed.js` + `popup/modules/videoSpeed.js` | ❌ **多写点** | 3 个文件直写，**没有 background 协调**，事件用 `window.postMessage` 而非 storage.onChanged |
| `noteRingPanelDims` | `content/noteRing.js` 直读直写 | ❌ **单点** | 1 个文件，但应该归到 notes 域 |
| 视频/课程进度条 (`courseProgressBar`) | `content/courseProgressBar.js` | ⚠️ **单点** | 1 个文件 |
| `theme` (settings.theme) | `popup/popup.js:26,39,41` | ❌ **散在 popup** | 2 处直读直写 |

## 关键泄漏点（消费侧绕过中心层）

### A. `modules/shared/data-manager.js:29-31` **自己违反规约**

```js
// CLAUDE.md 规约:groups / tabs 只能由 background/group-model.js 读写,
// 前端必须走 background/groups.js 适配层 (getAllData 已在 model 内部按 ns 过滤)
const data = await chrome.storage.local.get([
  'timelineSnapshots', 'recordings', 'recordingState', 'videoGroups',
  'leetcodeProgress', 'notePages', 'settings'
]);
```

注释只规约了 `groups/tabs`，**data-manager 对其他 7 个 key 直接 `chrome.storage.local.get`**。如果它的设计意图是"中心层"，**自己就是泄漏的源头**。

### B. `content/speedRing.js` / `content/videoSpeed.js` / `popup/modules/videoSpeed.js` **三方直接共享一个 key**

3 个文件直接读写 `tabboard_global_video_speed`：
- `speedRing.js` 写（悬浮圆环改倍速）
- `videoSpeed.js` 读 + 写（页面实际应用）
- `popup/modules/videoSpeed.js` 读 + 写（弹窗控制）

事件通知用 `window.postMessage`（同页内）+ 隐式 storage.onChanged 监听（跨页）。**没有 background 协调**。这是典型的"三个写者"的隐患——任何一个写者写错格式都会污染其他读者的解析。

### C. `content/noteRing.js` 持久化 UI 状态

```js
chrome.storage.local.get(['noteRingPanelDims'])   // 读
chrome.storage.local.set({ noteRingPanelDims })   // 写
```

UI 状态（panel 宽高）直接落 storage，绕过了 notes 域。语义上属于 notes 模块的"用户偏好"，但被拆到独立 key。

### D. popup 散写 `settings.theme`

`popup/popup.js` 直接 `chrome.storage.local.get(['settings'])` + `set({ settings: { theme } })`，两次 IPC 走完。其他 settings 字段（`themeBtn`、`activeNamespace`、`ringSidebarEnabled` 等）也都有相似散写。

## 评估

按域划分，当前有 **3 种治理状态**：

| 状态 | 域 | 备注 |
|---|---|---|
| **强中心化** | `groups` / `tabs` | 有 domain model + adapter + 规约 + 强制注释 |
| **半中心化** | `ringSettings`（goto 圆环）、`bilibiliHistoryCookies`、`courseProgressBar` | background 有专门文件，但消费侧仍直读 |
| **散写** | `notes`、`recordings`、`videoGroups`、`timelineSnapshots`、`leetcodeProgress`、`tabboard_global_video_speed`、`theme`、UI 偏好 | 2+ 写者，无协调 |

→ **不够集中**。只有 1 个域（groups/tabs）真正做到了"所有读写必经一个模块"。

## 为什么没爆

代码里 **没出大问题** 是因为：
1. 大多数"散写"是 **单消费者单写者**（`bilibiliHistoryCookies` 只有 `bilibili-history/view.js` 一个人用）
2. 唯一的"3 写者"是 video speed，靠 `window.postMessage` 缓释
3. `chrome.storage.onChanged` 帮大多数域做了隐式通知

→ 但只要再加一个消费者（比如 native host 想读 tb 数据），就会发现"找不到权威层"。`exportAllStorage` 已经把这个问题推到了眼前。

## 建议

### 优先级 1：把"全量层"坐实（本会话已完成一半）

`exportAllStorage` / `importAllStorage` 是**事实上的全量层**——把 chrome.storage 当黑盒 dump/restore，不需要任何域知识。**这是 native host 同步数据的最干净路径**，也是当前唯一在 storage 边界上"集中"的入口。

→ 建议在 `background/group-model.js` 顶部注释里**明示它是"全量层"**，并加一条规约：其他任何模块不允许做"全量 dump/restore"。

### 优先级 2：给 `data-manager.js` 划清职责

当前它声称"负责所有数据的加载、存储和同步"，但只走了 `groups/tabs` 的 message 通道，**对其他 7 个 key 是直接 chrome.storage 读**。

两条路选一条：
- **路 A**：把 `data-manager.js` 改成**纯消费层**——所有 7 个 key 都通过 `sendMessage('getXxx')` 走 background；删掉 `chrome.storage.local.get` 调用
- **路 B**：承认 `data-manager.js` 是"view 侧 cache 层"，允许直接读 storage，但**禁止写**——写必须经 background

路 A 更彻底，估算 1 天工作量（要把 7 个域的 `getXxx` adapter 加到 background）。

### 优先级 3：补齐域规约

为剩余 7 个域**逐个加规约**，与 `groups/tabs` 同样的标准：

```
background/{domain}-model.js  ← 唯一写入入口
background/{domain}.js        ← 消息 adapter
content / popup / view 消费侧  ← sendMessage 读，禁止直读
```

按改动量排：
1. **`notes` 域**——已有 `background/notes.js`，但缺 adapter；view + noteRing + tripleSpace 三处直读，1 天集中
2. **`videoSpeed` 域**——三方共享，**必须集中**否则会出 race，半天
3. **`videoGroups` 域**——`videoProgress.js` 26 次全是混在一起的，1 天
4. 其他 4 个域——单消费者，优先级低，按需

### 优先级 4（可选）：写个 lint 规则

`.eslintrc` 加一条自定义规则（或用 `no-restricted-syntax`）：

```js
'no-restricted-syntax': ['error',
  { selector: "CallExpression[callee.object.property.name='storage'][callee.property.name=/^(get|set)$/]",
    message: "禁止直接调用 chrome.storage.{get,set} —— 走 background/{domain}-model.js 或 sendMessage adapter" }
]
```

`groups/tabs` 例外（写入 `background/group-model.js` 不在 content/popup/view 目录下，规则自然豁免）。

→ 这一条落地后,新加的代码天然不会泄漏。

## 总结

**`groups/tabs` 一个域做对了（强中心化），但其他 7+ 域全是散写。**

对当前需求（native host 同步）**最务实的路径**是：
1. 保持 `exportAllStorage` / `importAllStorage` 作为**全量出口/入口**——这是天然的中心点
2. 接受其他 7 个域**暂时散写**——native host 反正走全量
3. 长远看（>3 个月）按优先级 2/3 逐域收编

短期不必为了 native host 去做大规模 refactor；native host 走 `exportAllStorage` 这条路完全够用。
