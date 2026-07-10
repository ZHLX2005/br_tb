---
name: module-extension-guide
description: 当用户要求扩展模块、新增视图、添加功能面板、或集成新页面到 TabBoard 时触发。指导在现有模块化架构中新增一个功能模块的完整流程；并涵盖"把独立 HTML 页面内嵌成 panel"这一改造（共享 CSS 审计、CSS 作用域化、destroy 规范、事件监听器泄漏修复、switchView 短路清理、popup/background 联动切视图、保留 manifest 资源）。也覆盖症状词触发："切换视图白页 / 必须 F5 才显示 / 归档始终显示 / 弹窗 css 失效 / destroy 清容器 / 切到某视图没反应"。
---

# Module Extension Guide — TabBoard 模块扩展指南

> **单一职责：** 教你在 TabBoard 现有架构里加一个新模块或扩展已有模块，所有路径锚定本仓库根目录 `D:\code\a_js\proj\js\test_feature\`。
>
> 本 skill 不涵盖：通用前端组件设计、UI 库选择、独立无关联项目的新建。

## 触发条件

- "扩展一个模块" / "加个新视图" / "新加个面板"
- "在 TabBoard 里集成 XX"
- "把 recording.html 内嵌成 panel"（属于**独立页面内嵌**的改造，详见 §10）
- "添加 XX 按钮" / "给 group view 加个清空按钮"（属于**已有模块的扩展**，见 §6）

---

## 1. 方案选择：内嵌 view.js vs 跳转新页面

```
是否需要与 TabBoard 共享数据(DataManager + chrome.storage)和导航栏？
  ├── 是 → 方案 A：内嵌 view.js（默认推荐）
  └── 否 → 方案 B：独立 HTML 页面（如 recording.html）
```

| 维度 | A：内嵌 view.js | B：独立 HTML 页面 |
|------|-----------------|------------------|
| 数据共享 | ✅ 天然共享 | ⚠️ 需 storage change 同步 |
| 切换体验 | ✅ 无白屏 | ❌ 跳转白屏 |
| 路由管理 | AppShell.switchView 统一调度 | 自管 URL/Shell |
| 适用 | 看板/时序/专注搜索这类主面板功能 | 录制回放、视频进度这种独立 SPA |

**默认方案 A。** 只有当模块有独立路由/复杂生命周期（如 recording.html 自己的 Shell）时选 B。

---

## 2. 现有架构快照（动手前必读）

| 角色 | 文件 |
|------|------|
| 应用入口 | `modules/tabboard/tabboard.html` + `tabboard.js` |
| 视图路由 | `tabboard.js::switchView()` 的 switch 语句（line 174-200） |
| 数据中枢 | `modules/shared/data-manager.js`（chrome.storage 代理） |
| 背景脚本 | `background/index.js` + 子模块（`commands.js` / `groups.js` / `recording.js` ...） |
| 共享模态框 | `shared/ModalDialog.js`（**根目录的 `shared/`，不是 `modules/shared/`**） |
| 共享工具 | `modules/shared/utils.js`、`modules/shared/event-bus.js`、`modules/shared/lib/jkanban.min.js` |
| 各视图 | `modules/<feature>/{index.js, view.js, style.css}` |
| 消息协议 | `chrome.runtime.sendMessage({ action, ...payload })` |

### 关键不变量（违反必崩）

1. **每个模块必须实现 4 个方法：** `init()`、`render(data)`、`bindEvents()`、`destroy()`。  
   `tabboard.js:202-206` 直接调用这 4 个方法，没有 duck-typing fallback。
2. **`render(data)` 必须更新 `#stats`**（line 132-138 的注释强调过），否则切视图时头部残留"加载中..."。
3. **`destroy()` 必须清理所有 observer / 第三方实例**（MutationObserver、jKanban、dragula），否则切回时事件堆叠。
4. **import 路径以文件自身所在目录为基准**（见 §7 错误案例 #1）。

---

## 3. 扩展流程（内嵌方案 A）

### Phase 1: 创建 `modules/<feature-name>/` 三件套

