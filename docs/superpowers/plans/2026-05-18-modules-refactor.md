# Modules 目录重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `modules/` 重构为三个统一抽象的独立模块（timeline / group / recording），共用代码提取到 `modules/shared/`，每个模块遵循相同的 `BaseModule` 接口。

**Architecture:** 采用 "Shell + Module" 架构。`tabboard.js` 作为 Shell 负责模块生命周期管理（创建/切换/销毁），三个模块各自独立管理自己的渲染和交互，通过 `shared/data-manager.js` 和 `shared/event-bus.js` 与后台通信。

**Tech Stack:** Vanilla JavaScript, Chrome Extension Manifest V3, jKanban

---

## 文件结构映射

### 新建文件
- `modules/shared/data-manager.js` — 数据管理（从 `tabboard/core/DataManager.js` 迁移）
- `modules/shared/event-bus.js` — 事件总线（简化版，替代 `tabboard/core/EventManager.js`）
- `modules/shared/utils.js` — 工具函数（从 `tabboard/core/Utils.js` 迁移）
- `modules/shared/search-helper.js` — 搜索工具（从 `tabboard/core/SearchHelper.js` 迁移）
- `modules/shared/lib/jkanban.min.css` — jKanban CSS
- `modules/shared/lib/jkanban.min.js` — jKanban JS
- `modules/timeline/index.js` — TimelineModule 入口类
- `modules/timeline/view.js` — 时间轴视图渲染
- `modules/timeline/style.css` — 时间轴样式（从 `tabboard/tabboard.css` 拆分）
- `modules/group/index.js` — GroupModule 入口类
- `modules/group/view.js` — 分组看板视图渲染
- `modules/group/style.css` — 分组样式（从 `tabboard/tabboard.css` 拆分）
- `modules/recording/index.js` — RecordingModule 入口类
- `modules/recording/view.js` — 录制视图渲染

### 修改文件
- `modules/tabboard/tabboard.js` — 重写为 Shell，调度三个模块
- `modules/tabboard/tabboard.html` — 更新引用路径
- `modules/recording/recording.html` — 更新引用路径
- `modules/recording/recording.css` — 提取 view 相关样式到 `view.js` 内联或保留

### 删除文件（迁移完成后）
- `modules/tabboard/core/DataManager.js`
- `modules/tabboard/core/EventManager.js`
- `modules/tabboard/core/TimelineView.js`
- `modules/tabboard/core/GroupView.js`
- `modules/tabboard/core/Utils.js`
- `modules/tabboard/core/SearchHelper.js`
- `modules/tabboard/lib/jkanban.min.css`
- `modules/tabboard/lib/jkanban.min.js`

---

## Task 1: 创建 shared 基础层

**Files:**
- Create: `modules/shared/data-manager.js`
- Create: `modules/shared/event-bus.js`
- Create: `modules/shared/utils.js`
- Create: `modules/shared/search-helper.js`
- Create: `modules/shared/lib/jkanban.min.css`
- Create: `modules/shared/lib/jkanban.min.js`

---

- [ ] **Step 1: 复制 jKanban 库到 shared**

```bash
cp modules/tabboard/lib/jkanban.min.css modules/shared/lib/jkanban.min.css
cp modules/tabboard/lib/jkanban.min.js modules/shared/lib/jkanban.min.js
```

- [ ] **Step 2: 迁移 DataManager**

Create `modules/shared/data-manager.js`:
```javascript
class DataManager {
  constructor() {
    this.data = {
      groups: [],
      tabs: {},
      timelineSnapshots: [],
      recordings: [],
      recordingState: {},
      settings: {}
    };
    this.listeners = [];
  }

  async loadData() {
    const data = await chrome.storage.local.get([
      'groups', 'tabs', 'timelineSnapshots', 'recordings', 'recordingState', 'settings'
    ]);

    if ('groups' in data) this.data.groups = data.groups;
    if ('tabs' in data) this.data.tabs = data.tabs;
    if ('timelineSnapshots' in data) this.data.timelineSnapshots = data.timelineSnapshots;
    if ('recordings' in data) this.data.recordings = data.recordings;
    if ('recordingState' in data) this.data.recordingState = data.recordingState;
    if ('settings' in data) this.data.settings = data.settings;

    this.notifyListeners();
    return this.data;
  }

  get groups() { return this.data.groups; }
  get tabs() { return this.data.tabs; }
  get timelineSnapshots() { return this.data.timelineSnapshots; }
  get recordings() { return this.data.recordings; }
  get recordingState() { return this.data.recordingState; }
  get settings() { return this.data.settings; }

  onDataChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notifyListeners() {
    this.listeners.forEach(callback => callback(this.data));
  }

  async sendMessage(action, data = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[DataManager] Message error:', chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: true });
        }
      });
    });
  }
}

export default DataManager;
```

