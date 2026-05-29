---
name: module-unification
description: 当用户要求重构模块目录、统一模块结构、拆分功能模块、或新增模块时触发。适用于 Chrome 扩展或前端项目的模块化重构。
---
# Module Unification — 模块统一化重构

## 触发条件

- "重构 modules 目录"
- "统一模块结构"
- "拆分功能模块"
- "新增模块"
- "保持统一的目录结构"
- "模块使用相同的方式抽象"

## 核心原则

1. **一模块一目录**：每个功能模块独占一个目录，禁止混合多个功能
2. **接口统一**：所有模块实现相同的生命周期接口
3. **共享层独立**：共用代码提取到 `shared/`，禁止模块间直接耦合
4. **Shell 调度**：页面入口只负责模块生命周期管理，不处理业务逻辑

## 标准化目录结构

```
modules/
├── <feature-a>/           # 功能模块 A
│   ├── index.js           # 模块入口类（必须实现 BaseModule 接口）
│   ├── view.js            # DOM 渲染与事件绑定
│   └── style.css          # 模块样式（从原大文件拆分）
├── <feature-b>/           # 功能模块 B
│   ├── index.js
│   ├── view.js
│   └── style.css
├── <feature-c>/           # 功能模块 C
│   ├── index.js
│   ├── view.js
│   └── style.css
└── shared/                # 共享层（模块间共用）
    ├── data-manager.js    # 数据管理
    ├── event-bus.js       # 事件总线
    ├── utils.js           # 工具函数
    ├── search-helper.js   # 搜索/过滤工具
    └── lib/               # 第三方库
        └── ...
```

## BaseModule 接口规范

每个模块必须实现以下接口：

```javascript
class BaseModule {
  /**
   * @param {HTMLElement} container - 渲染容器
   * @param {DataManager} dataManager - 数据管理实例
   * @param {EventBus} eventBus - 事件总线实例
   */
  constructor(container, dataManager, eventBus) {}

  /** 初始化（搜索框、状态恢复等） */
  init() {}

  /** 渲染视图（接收完整 data 对象） */
  render(data) {}

  /** 绑定全局事件（如需） */
  bindEvents() {}

  /** 销毁（清理定时器、observer、全局 DOM） */
  destroy() {}
}
```

## 迁移流程（必须按序执行）

### Phase 1: 建立共享层

1. 创建 `modules/shared/` 目录
2. 迁移共用代码（DataManager、EventManager、Utils、第三方库等）
3. **关键步骤**：全局搜索所有对旧路径的引用，确保无遗漏
4. Commit: `refactor: create shared layer`

### Phase 2: 逐个提取模块

对每个功能模块：

1. 创建 `modules/<feature>/` 目录
2. 创建 `index.js`：实现 BaseModule 接口，引入 `view.js`
3. 创建 `view.js`：从原大文件中迁移视图代码，**更新所有 import 路径**
4. Commit: `refactor: extract <feature> module`

### Phase 3: 重写 Shell

1. 重写页面入口为 `AppShell`，负责：
   - 初始化 DataManager / EventBus
   - 根据当前视图 `new` 对应模块
   - 调用 `module.init()` → `module.render(data)` → `module.bindEvents()`
   - 切换视图时：`module.destroy()` → 创建新模块
2. Commit: `refactor: rewrite shell with module dispatch`

### Phase 4: 更新独立页面入口

如果某个模块有独立页面（如 recording.html）：

1. 创建 `-shell.js` 作为该页面的独立入口
2. 使用 DataManager + Module 初始化并渲染
3. 更新 HTML 的 `script src`
4. Commit: `refactor: add <feature>-shell.js`

### Phase 5: 清理旧文件

1. 删除已迁移的旧目录和文件
2. **再次全局搜索旧路径引用**，确认无遗漏
3. Commit: `refactor: remove old directories after migration`

### Phase 6: 验证

1. 在浏览器/目标环境中加载项目
2. 逐个验证每个模块的功能
3. 检查 Console 是否有 404 或模块加载错误

## 错误案例

| 错误操作                                                                                          | 实际后果                                                                                      | 正确做法                                                                     |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 只检查 `modules/` 内的 import 路径，未检查 `background/`、`popup/`、`content/` 等外部目录 | Chrome 扩展 service worker 加载失败：`"An unknown error occurred when fetching the script"` | 重构前用 `grep -r "旧路径"` 全局搜索所有引用                               |
| 删除旧文件后立即 commit，未验证运行时加载                                                         | 运行时模块解析失败，功能不可用                                                                | 删除前先验证新路径已正确更新在所有文件中                                     |
| 模块入口 `index.js` 未实现 `destroy()`                                                        | 切换视图时内存泄漏、重复事件绑定、DOM 污染                                                    | 每个模块必须清理 timer、observer、全局插入的 DOM                             |
| 将第三方库留在某个模块目录下                                                                      | 其他模块引用路径混乱，重复依赖                                                                | 所有第三方库统一放入 `modules/shared/lib/`                                 |
| view.js 保留页面自动初始化代码                                                                    | 模块在 Shell 外部被意外初始化，导致重复渲染                                                   | 移除 `document.addEventListener('DOMContentLoaded', ...)` 等自动初始化逻辑 |