```
modules/<feature-name>/
  ├── index.js   # 模块入口（实现 4 方法）
  ├── view.js    # DOM 渲染 + 事件绑定
  └── style.css  # 模块专属样式（强制独立，不进 tabboard.css）
```

#### 1.1 `index.js` 模板（与现有 GroupModule 对齐）

```javascript
import <FeatureName>View from './view.js';

class <FeatureName>Module {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new <FeatureName>View(dataManager);
  }

  init() {
    // 视图内部已通过 render 初始化
    // 如需绑定 storage listener，在这里 this.dataManager.onChange(...)
  }

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    // 视图内部已通过 _setupBoardActionDelegation 或 _bindEvents 自绑定
  }

  destroy() {
    // ⚠️ 必须清理 observer / 第三方实例 / DOM 事件
    if (this.view.<observerOrInstance>) {
      this.view.<observerOrInstance>.disconnect?.();
      this.view.<observerOrInstance> = null;
    }
    if (this.container) this.container.innerHTML = '';
  }
}

export default <FeatureName>Module;
```

**参考真实代码：** `modules/group/index.js`（35 行，最小可用版本）。

#### 1.2 `view.js` 模板

```javascript
import { escapeHtml, formatTime, getColorClass } from '../shared/utils.js';
import { modal } from '../../../shared/ModalDialog.js';   // ⚠️ 见 §7 #1

class <FeatureName>View {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.items = [];
  }

  updateData(data) {
    this.items = data.<featureKey> || [];
  }

  render() {
    // 1) 头部统计条（强制，避免残留）
    const stats = document.getElementById('stats');
    if (stats) stats.textContent = `${this.items.length} 项`;

    // 2) 主体渲染
    this.container.innerHTML = this._buildHTML();
    this._bindEvents();
  }

  _buildHTML() { /* ... */ }
  _bindEvents() { /* ... */ }
}

export default <FeatureName>View;
```

**关键提醒：**
- `view.js` 不要直接读 `chrome.storage.local`，全部走 `dataManager.sendMessage` 或 `dataManager.loadData()`。
- 重复渲染会导致事件堆叠 → 见 §7 #4 委托方案。

### Phase 2: 注册到 AppShell（`modules/tabboard/tabboard.js`）

**4 处必须改，缺一不可：**

```javascript
// (1) 顶部 import（line 9 附近）
import <FeatureName>Module from '../<feature-name>/index.js';

// (2) 导航按钮 click（line 47 附近）
document.getElementById('<featureName>ViewBtn')
  ?.addEventListener('click', () => this.switchView('<feature-name>'));

// (3) switch 路由（line 174-200 的 switch 内）
case '<feature-name>':
  container = document.getElementById('<featureName>View');
  ModuleClass = <FeatureName>Module;
  break;

// (4) UI 显隐（line 246 附近的 _updateViewUI）
'<feature-name>': '<featureName>View',   // 加进 viewContainerMap
document.getElementById('<featureName>ViewBtn')
  ?.classList.toggle('active', viewName === '<feature-name>');
```

### Phase 3: HTML 容器（`modules/tabboard/tabboard.html`）

```html
<!-- 导航栏（line 18 附近） -->
<button id="<featureName>ViewBtn" class="nav-btn" title="...">Label</button>

<!-- 视图容器（line 51 附近） -->
<div id="<featureName>View" class="view-container" style="display: none;">
  <div id="<featureName>Panel" style="height: 100%; overflow-y: auto;"></div>
</div>

<!-- CSS 引入（line 6 附近） -->
<link rel="stylesheet" href="../<feature-name>/style.css">
```

### Phase 4: CSS 强制独立

- `modules/<feature-name>/style.css` 单文件 ≤ 500 行。
- `tabboard.css` 只放通用基础（`:root`、header、nav、buttons、contextmenu、toast）。
- 不要用全局选择器（如 `button { ... }`），全部加前缀 `.feature-name-xxx`。

### Phase 5: 数据层注册（如需新 storage key）

**只在需要新持久化字段时执行。** 复用现有 key（groups/tabs/timelineSnapshots/recordings）跳过此步。

**`modules/shared/data-manager.js`：**