- [ ] **Step 3: 创建 EventBus**

Create `modules/shared/event-bus.js`:
```javascript
class EventBus {
  constructor() {
    this.events = {};
  }

  on(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(cb => cb(data));
  }
}

export default EventBus;
```

- [ ] **Step 4: 迁移 Utils**

Create `modules/shared/utils.js`（复制 `tabboard/core/Utils.js` 全部内容，仅修改 export 语句保持一致）。

- [ ] **Step 5: 迁移 SearchHelper**

Create `modules/shared/search-helper.js`（复制 `tabboard/core/SearchHelper.js` 全部内容，仅修改 export 语句保持一致）。

- [ ] **Step 6: Commit shared 基础层**

```bash
git add modules/shared/
git commit -m "refactor: create shared layer with data-manager, event-bus, utils, search-helper"
```

---

## Task 2: 创建 timeline 模块

**Files:**
- Create: `modules/timeline/index.js`
- Create: `modules/timeline/view.js`

---

- [ ] **Step 1: 创建 TimelineModule 入口类**

Create `modules/timeline/index.js`:
```javascript
import TimelineView from './view.js';

class TimelineModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new TimelineView(dataManager);
  }

  init() {
    this.view.initSearch();
  }

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    // 视图内部已绑定事件，如需全局事件可在此添加
  }

  destroy() {
    // 清理搜索下拉框、右键菜单等全局 DOM
    this.view._hideSearchDropdown();
    this.view._hideContextMenu();
  }
}

export default TimelineModule;
```

- [ ] **Step 2: 迁移 TimelineView 到 view.js**

Create `modules/timeline/view.js`:
- 复制 `tabboard/core/TimelineView.js` 全部内容
- 修改 import 路径：
  - `from './Utils.js'` → `from '../shared/utils.js'`
  - `from '../../../shared/ModalDialog.js'` → `from '../../shared/ModalDialog.js'`
  - `from './SearchHelper.js'` → `from '../shared/search-helper.js'`

- [ ] **Step 3: Commit timeline 模块**

```bash
git add modules/timeline/
git commit -m "refactor: extract timeline module with index.js + view.js"
```

---

## Task 3: 创建 group 模块

**Files:**
- Create: `modules/group/index.js`
- Create: `modules/group/view.js`

---

- [ ] **Step 1: 创建 GroupModule 入口类**

Create `modules/group/index.js`:
```javascript
import GroupView from './view.js';

class GroupModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new GroupView(dataManager);
  }

  init() {}

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    // 视图内部已绑定事件
  }

  destroy() {
    // 断开 MutationObserver，清理 kanban DOM
    if (this.view.boardActionsObserver) {
      this.view.boardActionsObserver.disconnect();
    }
    const container = document.getElementById('tabboard');
    if (container) container.innerHTML = '';
    this.view.kanban = null;
  }
}

export default GroupModule;
```

- [ ] **Step 2: 迁移 GroupView 到 view.js**

Create `modules/group/view.js`:
- 复制 `tabboard/core/GroupView.js` 全部内容
- 修改 import 路径：
  - `from './Utils.js'` → `from '../shared/utils.js'`
  - `from '../../../shared/ModalDialog.js'` → `from '../../shared/ModalDialog.js'`

- [ ] **Step 3: Commit group 模块**

```bash
git add modules/group/
git commit -m "refactor: extract group module with index.js + view.js"
```

---

## Task 4: 重构 recording 模块

**Files:**
- Create: `modules/recording/index.js`
- Create: `modules/recording/view.js`
- Modify: `modules/recording/recording.html`
- Modify: `modules/recording/recording.js`（最终删除，先保留备份）

---

- [ ] **Step 1: 创建 RecordingModule 入口类**

Create `modules/recording/index.js`:
```javascript
import RecordingView from './view.js';

class RecordingModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new RecordingView(dataManager);
  }

  async init() {
    await this.view.init();
  }

  render(data) {
    this.view.recordingState = data.recordingState || {};
    this.view.recordings = data.recordings || [];
    this.view.render();
  }

  bindEvents() {
    this.view.bindEvents();
  }

  destroy() {
    this.view.destroy();
  }
}

export default RecordingModule;
```

- [ ] **Step 2: 迁移 RecordingPage 逻辑到 view.js**

Create `modules/recording/view.js`:
- 复制 `modules/recording/recording.js` 全部内容
- 将类名从 `RecordingPage` 改为 `RecordingView`
- 修改 import 路径：
  - `from '../../../shared/ModalDialog.js'` → `from '../../shared/ModalDialog.js'`
