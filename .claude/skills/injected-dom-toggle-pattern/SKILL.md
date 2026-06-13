---
name: injected-dom-toggle-pattern
description: 当用户要求创建"注入DOM的流程"、创建"悬浮展开的dot-nav侧边栏"、在popup添加对应控制按钮、创建"类似视频注入效果的侧边栏"、或需要在任意页面注入可展开收起UI时触发。用于Chrome扩展中内容脚本注入模式的标准化开发。
---

# Injected DOM Toggle Pattern — 注入式悬浮 UI 模式

## 模式概述

在 Chrome 扩展中，通过 `content_scripts` 向所有页面注入一个悬浮可展开的 UI 面板（如 dot-nav 侧边栏），通过 popup 设置中的开关按钮控制其开启/关闭，状态保存在 `chrome.storage.local`。

**典型场景：** 刷题侧边栏（lcSidebar）、视频进度条、课程进度条等需要"在任意页面浮现"的 UI。

## References 导读（按需深入，不要一次全读）

本 SKILL.md 讲**整体模式 + 从 0 搭建一个 toggle** 的流程。`references/` 下有三篇深入文档，**按当前任务匹配阅读**：

| 你的任务 | 读这篇 | 这篇讲什么 |
|---------|--------|-----------|
| 做「hover 近场浮现」入口（静止不可见、靠近右边缘才滑入、点击展开） | `references/hover-reveal.md` | CSS `:has()` 联动、触发带、`setTimeout(0)` 绑监听等技术机制与坑 |
| 决定入口的 UX（要不要塞进度、怎么收起、打扰程度、入口放什么内容） | `references/ux-design-style.md` | 克制浮现 / 入口单一职责 / 分层交互 / 低关闭成本 四准则 |
| **已有圆环、要新增一个**悬浮入口（番茄钟、AI 助手、稍后读等） | `references/adding-a-new-ring.md` | 5 步流程 + 可直接抄的代码模板 + 7 个错误样本（❌ vs ✅）+ 检查清单 |

**阅读顺序建议**：先读本 SKILL.md 理解整体架构 → 按任务匹配读对应 reference → 实现时对照该 reference 末尾的检查清单逐项核对。

> 三篇关系：`hover-reveal.md` = **原理**（怎么实现），`ux-design-style.md` = **设计**（为什么这么做），`adding-a-new-ring.md` = **cookbook**（照抄扩展）。cookbook 依赖前两者的概念。

## 架构图

```
manifest.json
├── content_scripts (matches: "<all_urls>")
│   └── content/xxxSidebar.js
│       ├── STYLES — CSS 字符串常量
│       ├── ALL_PROBLEMS / 数据定义
│       ├── buildSidebar() — 创建 DOM 结构
│       ├── updateDots() — 更新指示点
│       ├── buildTodoSection() — 待办区块
│       └── 事件绑定
│
popup/popup.html
├── <input type="checkbox" id="popupShowXxx">
└── popup/modules/xxxSettings.js — 设置加载和事件绑定

background/init.js
└── settings 初始化时添加 showXxxSidebar: false

background/groups.js (或对应模块)
└── openTabboard handler 支持 view 参数
```

## 文件清单与职责

| 文件 | 职责 |
|------|------|
| `manifest.json` | 添加 `content_scripts` 条目，`"matches": ["<all_urls>"]` |
| `content/xxx.js` | 注入 DOM、样式、交互逻辑。数据内联，不引用外部模块 |
| `popup/popup.html` | 添加 checkbox 开关 |
| `popup/modules/xxxSettings.js` | 独立的 settings 模块，加载/保存开关状态 |
| `popup/popup.js` | import 并调用 `loadXxxSetting()` / `bindXxxSidebarEvents()` |
| `background/init.js` | `settings` 初始化时设置 `showXxxSidebar: false` |
| `background/groups.js` | `openTabboard` 消息支持 `view` 参数 |

## Step-by-Step 实现流程

### Step 1: 定义数据结构（内联在 content script）