```javascript
// constructor 的 this.data 加字段
this.data = {
  groups: [],
  tabs: {},
  // ...
  <featureKey>: {},     // ← 新增
};

// loadData() 的 chrome.storage.local.get 列表加 key
const result = await chrome.storage.local.get(['groups', 'tabs', '<featureKey>']);
this.data.<featureKey> = result.<featureKey> || {};

// 加 getter
get <featureKey>() { return this.data.<featureKey>; }
```

**`background/init.js`：**

```javascript
const result = await chrome.storage.local.get(['<featureKey>']);
if (!result.<featureKey>) {
  await chrome.storage.local.set({ <featureKey>: {} });
}
```

**`background/<feature>.js`：** 在 `setupGroupsListeners` / `setupRecordingListeners` 等路由表里加 `case '<featureAction>':` 接收 `chrome.runtime.sendMessage`。

---

## 4. 头部统计条（每个视图必处理）

`tabboard.js` 的 `#stats` 是全局共享，切换视图不会自动清空。**每个 view.js 的 `render()` 必须主动设置**，否则残留上一个视图的数据或 "加载中..."。

```javascript
render() {
  const stats = document.getElementById('stats');
  if (stats) {
    stats.textContent = `${this.items.length} 个项目 · ${this.filtered.length} 个显示`;
  }
  // ... 再渲染主体
}
```

参考：`modules/group/view.js:55-62`（分组视图）、`modules/timeline/view.js`（时序视图）。

---

## 5. storage 变化监听（多视图同步）

如果新视图依赖其他视图修改的数据，必须监听 storage change：

```javascript
// data-manager.js 中已有 onChange 调度
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.<featureKey>) {
    this.data.<featureKey> = changes.<featureKey>.newValue;
    this._notifyListeners('<featureKey>');  // 通知视图刷新
  }
});
```

视图侧在 `init()` 里订阅：

```javascript
init() {
  this.dataManager.on('<featureKey>', (newVal) => {
    this.updateData({ <featureKey>: newVal });
    this.render();
  });
}
```

**坑：** 如果在视图内直接 `chrome.storage.local.get`，会绕开通知链路，导致 storage change 不触发本视图刷新。

---

## 6. 已有模块的扩展（vs 新建模块）

给 `group view` 加按钮、改 `timeline view` 布局，**不需要新建三件套**，直接修改对应文件：

| 改动类型 | 改哪里 | 注意 |
|---------|--------|------|
| 给看板列加按钮 | `modules/group/view.js` 的 `_addBoardActionButtons()` | 见 §7 #4 委托方案，避免每次 render 重复 `addEventListener` |
| 加新消息 action | `background/groups.js` 的 `setupGroupsListeners` switch | 同步更新 `CLAUDE.md` 的消息协议表 |
| 改存储字段 | `data-manager.js` + `background/init.js` + 迁移老数据 | 加 version 字段，老用户首次启动时迁移 |
| 加新视图 | 走 §3 完整流程 | 不要混在旧模块里，单独建 `modules/<feature>/` |

---

## 7. 错误案例（高频踩坑，血泪教训）

