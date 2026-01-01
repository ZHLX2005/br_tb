# 浏览器扩展项目文档

## 📚 文档目录

本文档集合详细介绍了浏览器扩展项目的各个技术点和实现原理。

### 核心文档

| 文档 | 描述 | 状态 |
|------|------|------|
| [01-OCR实现架构.md](./01-OCR实现架构.md) | OCR 功能的完整实现架构和工作流程 | ✅ |
| [02-动态快捷键原理.md](./02-动态快捷键原理.md) | 动态快捷键的设置、存储和监听机制 | ✅ |
| [03-消息通信机制.md](./03-消息通信机制.md) | Content Script 与 Background 的协作方式 | ✅ |
| [04-扩展功能区域.md](./04-扩展功能区域.md) | 项目使用的扩展区域及可扩展方向 | ✅ |

---

## 快速导航

### 🔍 按角色查看

**新手开发者**
- 建议阅读顺序：`扩展功能区域` → `消息通信机制` → `动态快捷键原理` → `OCR实现架构`

**功能扩展者**
- 重点阅读：`扩展功能区域` + `消息通信机制`

**架构学习者**
- 重点阅读：`OCR实现架构` + `动态快捷键原理` + `消息通信机制`

### 📖 按主题查看

#### 主题 1: OCR 功能实现
```
OCR实现架构.md
├── 整体架构图
├── 核心模块说明
│   ├── 区域选择模块
│   ├── 截图处理模块
│   ├── API 调用模块
│   └── 结果展示模块
├── 数据流转过程
└── 关键技术点
```

#### 主题 2: 动态快捷键系统
```
动态快捷键原理.md
├── 系统架构
├── 设置流程
├── 存储机制
├── 同步机制
└── 事件监听
```

#### 主题 3: 消息通信
```
消息通信机制.md
├── 通信方式概览
├── chrome.runtime.sendMessage
├── chrome.storage
├── chrome.tabs API
└── 实战案例
```

#### 主题 4: 扩展区域
```
扩展功能区域.md
├── 已使用区域
├── 技术栈
├── 可扩展方向
└── 最佳实践
```

---

## 项目结构概览

```
test_feature/
├── manifest.json              # 扩展配置文件
├── background.js              # Service Worker 入口
├── backgrounds/               # Background 模块目录
│   ├── index.js              # 主入口
│   ├── contextMenu.js        # 右键菜单
│   ├── messageHandler.js     # 消息处理
│   ├── storage.js            # 存储管理
│   └── ocr.js                # OCR 功能
├── popup/                     # Popup 弹窗
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/                   # Content Scripts
│   ├── content.js            # 翻译功能
│   ├── content-ocr.js        # OCR 功能
│   └── content.css
├── modules/                   # 功能模块
│   ├── favorites/            # 收藏列表
│   └── browser-bookmarks/    # 书签管理
└── docs/                      # 项目文档
    └── (本文档集合)
```

---

## 技术栈

- **扩展版本**: Manifest V3
- **模块系统**: ES6 Modules
- **存储**: chrome.storage.local
- **通信**: chrome.runtime.sendMessage
- **API**: 智谱 AI GLM-4.5V (OCR)

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0 | 2025-01-01 | 初始版本，包含核心功能文档 |

---

## 贡献指南

如需补充或修改文档，请遵循以下规范：

1. **文件命名**: 使用数字前缀便于排序，如 `01-XXX.md`
2. **Markdown 格式**: 使用标准 Markdown 语法
3. **代码示例**: 提供可运行的代码片段
4. **图表说明**: 使用 ASCII 图或流程图说明复杂流程

---

## 联系方式

如有问题或建议，请通过以下方式联系：

- 项目 Issues: [GitHub Issues](链接)
- 开发者邮箱: [your-email@example.com]
