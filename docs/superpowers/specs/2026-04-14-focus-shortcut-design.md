# 专注快捷键 - 全局标签页搜索浮层 设计文档

## 概述

为 TabBoard 扩展添加全局键盘驱动的标签页切换器。在任意网页上按下快捷键，即可弹出模糊搜索浮层，通过键盘上下导航、回车跳转，实现无鼠标快速切换标签页。跳转后的标签页自动收藏到 "History" 分组。

## 架构

```
用户按下 Alt+Shift+S
    ↓
Chrome Commands 触发 focus-search 命令
    ↓
Background 向当前活动标签页注入 focus-search.js
    ↓
浮层显示，搜索输入框聚焦
    ↓
输入搜索词 → fuzzyMatchOrdered 过滤 chrome.tabs.query({}) 结果
    ↓
↑↓ 键导航候选列表，回车跳转到选中标签并添加到 History 分组
    ↓
ESC 或 点击遮罩 关闭浮层
```

## 组件清单

### 1. manifest.json — 新增 Chrome Command

在 `commands` 中注册 `focus-search`：

```json
"focus-search": {
  "description": "打开专注搜索浮层",
  "suggested_key": {
    "default": "Alt+Shift+S"
  }
}
```

### 2. content/focus-search.js — 浮层内容脚本

**职责：**
- 接收 background 发来的 `showFocusSearch` 消息
- 动态向页面 DOM 注入浮层 UI（搜索框 + 结果列表）
- 通过 `chrome.runtime.sendMessage` 获取所有打开的标签页
- 使用 `fuzzyMatchOrdered`（复用 timeline.js 的有序字符匹配算法）对标题和 URL 进行模糊过滤
- 键盘事件处理：↑↓ 导航、Enter 跳转、ESC 关闭
- 跳转时向 background 发送 `addToHistoryGroup` 消息

**浮层 UI 结构：**

```html
<div id="focus-search-overlay">
  <div class="focus-search-modal">
    <div class="focus-search-header">
      <input type="text" id="focus-search-input" placeholder="搜索标签页..." autofocus>
    </div>
    <div class="focus-search-results">
      <!-- 动态填充 -->
    </div>
    <div class="focus-search-footer">
      <span>↑↓ 导航</span>
      <span>Enter 跳转</span>
      <span>ESC 关闭</span>
    </div>
  </div>
</div>
```

**搜索算法（复用 timeline.js）：**

```javascript
function fuzzyMatchOrdered(text, query) {
  if (!text || !query) return true;
  text = text.toLowerCase();
  query = query.toLowerCase();
  let textIdx = 0, queryIdx = 0;
  while (textIdx < text.length && queryIdx < query.length) {
    if (text[textIdx] === query[queryIdx]) queryIdx++;
    textIdx++;
  }
  return queryIdx === query.length;
}
```

**匹配评分规则：**

| 等级 | 条件 | 排序权重 |
|------|------|----------|
| 精确匹配 | 标题完全等于搜索词 | 最高 |
| 开头匹配 | 标题以搜索词开头 | 次高 |
| 包含匹配 | 标题包含搜索词 | 中 |
| URL匹配 | URL 包含搜索词 | 较低 |
| 模糊匹配 | fuzzyMatchOrdered 匹配 | 最低 |

### 3. content/focus-search.css — 浮层样式

**设计规范：**
- 遮罩：半透明黑色背景 `rgba(0, 0, 0, 0.5)`
- 浮层：居中白色卡片，圆角 12px，宽度 560px，最大高度 480px
- 输入框：全宽，无边框，24px 字号，底部内边距
- 结果项：紧凑行高，显示 favicon + 标题 + URL，hover 高亮，键盘选中项蓝色背景
- 选中项：`aria-selected` 状态蓝色 `#e3f2fd`

### 4. background/commands.js — 命令处理器

扩展 `initCommands`：

```javascript
case 'focus-search':
  await triggerFocusSearch();
  break;
```

新增 `triggerFocusSearch()` 函数：
1. 获取当前活动标签页 ID
2. 通过 `chrome.scripting.executeScript` 向该标签页注入 focus-search.js（如果尚未注入）
3. 或通过 `chrome.tabs.sendMessage` 发送 `showFocusSearch` 消息

### 5. background/groups.js — History 分组管理

**新增函数：**