| # | 错误操作 | 实际后果 | 正确做法 |
|---|---------|---------|---------|
| **1** | `import { modal } from '../../shared/ModalDialog.js'`（从 `modules/group/view.js` 出发） | 解析到 `modules/shared/ModalDialog.js`（不存在）→ 模块加载失败 → 整个 group 视图渲染失败或部分按钮（如 Clear/Del 调用 modal.confirm）静默失效 | 正确路径是 `../../../shared/ModalDialog.js`（`shared/` 在仓库根目录，不在 `modules/` 下）。**先在终端数清楚层级**：从 view.js 所在目录回到目标文件所在目录，需要几层 `../` 就写几个 |
| **2** | `render()` 不更新 `#stats` | 切回视图时头部残留 "加载中..." 或上一个视图的数字 | 每个 view.js 的 `render()` 第一件事就是设置 `document.getElementById('stats').textContent` |
| **3** | `destroy()` 不清理 `MutationObserver` / jKanban 实例 | 切走再切回 → 事件委托累加（一个 click 触发 N 次 confirm），DOM 多份残留 | `destroy()` 必须 `observer.disconnect()` + `kanban = null`。**但绝不**清 `this.container.innerHTML`——见 #11 |
| **4** | 每次 `render()` 都 `btn.addEventListener('click', fn.bind(this))` | 每次重渲染都新增监听器，第 N 次点击触发 N 次回调 | **改成事件委托**：在 `container` 上一次性 `addEventListener('click', e => { if (e.target.matches('.xxx')) ... })`，用 `__bound` 标志防重复绑定 |
| **5** | 视图内直接 `chrome.storage.local.get/set` | 绕开 DataManager 通知 → 其他视图不刷新，本视图也不响应 storage change | 全部走 `dataManager.sendMessage(action, payload)` + `dataManager.loadData()` |
| **6** | import 路径写绝对路径或 `src/...` | Chrome 扩展严格校验 `extension://` 协议，路径错立即 `Failed to load module` | 用相对路径，写完后**在终端用 `node -e "path.resolve(__dirname, '..', '...')"` 验证目标文件存在** |
| **7** | 新模块的 HTML 容器没设 `height: 100%; overflow-y: auto` | 视图内容溢出无滚动条，布局错乱 | 给 `#<featureName>Panel` 加 `style="height: 100%; overflow-y: auto;"` |
| **8** | 改 storage schema 但没写迁移逻辑 | 老用户升级后旧数据丢失或解析报错 | `background/init.js` 启动时检查版本号，老数据转换后再 set |
| **9** | CSS 全堆进 `tabboard.css` | 单文件超过 500 行，选择器冲突难定位 | 每个模块独立 `style.css`，选择器全部加 `.feature-name-` 前缀 |
| **10** | 在 view.js 顶层 `import` 一个运行时才需要的模块 | 增加首屏加载时间，且调试时难以定位 | 用动态 `await import('./heavy.js')` 在交互时按需加载 |
| **11** | **内嵌视图的 `destroy()` 里 `this.container.innerHTML = ''`**（从通用 skill 模板照搬） | `#<feature>View` 下的 `<header>` / `#stats` / `#groupsList` 等是 **tabboard.html 的静态 HTML**,不是 view.js 创建的。清空后下次 mount 时 `renderStats()/renderXxxList()` 的 `getElementById` 全部返回 null → 静默早退 → **"nav 切换白页,F5 后才行"**(首次 cache-miss 能看,之后 cache-hit 走清空过的 container 就崩) | **destroy 绝不清 `this.container.innerHTML`**。各 `render*` 方法自己 `innerHTML =` 覆盖动态部分,这就够了。observer / listener / timer 才需要 destroy 解绑 |
| **12** | `tabboard.js::switchView` 调 `this.currentModule.init()` 但**不 await** | async init 内部 `await loadData()` 与紧跟其后的 `render(data)` 竞态:render 时数据可能还没载完 | `await this.currentModule.init()` 再 `render(data)`。sync `init()` 立即 resolve 不影响其他视图 |
| **13** | **document 级委托监听器:destroy 移除了但 guard(`_boundDocument`/`_wired`)没重置** | tabboard 缓存复用模块,reattach 只调 `bindEvents`(不调 init)。guard 没重置 → `_wireXxx` 的 `if (guard) return` 跳过 → 监听器永久消失 → **首次进入按钮能用,切走再切回后所有 `[data-action]` 按钮失效**(归档/展开/删除/恢复等全点不动) | destroy 移除监听后**必须重置 guard**(`_boundDocument=null`);wire 函数幂等;`bindEvents` 里调 wire 函数(reattach 时重绑)。详见 §10.4 |

---

## 8. 验证清单

