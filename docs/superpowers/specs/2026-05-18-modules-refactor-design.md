# Modules 目录重构设计文档

## 背景

当前 `modules/` 目录结构不统一：
- `modules/recording/` 为独立功能模块（js/css/html）
- `modules/tabboard/` 为混合大模块，内部同时包含 Timeline、Group、Recording 三个功能的视图代码

目标：将三个功能（时间轴、分组看板、记录回放）拆分为独立的、结构统一的模块。

## 目标目录结构

```
modules/
├── timeline/
│   ├── index.js       # TimelineModule 类（入口）
│   ├── view.js        # 时间轴 DOM 渲染
│   └── style.css      # 时间轴样式（从 tabboard.css 拆分）
├── group/
│   ├── index.js       # GroupModule 类（入口）
│   ├── view.js        # 看板 DOM 渲染
│   └── style.css      # 看板样式
├── recording/
│   ├── index.js       # RecordingModule 类（入口）
│   ├── view.js        # 录制回放 DOM 渲染
│   └── style.css      # 录制样式
└── shared/
    ├── data-manager.js  # 数据管理（原 tabboard/core/DataManager.js）
    ├── event-bus.js     # 事件总线（原 tabboard/core/EventManager.js）
    ├── utils.js         # 共用工具函数
    └── lib/
        ├── jkanban.min.css
        └── jkanban.min.js
```

## 统一模块接口

每个模块必须实现以下接口：

```javascript
class BaseModule {
  constructor(container, dataManager, eventBus) {}
  init() {}
  render(data) {}
  bindEvents() {}
  destroy() {}
}
```

具体模块：
- `TimelineModule` — 时间轴快照列表、标记、恢复
- `GroupModule` — 看板分组、拖拽、标签页管理
- `RecordingModule` — 录制会话、回放、管理

## 数据流

```
Shell (tabboard.js)
    ├── 调用 DataManager.loadData()
    ├── 根据当前视图 new TimelineModule() / GroupModule() / RecordingModule()
    ├── module.init() → module.render(data) → module.bindEvents()
    └── 切换视图时：module.destroy() → 创建新模块
```

## 迁移清单

1. 创建 `modules/shared/` 目录，迁移共用代码
2. 创建 `modules/timeline/`，从 `tabboard/core/TimelineView.js` 重构
3. 创建 `modules/group/`，从 `tabboard/core/GroupView.js` + jKanban 重构
4. 重构 `modules/recording/`，对齐统一接口
5. 更新 `tabboard/tabboard.js` 为 Shell，负责模块调度
6. 更新 `background/index.js` 中的消息路由（如有路径变更）
7. 更新 `manifest.json` web_accessible_resources（如有路径变更）
