---
name: module-extension-guide
description: 当用户要求扩展模块、新增视图、添加功能面板、或集成新页面到 TabBoard 时触发。指导在现有模块化架构中新增一个功能模块的完整流程。
---

# Module Extension Guide — 模块扩展指南

## 触发条件

- "扩展一个模块"
- "新增视图"
- "添加功能面板"
- "集成新页面"
- "添加XX按钮"
- "再这个区域扩展"

## 方案选择：内嵌视图 vs 跳转新页面

### 方案 A：内嵌 view.js（推荐）

在同一 TabBoard 页面内，通过 `AppShell.switchView()` 切换容器内容。

**适用场景：**
- 数据与现有模块共享（通过 DataManager + chrome.storage）
- 需要在导航栏快速切换
- 功能与看板/时序属于同一层级

**优点：**
- 数据统一管理，无需跨页面同步
- 切换流畅，无页面跳转白屏
- 可复用 DataManager、EventBus、共享样式
- Storage listener 自动同步所有视图

**缺点：**
- DOM 结构复杂，需管理视图显隐
- 单页 CSS 容易膨胀（需拆分）

### 方案 B：跳转独立 HTML 页面

如 `recording.html`、`video-progress.html`，通过 `window.location.href` 跳转。

**适用场景：**
- 功能完全独立，不依赖 TabBoard 主框架
- 需要独立的 URL 和页面生命周期
- 模块有自己的 Shell 和路由

**优点：**
- 代码完全隔离，不污染主页面
- 独立的 CSS/JS，无全局命名冲突

**缺点：**
- 数据同步需要额外处理（storage change + 页面重载）
- 跳转有白屏，体验不连贯
- 需要独立的 Shell 初始化逻辑

### 决策规则

```
是否需要与 TabBoard 共享数据和导航栏？
  ├── 是 → 选择方案 A（内嵌 view.js）
  └── 否 → 选择方案 B（独立页面）
```

**默认优先方案 A。** 只有当前模块是一个完全独立的功能（如录制管理、视频进度追踪有自己的复杂路由）时，才选择方案 B。

---

## 扩展流程（按序执行）

### Phase 1: 创建模块文件（3 个文件）

```
modules/<feature-name>/
  ├── index.js   # 模块入口（BaseModule 接口）
  ├── view.js    # DOM 渲染与事件绑定
  └── style.css  # 模块样式（独立文件）
```

**index.js 模板：**

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
    this.view.setContainer(this.container);
  }

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    // 视图内部已绑定事件
  }

  destroy() {
    this.view.container = null;
  }
}

export default <FeatureName>Module;
```

**view.js 模板：**

```javascript
class <FeatureName>View {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.items = [];
  }

  updateData(data) {
    this.items = data.<featureKey> || [];
  }

  setContainer(container) {
    this.container = container;
  }

  render() {
    if (!this.container) return;
    // 更新头部统计条（避免"加载中..."残留）
    const headerStats = document.getElementById('stats');
    if (headerStats) {
      headerStats.textContent = '...'; // 或清空
    }
    this.container.innerHTML = this._buildHTML();
    this._bindEvents();
  }

  _buildHTML() { /* ... */ }
  _bindEvents() { /* ... */ }
}