- [ ] 模块目录创建在 `modules/<feature>/`（**不是** `src/` 或 `lib/`）
- [ ] 三件齐全：`index.js`、`view.js`、`<feature>.css`
- [ ] CSS 文件 ≤500 行
- [ ] `tabboard.html` 加了 `<link>`、导航按钮、视图容器
- [ ] `tabboard.js` 改了 4 处（import / 导航 click / switch case / viewContainerMap）
- [ ] `_updateViewUI` 加了按钮 active 切换
- [ ] DataManager 注册新 storage key（如需要）
- [ ] `background/init.js` 初始化新 key（如需要）
- [ ] view.js 的 `render()` 第一行更新 `#stats`
- [ ] `destroy()` 清理所有 observer 和第三方实例
- [ ] **终端验证所有 import 路径解析正确**（`node -e` 或对照 `ls`）
- [ ] 浏览器加载扩展无 console 错误
- [ ] 切视图时 `#stats` 数字正确
- [ ] 反复切回该视图 3 次以上，确认无事件堆叠（事件委托方案）

---

## 9. 调试清单

### 9.1 按钮点击失效时

按以下顺序排查，**不要跳步**：

1. **打开 DevTools console**，看是否有 `Failed to load module` 或 `TypeError`。
2. **检查按钮 click 是否真的触发**：在 `container.addEventListener('click', ...)` 里加 `console.log('delegated', e.target)`，确认事件能冒泡到 container。
3. **检查事件委托是否被新元素拦截**：是否用了 capture phase + `stopImmediatePropagation`，导致外层委托收不到？
4. **检查 handler 内部的依赖**：`_handleClearGroup` 里调 `modal.confirm`，如果 `modal` 是 undefined（import 错），会抛 TypeError 被吞掉，看起来"按钮失效"。
5. **检查数据是否真的被改**：在 `await this.dataManager.sendMessage(...)` 后 `console.log(result)`，看返回的 `{ success, ... }`。
6. **检查 background 是否收到消息**：在 `background/groups.js` 的 `case 'clearGroup':` 第一行 `console.log('[bg] clearGroup', request)`。

最常见根因是 **#4（handler 内部静默抛错）** 和 **#1（import 路径错位）**。

### 9.2 切换视图白页 / 必须 F5 才显示时（本次 video-progress 实战教训）

症状特征：**首次进入能看，切走再切回白页；F5 修复一次；外部触发（popup）第一次能用**。这个组合几乎 100% 是 destroy() 损坏了下次 mount 需要的 DOM 或状态。

**不要瞎猜**——按下面顺序仪器化观察（每步加临时 log，定位后删掉）：

1. **render 入口 log**：在 `render()` 第一行 `console.log('[x.render] mode=', this.mode, 'data.len=', this.items.length, 'init=', this.isInitialized)`。看 render 是否被调、参数是否正确。
2. **DOM 写入前后对比**：在 `renderXxxList()` 写 innerHTML 前后各 `console.log('before/after len=', el.innerHTML.length)`。
   - 如果 after len=0 → render 写的是空内容（filter/数据问题）
   - 如果 after len>0 但看不到 → CSS 把容器隐藏了
3. **computed style 检查**：`console.log(getComputedStyle(panel).display, panel.style.display)`。inline style 是 `block` 但 computed 是 `none` → 被 `!important` 或祖先隐藏。
4. **visible badge**：即使页面白屏，左下角 fixed-position 的 debug badge 也会显示，能确认 render 是否真跑过：
   ```js
   const dbg = document.createElement('div');
   dbg.style.cssText = 'position:fixed;bottom:0;left:0;background:yellow;color:#000;padding:2px 6px;font-size:11px;z-index:99999;';
   dbg.textContent = `[render] items=${this.items.length}`;
   document.body.appendChild(dbg);
   ```
5. **destroy log**：在 `destroy()` 第一行 `console.log('[x.destroy]')`。如果切走时看到 destroy、切回时 render log 也有、after len>0，但视觉白 → 99% 是 destroy 清了不该清的东西（见 #11）。

**反模式警告**：本次实战里我在找到真根因前做了 5+ 个错误理论（CSS scope、await init 竞态、data race、container visibility、storage listener 竞态）。**全是猜的**。真正定位只用了第 1+2+5 步的 log。先仪器化，再下结论。

---

## 10. 把独立 HTML 页面内嵌成 panel

适用于 "recording.html / video-progress.html / 任意外链页面" → 改造成 TabBoard 内的一个 panel 视图。