```javascript
// 获取或创建 History 分组
async function getOrCreateHistoryGroup() {
  const result = await chrome.storage.local.get(['groups']);
  const groups = result.groups || [];
  let historyGroup = groups.find(g => g.name === 'History');

  if (!historyGroup) {
    historyGroup = {
      id: generateId(),
      name: 'History',
      color: '#9e9e9e',  // 灰色
      isDefault: false
    };
    groups.push(historyGroup);
    await chrome.storage.local.set({ groups });
  }
  return historyGroup;
}

// 添加标签到 History 分组
async function addToHistoryGroup(tabInfo) {
  const historyGroup = await getOrCreateHistoryGroup();
  await addTabToGroup(tabInfo, historyGroup.id);
}
```

**新增 message listener case：**

```javascript
case 'addToHistoryGroup': {
  const { title, url, favicon } = request;
  await addToHistoryGroup({ title, url, favicon });
  sendResponse({ success: true });
  break;
}

case 'getAllOpenTabs': {
  const tabs = await chrome.tabs.query({});
  const filteredTabs = tabs.filter(t =>
    t.url && !t.url.startsWith('chrome://') &&
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('about:')
  );
  sendResponse({ success: true, tabs: filteredTabs });
  break;
}
```

### 6. manifest.json — 更新 content_scripts

将 `content/focus-search.js` 和 `content/focus-search.css` 添加到 content_scripts 列表，或改为按需动态注入。

**方案选择：**
- 方式 A（静态注入）：所有页面始终加载脚本，但仅在收到 `showFocusSearch` 消息后才激活浮层
- 方式 B（动态注入）：仅在用户按下快捷键时通过 `chrome.scripting.executeScript` 注入

**推荐方式 B**（按需注入），避免无用脚本污染所有页面。

## 用户交互流程

1. 用户在任意页面按下 `Alt+Shift+S`
2. 页面中央出现搜索浮层，输入框自动聚焦
3. 用户输入搜索词（支持有序模糊匹配，如 "gb" 可匹配 "github"）
4. 实时显示匹配结果列表，支持键盘 ↑↓ 导航
5. 按 Enter 跳转到选中标签页，同时该标签页被添加到 History 分组
6. 浮层自动关闭，显示 Toast 提示 "已添加到 History"
7. 按 ESC 或点击遮罩可提前关闭浮层

## 数据流

```
用户按下 Alt+Shift+S
    ↓
chrome.commands.onCommand('focus-search')
    ↓
background/commands.js: triggerFocusSearch()
    ↓
chrome.scripting.executeScript → 注入 focus-search.js
    ↓
focus-search.js: showOverlay() → 显示浮层
    ↓
focus-search.js → chrome.runtime.sendMessage({ action: 'getAllOpenTabs' })
    ↓
background/groups.js → chrome.tabs.query({}) 返回所有标签
    ↓
focus-search.js 收到 tabs 数组，进行 fuzzyMatchOrdered 过滤和排序
    ↓
用户输入、键盘导航、回车跳转
    ↓
chrome.tabs.update(selectedTabId, { active: true })
    ↓
chrome.runtime.sendMessage({ action: 'addToHistoryGroup', ...tabInfo })
    ↓
background/groups.js: getOrCreateHistoryGroup() + addTabToGroup()
    ↓
浮层关闭
```

## 依赖项

- 复用 `timeline.js` 中的 `fuzzyMatchOrdered` 函数（通过模块导入）
- 复用 `groups.js` 中的 `addTabToGroup`、`generateId` 函数
- 无新增外部依赖

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `manifest.json` | 修改 | 添加 `focus-search` 命令 |
| `content/focus-search.js` | 新增 | 浮层内容脚本 |
| `content/focus-search.css` | 新增 | 浮层样式 |
| `background/commands.js` | 修改 | 添加 `focus-search` 命令处理 |
| `background/groups.js` | 修改 | 添加 History 分组管理函数和 message listener |
| `docs/superpowers/specs/2026-04-14-focus-shortcut-design.md` | 新增 | 本设计文档 |

## 测试计划

1. 在任意网页按下 `Alt+Shift+S`，验证浮层正常显示
2. 输入 "gb" 验证能匹配到 "github" 相关标签
3. 验证 ↑↓ 键能正确导航
4. 验证 Enter 键能跳转到选中标签页
5. 验证跳转后 History 分组中新增了该标签
6. 验证 ESC 键和点击遮罩能关闭浮层
7. 验证 History 分组不存在时自动创建