```javascript
// content/xxx.js 顶部
const WRAPPER_ID = 'xxx-nav';
const ALL_PROBLEMS = [
  { id: 'lc001', slug: 'two-sum', title: '两数之和', difficulty: 'Easy' },
  // ... 内联完整数据
];
const LC_BASE = 'https://leetcode.cn/problems/';
```

> **关键：** 数据必须内联在 content script 中，不能 import。content script 与模块系统隔离。

### Step 2: 编写 content script

```javascript
// content/xxx.js
const WRAPPER_ID = 'xxx-nav';
let wrapper = null;
let progress = {}; // 从 storage 加载

const STYLES = `
  #${WRAPPER_ID} {
    position: fixed;
    top: 50%;
    right: 0;
    transform: translate3d(200px, -50%, 0);
    z-index: 999999;
    /* ... 其余样式 */
  }
  /* 展开/悬浮 */
  #${WRAPPER_ID}:hover,
  #${WRAPPER_ID}.expanded {
    transform: translate3d(0, -50%, 0);
  }
`;

// 构建 DOM
function buildSidebar() {
  if (wrapper) return;

  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);

  wrapper = document.createElement('div');
  wrapper.id = WRAPPER_ID;

  // Dot 指示器
  const dots = document.createElement('div');
  dots.id = WRAPPER_ID + '-dots';
  dots.addEventListener('click', () => wrapper.classList.toggle('expanded'));

  // Panel
  const panel = document.createElement('div');
  panel.id = WRAPPER_ID + '-panel';
  panel.innerHTML = `
    <div id="${WRAPPER_ID}-header">
      <div id="${WRAPPER_ID}-title">标题</div>
      <button id="${WRAPPER_ID}-open-panel">打开面板</button>
      <div id="${WRAPPER_ID}-stats">统计行</div>
      <input id="${WRAPPER_ID}-search" placeholder="搜索...">
    </div>
    <div id="${WRAPPER_ID}-body">内容区</div>
  `;

  wrapper.appendChild(dots);
  wrapper.appendChild(panel);
  document.body.appendChild(wrapper);

  // 打开面板按钮
  document.getElementById(WRAPPER_ID + '-open-panel')
    .addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openTabboard', view: 'xxx' });
    });
}

// 初始化
async function init() {
  const result = await chrome.storage.local.get(['settings', 'xxxProgress']);
  if (!result.settings?.showXxxSidebar) return;
  progress = result.xxxProgress || {};
  buildSidebar();
}

init();
```

### Step 3: 更新 manifest.json

```json
{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/xxx.js"],
      "run_at": "document_end"
    }
  ]
}
```

### Step 4: 添加 popup 开关

**popup.html** 添加 checkbox：
```html
<label class="setting-row">
  <input type="checkbox" id="popupShowXxxSidebar">
  <span>显示侧边栏（模块名）</span>
</label>
```

**popup/modules/xxxSettings.js**（独立文件，不混入 videoProgress）：
```javascript
let showXxx = false;

export async function loadXxxSidebarSetting() {
  const result = await chrome.storage.local.get(['settings']);
  showXxx = result.settings?.showXxxSidebar || false;
  const checkbox = document.getElementById('popupShowXxxSidebar');
  if (checkbox) checkbox.checked = showXxx;
}

export function bindXxxSidebarEvents() {
  const checkbox = document.getElementById('popupShowXxxSidebar');
  if (!checkbox) return;

  checkbox.addEventListener('change', async () => {
    showXxx = checkbox.checked;
    const result = await chrome.storage.local.get(['settings']);
    await chrome.storage.local.set({
      settings: { ...result.settings, showXxxSidebar: showXxx }
    });
    // 通知 content script 重新检查
    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'refreshXxxSidebar', show: showXxx }).catch(() => {});
    });
  });
}
```

> **注意：** 不要把 leetcode 的设置逻辑添加到 `videoProgress.js` 中，应该创建独立的 `xxxSettings.js`。

### Step 5: 更新 background/init.js