### 10.1 决策前提

满足以下才走这条路：
- 该页面的 URL 来自 `manifest.json` 的 `web_accessible_resources`，可被任意页面引用
- 不依赖独立 Shell 的复杂路由
- 数据可通过 DataManager 共享

### 10.2 改造步骤

#### (1) 复制页面 → 模块目录

```bash
# 例：把 recording.html 内嵌
cp modules/recording/recording.html modules/recording/recording-panel.html
# 或新建独立模块
mkdir modules/recording-panel && mv ...
```

#### (2) HTML 改造

**去掉的元素：**
- `<head>` 中独立的 CSS 引入改为相对路径（去掉 `<link rel="stylesheet" href="../tabboard/tabboard.css">`）
- `<body>` 顶部独立的 `<header>` / 工具栏（合并到 TabBoard 全局 header）
- 独立的 `<script type="module">`，改用 `<script type="module" src="./view.js">`

**保留的元素：**
- 模块专属 DOM 结构
- 模块专属 JS 入口

**容器规范：**
```html
<div id="<feature>Panel" style="height: 100%; overflow-y: auto;">
  <!-- 原来 body 里的内容 -->
</div>
```

#### (3) 共享 CSS 审计

外链页面通常 import 了完整 `tabboard.css` + 自己模块的 css。内嵌后：

- **删掉重复 import**：`tabboard.css` 已被 tabboard.html 引入一次
- **作用域化选择器**：原页面可能用通用选择器（`.btn`、`.modal`），改为 `.feature-xxx`
- **冲突检测**：用 grep 检查模块 CSS 里是否定义了 `body`、`.container` 等全局选择器

```bash
# 审计示例
grep -n "^\s*body\s*{\|^[a-z\.]+\s*{[^}]*background" modules/recording/recording.css
```

#### (4) 事件监听器泄漏修复（高频坑）

**坑：** 原页面在 `DOMContentLoaded` 里 `window.addEventListener('storage', ...)`，内嵌后每次切回该 panel 都会触发新的监听器，**几个 tab 后 storage 变化触发 N 次回调**。

**解法：** 把 `window` 级监听下沉到 `container`，并在 `destroy()` 里 `removeEventListener`。

```javascript
// modules/<feature>/view.js
init() {
  this._onStorageChange = (changes, area) => {
    if (area !== 'local') return;
    this._handleStorageChange(changes);
  };
  chrome.storage.onChanged.addListener(this._onStorageChange);
}

destroy() {
  chrome.storage.onChanged.removeListener(this._onStorageChange);
  this._onStorageChange = null;
}
```

#### (5) switchView 短路清理

确认 `tabboard.js::switchView()` 在切换前调用 `currentModule.destroy()`。如果没有，每次切回会创建新的 view 实例。

参考 `tabboard.js:160-164` 的 `if (this.currentModule) { this.currentModule.destroy(); ... }`。

#### (6) manifest 资源保留

如果原 URL 还需被外部页面引用（如 popup、其它扩展页），**保留 `web_accessible_resources` 条目**，不要删除：

```json
"web_accessible_resources": [
  {
    "resources": [
      "modules/recording/recording.html",   // ← 保留！
      "modules/<feature>/panel.html"         // ← 新增内嵌版（可选）
    ],
    "matches": ["<all_urls>"]
  }
]
```

#### (7) 原独立页面的处理

- 如果该 URL 只被 TabBoard 引用 → 直接删除 `recording.html`，全部走 panel
- 如果被 popup / 命令面板 / 其它地方引用 → 保留原页面，但加注释说明 "内嵌版在 modules/<feature>/view.js"

### 10.3 内嵌改造的验证清单

- [ ] 切到 panel 时 `<title>` 不变（不要污染浏览器标签标题）
- [ ] 切走再切回 3 次，storage change 只触发 1 次回调
- [ ] **切走再切回时视图内容正确重现**（这是本次最重要的验证——曾因 destroy 清空静态 HTML 导致白页）
- [ ] panel 内部滚动条独立工作，不影响全局滚动
- [ ] 原 URL 仍能从外部页面打开（如有需要）
- [ ] CSS 不与 tabboard.css 冲突（用 DevTools Computed 面板对比相同类名）