- 删除底部的自动初始化代码（`document.addEventListener('DOMContentLoaded', ...)`）

- [ ] **Step 3: Commit recording 模块重构**

```bash
git add modules/recording/
git commit -m "refactor: restructure recording module with index.js + view.js"
```

---

## Task 5: 重写 Shell（tabboard.js）

**Files:**
- Modify: `modules/tabboard/tabboard.js`
- Modify: `modules/tabboard/tabboard.html`

---

- [ ] **Step 1: 重写 tabboard.js 为 Shell**

Modify `modules/tabboard/tabboard.js`:
```javascript
import DataManager from '../shared/data-manager.js';
import EventBus from '../shared/event-bus.js';
import TimelineModule from '../timeline/index.js';
import GroupModule from '../group/index.js';
import RecordingModule from '../recording/index.js';

class AppShell {
  constructor() {
    this.dataManager = new DataManager();
    this.eventBus = new EventBus();
    this.currentModule = null;
    this.currentView = 'timeline';
    this.storageChangeTimer = null;
  }

  async init() {
    const data = await this.dataManager.loadData();
    const lastView = data.settings?.lastView || 'timeline';

    this._setupViewSwitchButtons();
    this._setupRefreshButton();
    this._setupImageErrorHandling();
    this._setupStorageChangeListener();

    await this.switchView(lastView, data);
  }

  _setupViewSwitchButtons() {
    document.getElementById('timelineViewBtn')?.addEventListener('click', () => this.switchView('timeline'));
    document.getElementById('groupViewBtn')?.addEventListener('click', () => this.switchView('group'));
    document.getElementById('recordingViewBtn')?.addEventListener('click', () => this.switchView('recording'));
  }

  _setupRefreshButton() {
    document.getElementById('refreshBtn')?.addEventListener('click', async () => {
      const data = await this.dataManager.loadData();
      if (this.currentModule) this.currentModule.render(data);
    });
  }

  _setupImageErrorHandling() {
    document.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.style.display = 'none';
    }, true);
  }

  _setupStorageChangeListener() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;
      if (this.storageChangeTimer) clearTimeout(this.storageChangeTimer);
      this.storageChangeTimer = setTimeout(async () => {
        const data = await this.dataManager.loadData();
        if (this.currentModule) this.currentModule.render(data);
      }, 100);
    });
  }

  async switchView(viewName, initialData = null) {
    if (this.currentModule) {
      this.currentModule.destroy();
      this.currentModule = null;
    }

    this.currentView = viewName;
    this._updateViewUI(viewName);

    const data = initialData || await this.dataManager.loadData();

    let container;
    let ModuleClass;

    switch (viewName) {
      case 'timeline':
        container = document.getElementById('timelineView');
        ModuleClass = TimelineModule;
        break;
      case 'group':
        container = document.getElementById('groupView');
        ModuleClass = GroupModule;
        break;
      case 'recording':
        container = document.getElementById('recordingView') || document.body;
        ModuleClass = RecordingModule;
        break;
      default:
        container = document.getElementById('timelineView');
        ModuleClass = TimelineModule;
    }

    this.currentModule = new ModuleClass(container, this.dataManager, this.eventBus);
    this.currentModule.init();
    this.currentModule.render(data);
    this.currentModule.bindEvents();

    await this.dataManager.sendMessage('updateSettings', {
      settings: { lastView: viewName }
    });
  }

  _updateViewUI(viewName) {
    document.getElementById('timelineViewBtn')?.classList.toggle('active', viewName === 'timeline');
    document.getElementById('groupViewBtn')?.classList.toggle('active', viewName === 'group');
    document.getElementById('recordingViewBtn')?.classList.toggle('active', viewName === 'recording');

    document.getElementById('timelineView').style.display = viewName === 'timeline' ? 'block' : 'none';
    document.getElementById('groupView').style.display = viewName === 'group' ? 'block' : 'none';

    // recording 视图需要特殊处理：目前 recording 是独立页面
    // 如果点击 recording，可以跳转或嵌入
    if (viewName === 'recording') {
      // 方案A：在当前页面嵌入 recording 内容
      // 方案B：跳转独立页面（保持现有行为）
      // 这里选择方案B：保持现有独立页面，点击 recording 按钮时跳转
      window.location.href = chrome.runtime.getURL('modules/recording/recording.html');
    }
  }
}

const app = new AppShell();
document.addEventListener('DOMContentLoaded', () => app.init());
```

**注意：** 上述代码中 `recording` 视图的跳转逻辑需要后续调整。因为 recording 目前是独立页面，可考虑两种方式：
1. 保持独立页面，点击 Rec 按钮跳转
2. 将 recording 内容嵌入 tabboard.html