## 新增模块快速指南

基于现有共享层，新增一个模块只需 3 个文件：

### Step 1: 创建模块目录

```bash
mkdir -p modules/<feature-name>
```

### Step 2: 复制模板代码

**`modules/<feature-name>/index.js` — 入口类（可直接复制）**

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
    // 初始化搜索框、状态恢复等
  }

  render(data) {
    this.view.updateData?.(data);
    this.view.render?.(data);
  }

  bindEvents() {
    // 绑定跨组件全局事件
  }

  destroy() {
    // 必须清理：定时器、MutationObserver、全局插入的 DOM、事件监听
    // this.view._hideDropdown?.();
    // this.observer?.disconnect();
  }
}

export default <FeatureName>Module;
```

**`modules/<feature-name>/view.js` — 视图类（骨架）**

```javascript
import { escapeHtml } from '../shared/utils.js';
import { modal } from '../../shared/ModalDialog.js';

class <FeatureName>View {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.items = [];
  }

  updateData(data) {
    this.items = data.<featureName>Items || [];
  }

  render() {
    const container = document.getElementById('<featureName>List>');
    if (!container) return;

    if (this.items.length === 0) {
      container.innerHTML = this._renderEmptyState();
      return;
    }

    container.innerHTML = this.items.map(item => this._renderItem(item)).join('');
    this._bindItemEvents();
  }

  _renderEmptyState() {
    return `<div class="empty-state">暂无数据</div>`;
  }

  _renderItem(item) {
    return `
      <div class="item-row" data-id="${item.id}">
        <span>${escapeHtml(item.title)}</span>
      </div>
    `;
  }

  _bindItemEvents() {
    document.querySelectorAll('.item-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        this._handleItemClick(id);
      });
    });
  }

  async _handleItemClick(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    // 业务逻辑...
  }
}

export default <FeatureName>View;
```

**`modules/<feature-name>/style.css` — 样式（独立文件）**

```css
/* 仅包含本模块的样式，命名加前缀避免冲突 */
.<feature-name>-list { }
.<feature-name>-item { }
.<feature-name>-empty-state { }
```

### Step 3: 注册到 Shell

在 `modules/tabboard/tabboard.js` 的 `AppShell` 中：

1. `import <FeatureName>Module from '../<feature-name>/index.js';`
2. 在 `switchView` 的 switch 语句中新增 case
3. 在 HTML 中新增容器 `<div id="<featureName>View">`

### Step 4: Commit

```bash
git add modules/<feature-name>/
git commit -m "feat: add <feature-name> module"
```

## 健壮性规范

### 防御式编程（view.js 中必须遵守）

| 场景                           | 规范                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| DOM 元素不存在                 | `const el = document.getElementById('x'); if (!el) return;` |
| 数据为空                       | 渲染空状态，不抛异常                                          |
| 异步操作                       | 始终 `try/catch`，错误时 toast 提示                         |
| 动态插入的 DOM                 | 用 class + 事件委托，避免重复绑定                             |
| 全局搜索/右键菜单              | 先执行 `_hideXxx()` 再创建新的，防止叠加                    |
| 定时器                         | 在 `destroy()` 中 `clearInterval` / `clearTimeout`      |
| `chrome.runtime.sendMessage` | 检查 `chrome.runtime.lastError`                             |

### 命名规范

| 层级      | 前缀/后缀                  | 示例                      |
| --------- | -------------------------- | ------------------------- |
| 模块目录  | 小写连字符                 | `modules/focus-search/` |
| 入口类    | `Module` 后缀            | `FocusSearchModule`     |
| 视图类    | `View` 后缀              | `FocusSearchView`       |
| CSS 类名  | 模块名前缀                 | `.focus-search-list`    |
| data 属性 | `data-<feature>-<field>` | `data-focus-search-id`  |

### 性能约束

- `render()` 使用 `innerHTML` 批量更新，禁止逐元素 `appendChild`
- 搜索防抖 `150ms`
- 列表项懒加载图片 `loading="lazy"`
- 大数据集使用虚拟滚动或分页

## 验证清单

- [ ] 全局 grep 确认无旧路径残留
- [ ] 所有模块实现 `init / render / bindEvents / destroy`
- [ ] `shared/` 层无业务逻辑，只有纯工具/数据管理
- [ ] Shell 不处理任何业务逻辑，只调度模块生命周期
- [ ] 第三方库在 `shared/lib/`
- [ ] 在目标环境中加载无报错
- [ ] 各模块功能逐一验证通过