### 10.4 `destroy()` 正确规范（内嵌视图版）

内嵌视图的 destroy 是**两次白页 bug 的共同源头**（listener 泄漏 + 清空静态 HTML）。规范如下：

```js
destroy() {
  // ✅ 1. 解绑 chrome.storage.onChanged —— 必须存引用才能 remove
  if (this._onStorageChange) {
    chrome.storage.onChanged.removeListener(this._onStorageChange);
    this._onStorageChange = null;
  }

  // ✅ 2. 解绑 document/window 级委托 —— 存进数组批量 remove
  if (this._listeners?.length) {
    for (const [target, type, handler, capture] of this._listeners) {
      target.removeEventListener(type, handler, capture);
    }
    this._listeners = [];
  }

  // ✅ 3. 清定时器
  if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  if (this._interval) { clearInterval(this._interval); this._interval = null; }

  // ✅ 4. 断开 MutationObserver / 第三方实例（jKanban/dragula）
  this._observer?.disconnect?.();
  this._observer = null;

  // ❌ 5. 绝不! 绝不! 绝不! 清 this.container.innerHTML
  // #videoProgressView 下的 <header> / #stats / #groupsList 是 tabboard.html 的静态 HTML,
  // 清掉后下次 mount 时 renderXxxList() 的 getElementById 全返回 null → 静默早退 → 白页
  // 动态内容由各 render* 方法自己 innerHTML= 覆盖,不需要 destroy 清。
}
```

**listener 存引用 + 缓存模块重绑的标准写法**（关键！tabboard 缓存并复用模块实例）：

```js
// 所有 wire 函数必须幂等(自己防重复绑)
_wireListeners() {
  if (this._boundDocument) return; // 已绑,幂等
  const onClick = (e) => { /* dispatch data-action */ };
  document.addEventListener('click', onClick);
  this._listeners = [[document, 'click', onClick]];
  this._boundDocument = document; // guard
}

// init 和 bindEvents 都调 wire 函数(都幂等,安全)
async init() {
  this._wireListeners();      // 首次 mount 在此绑
  await this.loadData();
  this.isInitialized = true;
}
bindEvents() {
  this._wireListeners();      // reattach 时 tabboard 只调 bindEvents(不调 init),在此重绑
  this._wireHeaderButtons();
}

// destroy 移除监听 + 重置 guard,让下次 bindEvents 能重绑
destroy() {
  for (const [t, ty, h, c] of this._listeners || []) t.removeEventListener(ty, h, c);
  this._listeners = [];
  this._boundDocument = null; // ⚠️ 必须重置!否则 reattach 时 _wireListeners 的 guard 跳过 → 监听器永久消失
}
```

> **血泪教训（本次 video-progress 实战）**：tabboard **缓存并复用**模块实例（`this.modules[viewName]`），cache-hit 路径只调 `render + bindEvents`，**不调 init**。所以：
> - `document` 级委托监听器：destroy 移除后，必须靠 `bindEvents`（reattach 时会调）重绑。**前提是 wire 函数幂等 + destroy 重置 guard**。如果 guard（如 `_boundDocument`/`_wired`）在 destroy 里没重置，reattach 时 `_wireXxx` 的 `if (guard) return` 直接跳过 → **监听器永久消失 → 所有 `[data-action]` 按钮失效**（归档/展开/删除等都点不动）。症状："首次进入能用，切走再切回全失效"。
> - `container` 级监听器（绑在持久静态 DOM 如 `#recordingView` 上）：destroy **不必移除**——容器跨 mount 持续存在，监听器跟着持续有效，`__bound` flag 防重复绑即可（recording 模块就是这模式，无此 bug）。
> - header 按钮（静态 DOM 上的）：同上，destroy 不必移除，`__vpBound` flag 防重复。
>
> 一句话：**document/window 级监听 = destroy 移除 + 重置 guard + bindEvents 重绑；container/静态元素级监听 = 不移除 + flag 防重复。**

