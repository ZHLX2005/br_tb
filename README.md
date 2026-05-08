# Browser_Tab

一款 Chrome 浏览器标签页管理扩展，类似于 OneTab但功能更丰富。采用纯 JavaScript 和 Chrome Extension Manifest V3 构建，无需构建工具。

## 功能特点

- **标签分组** - 将标签页整理到彩色分组中，支持拖拽排序
- **时间线快照** - 捕获和恢复浏览会话
- **会话录制** - 自动捕获浏览会话
- **键盘快捷键** - 常用操作一键完成

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt+Shift+A` | 将当前标签页添加到默认分组 |
| `Alt+Shift+C` | 将当前窗口所有标签页收集到时间线快照 |
| `Alt+Shift+X` | 收集除当前页面外的所有标签页 |
| `Alt+Shift+O` | 打开 TabBoard |

## 安装方法

1. 打开 `chrome://extensions`
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本项目根目录

## 项目结构

```
├── background/          # Service worker 模块
│   ├── index.js        # 入口文件
│   ├── commands.js     # 快捷键处理
│   ├── groups.js       # 分组管理
│   ├── timeline.js     # 时间线快照
│   └── recording.js    # 会话录制
├── modules/
│   ├── tabboard/       # 主应用
│   │   └── core/       # 核心模块 (DataManager, Views, Utils)
│   └── recording/      # 录制功能 UI
├── content/            # 内容脚本
├── popup/              # 浏览器动作弹窗
└── lib/                # 第三方库 (jKanban)
```

## 技术栈

- 原生 JavaScript（无构建工具）
- Chrome Extension Manifest V3
- jKanban 拖拽看板库

## 开发说明

修改后立即生效：
- **后台脚本**：在 `chrome://extensions` 点击扩展卡片上的刷新按钮
- **前端模块**：刷新 TabBoard 页面（F5）

## 数据存储

所有数据存储在 `chrome.storage.local` 中：
- 分组和标签页
- 时间线快照
- 录制记录
- 设置选项

## License

MIT