export default <FeatureName>View;
```

### Phase 2: 注册到 AppShell

**修改 `modules/tabboard/tabboard.js`：**

1. **导入模块：**
   ```javascript
   import <FeatureName>Module from '../<feature-name>/index.js';
   ```

2. **添加导航按钮事件：**
   ```javascript
   document.getElementById('<featureName>ViewBtn')
     ?.addEventListener('click', () => this.switchView('<feature-name>'));
   ```

3. **添加视图路由：**
   ```javascript
   case '<feature-name>':
     container = document.getElementById('<featureName>Panel');
     ModuleClass = <FeatureName>Module;
     break;
   ```

4. **更新 UI 显隐：**
   ```javascript
   document.getElementById('<featureName>ViewBtn')
     ?.classList.toggle('active', viewName === '<feature-name>');
   document.getElementById('<featureName>View').style.display
     = viewName === '<feature-name>' ? 'block' : 'none';
   ```

### Phase 3: 添加 HTML 容器

**修改 `modules/tabboard/tabboard.html`：**

1. **导航栏添加按钮：**
   ```html
   <button id="<featureName>ViewBtn" class="nav-btn" title="...">Label</button>
   ```

2. **添加视图容器：**
   ```html
   <div id="<featureName>View" class="view-container" style="display: none;">
     <div id="<featureName>Panel"></div>
   </div>
   ```

3. **引入 CSS：**
   ```html
   <link rel="stylesheet" href="<feature-name>.css">
   ```

### Phase 4: CSS 分离（强制）

**每个模块必须有独立的 style.css，单文件不得超过 500 行。**

如果现有 `tabboard.css` 已超过 500 行，拆分策略：

```
modules/tabboard/tabboard.css   → 通用基础样式（:root, header, nav, buttons, 右键菜单, toast）
modules/group/style.css         → jKanban 看板样式
modules/timeline/style.css      → Timeline 视图样式
modules/leetcode/style.css      → LeetCode 面板样式
modules/<feature>/style.css     → 新模块样式
```

拆分后更新 `tabboard.html` 引入所有拆分后的 CSS 文件：
```html
<link rel="stylesheet" href="tabboard.css">
<link rel="stylesheet" href="../group/style.css">
<link rel="stylesheet" href="../timeline/style.css">
<link rel="stylesheet" href="../leetcode/style.css">
<link rel="stylesheet" href="../<feature>/style.css">
```

### Phase 5: 数据层注册

**修改 `modules/shared/data-manager.js`：**

1. 在 `this.data` 中添加新字段：
   ```javascript
   this.data = {
     // ...existing fields
     <featureKey>: {},
   };
   ```

2. 在 `loadData()` 的 `chrome.storage.local.get()` 参数中添加新 key
3. 在条件判断中添加新 key 的读取
4. 添加 getter

**修改 `background/init.js`：**

初始化新 storage key：
```javascript
const result = await chrome.storage.local.get(['<featureKey>']);
if (!result.<featureKey>) {
  await chrome.storage.local.set({ <featureKey>: {} });
}
```

---

## 头部统计条处理

切换视图时，头部 `#stats` 需要被当前视图更新，否则会残留"加载中..."或其他视图的数据。

**在 view.js 的 `render()` 中必须处理：**

```javascript
render() {
  const headerStats = document.getElementById('stats');
  if (headerStats) {
    // 显示本视图的统计摘要
    headerStats.textContent = '...';
  }
  // ...渲染主体
}
```

**各视图负责自己的统计：**
- TimelineView → `50 个快照 · 2382 个标签页`
- GroupView → `2382 个标签页 · 3/5 个分组显示`
- LeetCodeView → `45/150 已完成 · 30%`

---

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 未更新 `#stats`，直接 render | 头部残留"加载中..."或其他视图数据 | 每个 view.js 的 render() 必须更新 stats.textContent |
| CSS 全部堆在 tabboard.css | 文件超 500 行，维护困难，选择器冲突 | 每个模块独立 style.css，单文件 ≤500 行 |
| 忘记在 `switchView` 中销毁旧模块 | 事件重复绑定，内存泄漏 | 确保 `switchView()` 调用 `this.currentModule.destroy()` |
| 在 view.js 中直接操作 `chrome.storage` 但不处理 storage listener | 引发 render() 循环调用，DOM 闪烁 | 设置 `_lastUpdateTime` 标志跳过冗余渲染，或仅在 `render()` 中读取数据 |
| 新模块 HTML 容器使用 `display: none` 但 CSS 中无 `overflow` 控制 | 内容溢出，布局错乱 | 为 `#<featureName>Panel` 设置 `height: 100%; overflow-y: auto;` |
| 忘记在 DataManager 中注册新 key | 数据无法持久化，刷新后丢失 | 在 constructor、loadData、getter 中都要添加 |
| 选择跳转新页面方案，但数据需与主页面共享 | 数据同步复杂，storage change 监听不可靠 | 优先选择内嵌 view.js 方案 |
| import 路径写错 | Chrome 扩展加载失败：`Failed to load module` | 使用相对路径 `../<feature>/index.js`，从 `tabboard.js` 出发 |

---

## 验证清单

- [ ] 新模块目录创建：`modules/<feature>/`
- [ ] 3 个文件齐全：`index.js`、`view.js`、`<feature>.css`
- [ ] CSS 文件 ≤500 行
- [ ] tabboard.html 引入新 CSS `<link>`
- [ ] tabboard.html 添加导航按钮和视图容器
- [ ] tabboard.js 导入模块并注册到 `switchView`
- [ ] `_updateViewUI` 更新按钮 active 状态和容器 display
- [ ] DataManager 注册新 storage key
- [ ] background/init.js 初始化新 storage key
- [ ] view.js 的 `render()` 更新 `#stats`
- [ ] 浏览器中加载扩展无 404 错误
- [ ] 切换视图时统计信息正确更新