### 10.5 standalone → inline 迁移的 UX 差异（容易忽略）

照搬 standalone 页面的 UX 到 inline shell 会出问题。**逐项审查**：

| standalone 页面有的 | inline 后应该 | 原因 |
|---|---|---|
| header 里的"返回看板"按钮 | **删掉** | 顶部 nav 本身就是返回；按钮绑定 `backToTabboard()` 跳转会破坏 inline 体验 |
| header 里的"跳转归档/子页面"按钮 | **改成 mode 切换或弹窗** | inline 后没有独立页面可跳；用 `this.mode = 'archive'` + render 切子视图，或开 modal |
| 归档/历史 section 默认显示在底部 | **默认隐藏，按需切换** | inline 视图空间宝贵；用户来看 active 列表不该被动看到归档（本次"始终显示已归档"反馈） |
| `window.location.href` 跳转同级页面 | **全部改成 in-app 切换** | 任何 `location.href` 都会破坏 SPA 体验；排序/编辑改 modal |
| 独立的 `chrome.storage.onChanged` 监听 | **保留但 destroy 必须能 remove** | inline 后反复 mount/destroy，listener 不解绑会泄漏（见 10.4） |
| 自己 link 的 `shared/ModalDialog.css` | **host shell 统一 link，模块不再 link** | 多个模块共用 modal，host link 一次即可；模块 link 重复无害但冗余 |

### 10.6 popup / background 联动切换 inline 视图

当 popup 或 background 要"打开某 inline 视图"时，**不要**新建 tab 打开独立页面（那是旧模式）。正确做法：**找已有 tabboard tab → focus → 发消息切视图**。

**background 侧**（`background/<feature>.js`）：

```js
async function openFeatureView() {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t => t.url?.includes('modules/tabboard/tabboard.html'));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    try {
      await chrome.tabs.sendMessage(existing.id, {
        action: 'tabboardSwitchView',
        view: '<featureName>'
      });
    } catch (e) {
      // tab 刚加载 content script 还没就绪,fallback: 带 hash 新开
      console.warn('sendMessage 失败:', e.message);
    }
  } else {
    await chrome.tabs.create({
      url: chrome.runtime.getURL('modules/tabboard/tabboard.html#<featureName>')
    });
  }
}
```

**tabboard.js 侧**（接收消息切视图 + hash 路由兜底）：

```js
_setupExternalSwitchListener() {
  chrome.runtime.onMessage.addListener((req) => {
    if (req?.action === 'tabboardSwitchView') {
      this.switchView(req.view);  // 不 await,fire-and-forget
    }
    return false;
  });
}

// init 末尾加 hash 路由(冷启动 / redirect 进来时生效)
_readHashRoute() {
  const [view, params] = window.location.hash.replace(/^#/, '').split('&');
  if (view) {
    setTimeout(() => {
      this.switchView(view);
      if (params?.includes('archive=1')) this.currentModule?.view?.toggleArchiveMode?.(true);
    }, 100);
  }
}
```

**popup 侧**（加 `window.close()` 与其他 quickAction 一致）：

```js
btn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'openFeatureView' });
  window.close();
});
```

**旧独立 HTML 的处理**：shell.js 改成一行 redirect，旧 URL 不 404、popup 兜底还在：

```js
// modules/<feature>/<feature>-shell.js
window.location.replace(
  chrome.runtime.getURL('modules/tabboard/tabboard.html#<featureName>')
);
```

---

## 11. 迁移检查清单（升级时）

如果是从旧版本升级，检查以下点：

- [ ] `tabboard.js` 的 `viewContainerMap` 是否包含新视图
- [ ] `data-manager.js` 是否需要加新 key（参考 §5）
- [ ] `background/init.js` 是否初始化新 key
- [ ] `manifest.json` 的 `web_accessible_resources` 是否需要更新
- [ ] `CLAUDE.md` 的消息协议表是否同步更新
- [ ] 新模块的 `style.css` 选择器是否加了前缀（无全局污染）
- [ ] `popup/popup.html` 和 `sidepanel/sidepanel.html` 是否引用了新模块（如需要）