```javascript
// settings 初始化添加
if (updatedSettings.showXxxSidebar === undefined) {
  updatedSettings.showXxxSidebar = false;
  needUpdate = true;
}
```

### Step 6: 支持 openTabboard 带 view 参数

**background/groups.js** 的 `openTabboard` 处理：
```javascript
case 'openTabboard': {
  if (request.view) {
    const { settings } = await chrome.storage.local.get(['settings']);
    await chrome.storage.local.set({
      settings: { ...settings, lastView: request.view }
    });
  }
  await openTabboard();
  sendResponse({ success: true });
  break;
}
```

## 多圆环总开关（master switch）

当注入式圆环 **≥2 个**时（如 LC 圆环 + VP 圆环），加一个 master 总开关统一控制，而不是让用户逐个关：

- **settings 字段**：`ringSidebarEnabled`（默认 `true`；判断用 `!== false` 而非 `=== true`，让 undefined 视为开，**向后兼容**）
- **popup**：独立 `ringSettings.js` 模块，master checkbox 放在子开关上方；master 关时把子开关 `disabled`（置灰反馈）
- **每个 ring content script**：`init()` 里 `if (settings.ringSidebarEnabled === false) { remove(); return; }`；监听 `ringSidebarEnabled` 变化——关→**移除 DOM**，开→rebuild
- **关键**：关闭要**移除 DOM**（不只是 `opacity:0`），否则 hover/mousemove 仍能触发已"隐藏"的圆环

> 不受 master 控制的圆环（如 goto 快捷菜单，性质不同）不接入，保持独立开关。

## 关键 Anti-Pattern（踩坑记录）

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| content script 用 import 加载数据 | content脚本不能使用 ES module import | 数据内联或通过 message 从 background 获取 |
| 进度查询用 `progress[p.slug]` | slug 变化时查找失败 | 统一用 `progress[p.id]` 作为 key |
| popup 设置逻辑混入 videoProgress.js | 职责混乱，video模块被污染 | 创建独立的 `xxxSettings.js` |
| 没有 `showXxxSidebar` 初始化 | 旧用户首次加载 settings undefined | 在 init.js 显式初始化为 false |
| content script DOM 没有唯一 id 前缀 | 多实例冲突 | 用 WRAPPER_ID 前缀包裹所有 id |
| 省略 `if (wrapper) return` | 重复调用 buildSidebar 创建多实例 | 守卫语句防止重复创建 |
| 多个 ring 各自独立开关，没有 master 总开关 | 无法一键关闭所有圆环，用户要逐个关 | 加 `ringSidebarEnabled` master 开关，每个 ring 的 init 和监听都响应 |
| master 检查用 `=== true` | 老用户 settings 无此 key（undefined）被判 false，所有圆环消失 | 用 `!== false` 判断，undefined 视为开启（默认开，向后兼容） |
| 新圆环没接入 master 检查 | master 关了它还在，行为不一致 | 新 ring 的 init 和监听都要响应 `ringSidebarEnabled` |
| master 关闭只设 `opacity:0` 不移除 DOM | hover/mousemove 仍触发"隐藏"的圆环 | 关闭时 `wrapper.remove()`，开时 rebuild |

## 成功标准检查清单

- [ ] manifest.json 包含 `<all_urls>` 的 content_scripts 条目
- [ ] content script 数据内联，无外部 import
- [ ] popup 有独立 xxxSettings.js 模块
- [ ] 开关状态保存到 `settings.showXxxSidebar`
- [ ] init.js 有 `showXxxSidebar: false` 默认值
- [ ] 打开面板按钮能正确跳转到对应 module 页面
- [ ] 多个 content script 间无 id 冲突（各自 WRAPPER_ID 前缀）
- [ ] ring-sidebar 有 master 总开关（`ringSidebarEnabled`），每个 ring 的 init 和监听都响应
- [ ] master 判断用 `!== false`（undefined 默认开，向后兼容）
- [ ] master 关闭时**移除 DOM**（不是只 `opacity:0`）