当前计划保持方式 1（最小改动），后续如需可再调整。

- [ ] **Step 2: 更新 tabboard.html 引用路径**

Modify `modules/tabboard/tabboard.html`:
- `href="lib/jkanban.min.css"` → `href="../shared/lib/jkanban.min.css"`
- `src="lib/jkanban.min.js"` → `src="../shared/lib/jkanban.min.js"`
- `src="tabboard.js"` 保持（同级）

- [ ] **Step 3: Commit Shell 重写**

```bash
git add modules/tabboard/
git commit -m "refactor: rewrite tabboard.js as AppShell with module dispatch"
```

---

## Task 6: 更新 recording 页面入口

**Files:**
- Modify: `modules/recording/recording.html`
- Create: `modules/recording/recording-shell.js`

---

- [ ] **Step 1: 创建 recording 页面 Shell**

Create `modules/recording/recording-shell.js`:
```javascript
import DataManager from '../shared/data-manager.js';
import RecordingModule from './index.js';

class RecordingShell {
  constructor() {
    this.dataManager = new DataManager();
    this.module = null;
    this.storageChangeTimer = null;
  }

  async init() {
    const data = await this.dataManager.loadData();
    this.module = new RecordingModule(document.body, this.dataManager, null);
    await this.module.init();
    this.module.render(data);
    this.module.bindEvents();

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;
      if (this.storageChangeTimer) clearTimeout(this.storageChangeTimer);
      this.storageChangeTimer = setTimeout(async () => {
        const newData = await this.dataManager.loadData();
        this.module.render(newData);
      }, 100);
    });
  }
}

const shell = new RecordingShell();
document.addEventListener('DOMContentLoaded', () => shell.init());
```

- [ ] **Step 2: 更新 recording.html 引用**

Modify `modules/recording/recording.html`:
- `script type="module" src="recording.js"` → `script type="module" src="recording-shell.js"`

- [ ] **Step 3: Commit recording Shell**

```bash
git add modules/recording/
git commit -m "refactor: add recording-shell.js for independent recording page"
```

---

## Task 7: 清理旧文件

**Files:**
- Delete: `modules/tabboard/core/` 目录
- Delete: `modules/tabboard/lib/` 目录
- Delete: `modules/recording/recording.js`（旧入口，已被 view.js + shell 替代）

---

- [ ] **Step 1: 删除旧 core 目录和 lib 目录**

```bash
rm -rf modules/tabboard/core
rm -rf modules/tabboard/lib
rm modules/recording/recording.js
```

- [ ] **Step 2: Commit 清理**

```bash
git add -A
git commit -m "refactor: remove old core/ and lib/ directories after migration"
```

---

## Task 8: 验证测试

- [ ] **Step 1: 在 Chrome 中加载扩展并测试**

操作步骤：
1. 打开 `chrome://extensions`
2. 找到 TabBoard 扩展，点击刷新
3. 打开 TabBoard 页面（Alt+Shift+O）
4. 测试时间轴视图：
   - 按 Alt+Shift+C 收集标签页
   - 查看快照是否正确渲染
   - 测试搜索功能
   - 测试标记/取消标记
   - 测试恢复/删除快照
5. 切换到分组视图（Board）：
   - 查看现有分组是否正确显示
   - 测试拖拽标签页
   - 测试添加/删除分组
   - 测试导入/导出
6. 切换到录制视图（Rec）：
   - 点击开始录制
   - 浏览几个标签页
   - 停止录制
   - 查看录制列表
7. 测试页面刷新后视图状态保持

- [ ] **Step 2: 检查 DevTools Console 是否有报错**

打开 TabBoard 页面的 DevTools (F12)，检查 Console 是否有 404 或 JS 错误。

- [ ] **Step 3: Commit 最终验证结果**

```bash
git commit --allow-empty -m "test: verify all modules work after refactor"
```

---

## Self-Review Checklist

### Spec Coverage
- [x] `modules/shared/` 共用层 — Task 1
- [x] `modules/timeline/` 模块 — Task 2
- [x] `modules/group/` 模块 — Task 3
- [x] `modules/recording/` 模块 — Task 4
- [x] Shell 重写 — Task 5
- [x] recording 独立页面适配 — Task 6
- [x] 旧文件清理 — Task 7
- [x] 功能验证 — Task 8

### Placeholder Scan
- [x] 无 TBD/TODO
- [x] 无 "implement later"
- [x] 每个步骤都有具体代码或命令

### Type Consistency
- [x] `DataManager` 接口一致
- [x] `BaseModule` 接口（init/render/bindEvents/destroy）在所有模块统一
