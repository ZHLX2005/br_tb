---
name: injected-dom-toggle-pattern
description: 当用户要求创建"注入DOM的流程"、创建"悬浮展开的dot-nav侧边栏"、在popup添加对应控制按钮、创建"类似视频注入效果的侧边栏"、或需要在任意页面注入可展开收起UI时触发。用于Chrome扩展中内容脚本注入模式的标准化开发。
---

# Injected DOM Toggle Pattern — 注入式悬浮 UI 模式

## 模式概述

在 Chrome 扩展中，通过 `content_scripts` 向所有页面注入一个悬浮可展开的 UI 面板（如圆环侧边栏），通过 popup 设置中的开关按钮控制其开启/关闭，状态保存在 `chrome.storage.local`。所有注入 UI **必须使用 Shadow DOM 隔离宿主 CSS**。

**典型场景：** 刷题侧边栏（lcSidebar）、视频进度圆环（vpSidebar）、计时圆环（timerSidebar）、goto 菜单等需要"在任意页面浮现"的 UI。

## References 导读（按需深入，不要一次全读）

本 SKILL.md 讲**整体模式 + 从 0 搭建一个 toggle** 的流程。`references/` 下有深入文档，**按当前任务匹配阅读**：

| 你的任务 | 读这篇 | 这篇讲什么 |
|---------|--------|-----------|
| 做「hover 近场浮现」入口（静止不可见、靠近右边缘才滑入、点击展开） | `references/hover-reveal.md` | 共享 mousemove 检测（非 :has + hover-zone），多圆环幂等注册，动效同步 |
| **注入 UI 要防宿主页 CSS reset / 类名撞车**（Notion/Linear/Figma 失效） | `references/shadow-dom-isolation.md` | Shadow DOM 装配 + 6 个必踩坑（:host 选 host、变量定义、shadowRoot 查询、事件 retarget、字体穿透、状态联动） |
| 决定入口的 UX（要不要塞进度、怎么收起、打扰程度、入口放什么内容） | `references/ux-design-style.md` | 克制浮现 / 入口单一职责 / 分层交互 / 低关闭成本 四准则 |
| **已有圆环、要新增一个**悬浮入口（番茄钟、AI 助手、计时器等） | `references/adding-a-new-ring.md` | 6 步流程 + Shadow DOM 版可抄模板 + 12 个错误样本 + 视觉同步关键 + 检查清单 |
| 多圆环场景下做「可拖动悬浮环」/ 拖动坐标偏差 530px / 想统一所有 ring 拖动 | `references/draggable-ring.md` | pointer 事件契约 + host CSS 字节级一致 + 整体 ring 栈联动 + 位置记忆 |

| 你的任务 | 读这篇 | 这篇讲什么 |
|---------|--------|-----------|
| 做「hover 近场浮现」入口（静止不可见、靠近右边缘才滑入、点击展开） | `references/hover-reveal.md` | 共享 mousemove 检测（非 :has + hover-zone），多圆环幂等注册，动效同步 |
| **注入 UI 要防宿主页 CSS reset / 类名撞车**（Notion/Linear/Figma 失效） | `references/shadow-dom-isolation.md` | Shadow DOM 装配 + 6 个必踩坑（:host 选 host、变量定义、shadowRoot 查询、事件 retarget、字体穿透、状态联动） |
| 决定入口的 UX（要不要塞进度、怎么收起、打扰程度、入口放什么内容） | `references/ux-design-style.md` | 克制浮现 / 入口单一职责 / 分层交互 / 低关闭成本 四准则 |
| **已有圆环、要新增一个**悬浮入口（番茄钟、AI 助手、计时器等） | `references/adding-a-new-ring.md` | 6 步流程 + Shadow DOM 版可抄模板 + 12 个错误样本 + 视觉同步关键 + 检查清单 |

**阅读顺序建议**：先读本 SKILL.md 理解整体架构 → 按任务匹配读对应 reference → 实现时对照该 reference 末尾的检查清单逐项核对。

> 五篇关系：`hover-reveal.md` = **原理**（怎么实现），`ux-design-style.md` = **设计**（为什么这么做），`adding-a-new-ring.md` = **cookbook**（照抄模板），`shadow-dom-isolation.md` = **强制前提**（注入 UI 必须用 Shadow DOM），`draggable-ring.md` = **拖动扩展**（让圆环可拖动到任意位置）。cookbook 依赖前两者的概念；`shadow-dom-isolation.md` 是注入 UI 的强制前提（不用 Shadow DOM 的圆环会在 Notion/Figma 等站点 CSS 失效）；`draggable-ring.md` 仅在需要拖动能力时读取。

## 架构图

```
manifest.json
├── content_scripts (matches: "<all_urls>")
│   ├── content/xxxSidebar.js (IIFE, 自执行)
│   │   ├── WRAPPER_ID — 唯一前缀 (host id)
│   │   ├── STYLES — CSS 字符串 (在 Shadow Root 内)
│   │   ├── build() — attachShadow → style + trigger + panel → body.appendChild(host)
│   │   ├── shouldHide(s) — master + 子开关双守卫
│   │   ├── init() — 检查设置 → build()
│   │   └── storage.onChanged — 关→remove() / 开→build()
│   └── （所有注入内容共用一个 mousemove 监听: __tabboardSideReveal）
│
popup/popup.html
├── 悬浮圆环专区
│   ├── <input> 总开关 (ringSidebarEnabled)
│   └── <input> 各圆环子开关 (ring-sub class, 缩进)
└── popup/modules/xxxSettings.js — 独立 popup 设置模块

background/init.js
└── settings 含 showXxxSidebar: true, ringSidebarEnabled: true
```

## 文件清单与职责

| 文件 | 职责 |
|------|------|
| `manifest.json` | 添加 `content_scripts` 条目，`"matches": ["<all_urls>"]` |
| `content/xxxSidebar.js` | **Shadow DOM IIFE**：注入 DOM、样式、交互逻辑。不和外部模块耦合 |
| `popup/popup.html` | 悬浮圆环专区：总开关（ring-master） + 缩进子开关（ring-sub） |
| `popup/modules/xxxSettings.js` | 独立的 popup settings 模块，`loadXxxSidebarSetting()` + `bindXxxSidebarEvents()` |
| `popup/popup.js` | import 并调用 `loadXxxSetting()` / `bindXxxSidebarEvents()` |
| `background/init.js` | `settings` 初始化时设置 `showXxxSidebar: true` + `ringSidebarEnabled` |
| `background/groups.js` | 无改动（openTab 已支持任意 URL，包括 edge://） |

## Step-by-Step 实现流程

> **前置：所有步骤假设使用 Shadow DOM + mousemove 共享浮现。** 不遵循此前提的注入会在多圆环共存场景或 CSS 严格页面失效。

### Step 1：选择垂直位置

圆环 40px 高，间距 52px（净空 12px）。公式 `top: calc(50% + 52 * N px)`：

| 序号 | 圆环 | `top`（trigger/panel 用） |
|------|------|--------------------------|
| 0 | LC | `calc(50% + 0px)` = `50%` |
| 1 | VP | `calc(50% + 52px)` |
| 2 | Timer | `calc(50% + 104px)` |
| 3 | 下一个 | `calc(50% + 156px)` |

**关键：host 元素（`:host`）始终用 `top: 50%`，offset 只加在 trigger 和 panel 上。** 如果 host 也带 offset，其 `transform: translateY(-50%)` 会影响 shadow 内 `position: fixed` 子元素的包含块，导致偏移叠加。

### Step 2：创建 content script（精简骨架）

> **完整可抄模板**（含 Shadow DOM 装配、错误处理、master 守卫、事件清理）见 `references/adding-a-new-ring.md` 的"最小代码模板"章节。这里只列出本 skill **独有**的两块：常量声明 + 共享近场浮现的幂等注册。

```javascript
// content/xxxSidebar.js
(function () {
  'use strict';

  // ① 常量 — 改 4 处
  const WRAPPER_ID = 'tabboard-xxx-sidebar';   // 唯一前缀（host id）
  const ACCENT = '#42a5f5';
  const N = 2;                                // 垂直位置序号（0,1,2...）

  function build() { /* 见 adding-a-new-ring.md 最小代码模板 */ }
  function shouldHide(s) { return s.ringSidebarEnabled === false || s.showXxxSidebar === false; }
  async function init() { /* 见 ref */ }
  chrome.storage.onChanged.addListener(/* 见 ref */);

  // ② 共享近场浮现（本 skill 独有，模板里也有但要确保幂等）
  if (!window.__tabboardSideReveal) {
    window.__tabboardSideReveal = true;
    document.addEventListener('mousemove', (e) => {
      const near = e.clientX > window.innerWidth - 40;
      document.body.classList.toggle('tabboard-side-near', near);
      document.querySelectorAll('[id$="-sidebar"]:not([id$="-panel"]):not([id$="-trigger"])')
        .forEach(host => host.classList.toggle('near', near));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
```

**复制到你的圆环时改 4 处**：WRAPPER_ID、ACCENT、N、面板内容（图标 + innerHTML）。其他全部从 ref 抄。

### Step 3: 更新 manifest.json

```json
{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/xxxSidebar.js"],
      "run_at": "document_end"
    }
  ]
}
```

> 多个圆环在 manifest 中按注册顺序排列，时序也影响 `__tabboardSideReveal` 的首次注册——但幂等保证只注册一次，顺序不影响功能。

### Step 4: 添加 popup 开关

**popup.html** 悬浮圆环专区添加：
```html
<label class="setting-row ring-sub">
  <input type="checkbox" id="popupShowMyRing">
  <span>我的圆环</span>
</label>
```

**popup/modules/mySettings.js**（参考 `vpSettings.js` / `timerSettings.js`）：
- `loadMyRingSetting()` — 从 settings 加载开关状态
- `bindMyRingEvents()` — change 时调 `updateSettings` action（合并语义，不直接 set）

> 写 settings 用 `chrome.runtime.sendMessage({ action: 'updateSettings', settings })`，background 的合并语义会保留其他 key。**禁止** `chrome.storage.local.set({ settings: { myKey: val } })` 整体覆盖。

### Step 5: 更新 background/init.js

```javascript
// 新字段
if (updatedSettings.showMyRing === undefined) {
  updatedSettings.showMyRing = true;   // 默认开
  needUpdate = true;
}
```

### Step 6: popup/modules/ringSettings.js 添加子开关禁用

在 `updateSubToggles` 的 ID 列表中加上新的 checkbox id：

```javascript
function updateSubToggles(enabled) {
  ['popupShowLcSidebar', 'popupShowVpSidebar', 'popupShowMyRing'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}
```

### Step 7：可选 — 让圆环可拖动

如果用户希望圆环可以拖到任意位置（而不只是悬浮在右侧），在 `build()` 末尾加一行（必须在 `document.body.appendChild(wrapper)` 之后，pointer 事件才能在 host 上传递）：

```javascript
document.body.appendChild(wrapper);
window.__tabboardRingDrag?.attach(
  shadow.getElementById(WRAPPER_ID + '-trigger'),
  shadow.getElementById(WRAPPER_ID + '-panel'),
  { ringIndex: N }  // ← N 必须和 Step 1 一致（LC=0, VP=1, Timer=2, ...）
);
```

**关键约束**：

- `ringIndex` 是该 ring 在垂直栈中的序号（0/1/2/...），决定整体拖动时的间距锚点
- 不同 ring 的 `ringIndex` 不能重复，也不能跳跃
- 多 ring 拖动时**所有 ring 的 `:host` CSS 必须字节级一致**（特别是都不能带 `transform`），否则 `getBoundingClientRect()` 返回的坐标系会差 530px

详细原理 + 拖动契约 + 530px bug 复现 → `references/draggable-ring.md`

---

## 多圆环总开关（master switch）

当注入式圆环 **≥2 个**时，加一个 master 总开关统一控制：

- **settings 字段**：`ringSidebarEnabled`（默认 `true`；判断用 `!== false` 而非 `=== true`，让 undefined 视为开，**向后兼容**）
- **每个 ring content script**：`init()` 里 `if (settings.ringSidebarEnabled === false) { return; }`；监听 `ringSidebarEnabled` 变化——关→**移除 DOM**，开→rebuild
- **关键**：关闭要**移除 DOM**（不只是 `opacity:0`），否则 hover/mousemove 仍能触发已"隐藏"的圆环

### popup 中的「悬浮圆环」专区

```
悬浮圆环
  ☑ 圆环侧边栏（总开关）          ← master，加粗 + 下分隔线
    ☑ 刷题侧边栏（LeetCode CN）    ← 子开关，缩进 20px
    ☑ 视频进度圆环                 ← 子开关，缩进
    ☑ 计时圆环                    ← 子开关，缩进
  ☑ 悬浮 goto 圆环（所有页面）     ← 独立入口，不缩进
```

- **接入 master 的 ring**：用 `.ring-sub` 缩进 20px，master 关闭时 `disabled` 置灰
- **不接入 master 的入口**（如 goto 快捷菜单，性质不同）：保持独立开关，不缩进

---

## 关键 Anti-Pattern（踩坑记录）

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| content script 用 import 加载数据 | content 脚本不能使用 ES module import | 数据内联或通过 message 从 background 获取 |
| 不用 Shadow DOM | 宿主页（Notion/Figma）CSS reset 穿透，圆环样式失效 | `attachShadow({ mode: 'open' })`，style + trigger + panel 都进 shadow |
| host 的 `top` 带偏移（`calc(50% + 104px)`） | host 的 `transform` 影响 shadow 内 `position: fixed` 子元素的包含块，偏移叠加，圆环偏下 | host 用 `top: 50%`，offset 只加在 trigger 和 panel 上 |
| **多 ring host CSS 不一致**（一个有 `transform`，其他没有） | 拖动后 inline `top` 看着对，但 `getBoundingClientRect()` 差 530px（两个 ring 在不同坐标系） | 所有 ring 用同一份 `:host` 模板，字节级一致，**严禁在 host 加 `transform`**。多 ring 拖动场景必读 `draggable-ring.md` |
| `style` 注入 `document.head` | CSS 不被隔离，宿主可覆盖 | 注入 `shadow.appendChild(style)` |
| popup 设置逻辑混入 videoProgress.js | 职责混乱，video 模块被污染 | 创建独立的 `xxxSettings.js` |
| 写 settings 用 `storage.set({ settings: { key: val } })` 整体覆盖 | 清掉其他 setting key | 用 `updateSettings` action（合并语义） |
| 没有 `showXxxSidebar` 初始化 | 旧用户首次加载 settings undefined | 在 init.js 显式初始化为 true/false |
| content script DOM 没有唯一 id 前缀 | 多实例冲突 | 用 WRAPPER_ID 前缀包裹所有 id |
| 省略 `if (document.getElementById(WRAPPER_ID)) return` | 重复 build 创建多 host | 守卫语句防止重复创建 |
| 多个 ring 各自独立开关，没有 master 总开关 | 无法一键关闭所有圆环 | 加 `ringSidebarEnabled` 总开关 |
| master 检查用 `=== true` | 老用户 settings 无此 key（undefined）判 false，所有圆环消失 | 用 `!== false` 判断，undefined 视为开启（向后兼容） |
| 新圆环没接入 master 检查 | master 关了它还在 | 新 ring 的 init 和监听都要响应 `ringSidebarEnabled` |
| master 关闭只设 `opacity:0` 不移除 DOM | hover/mousemove 仍触发"隐藏"的圆环 | 关闭时 `wrapper.remove()`，开时 rebuild |
| 同步绑 `document.addEventListener('click', ...)` | 展开当次点击冒泡立刻触发收起 | `setTimeout(0)` 延一帧绑 |
| 每个圆环各建一个 hover-zone div | 重叠覆盖，后建的盖住先建的，先建圆环永不浮现 | 不建 hover-zone，共享 `__tabboardSideReveal` mousemove |
| trigger 在 flex wrapper 内，不可见 panel 占布局位 | trigger 被 panel 宽度推到屏幕中间 | trigger 和 panel 都 `position: fixed` |
| 入口塞进度/计数 SVG | 视觉噪声，用户要求移除 | trigger 只放单一标识（字母 logo / 单图标） |

---

## 成功标准检查清单

- [ ] manifest.json 包含 `<all_urls>` 的 content_scripts 条目
- [ ] content script 使用 **Shadow DOM**（`attachShadow`），style + trigger + panel 都进 shadow
- [ ] shadow 内 host 自身样式/变量用 `:host`，**不用 `#host-id`**
- [ ] host 的 `top` 用 `50%`（不带 offset），offset 只加在 trigger 和 panel 上
- [ ] 近场浮现使用共享 mousemove（`__tabboardSideReveal` 幂等注册），不建 hover-zone div
- [ ] transition 参数与已有圆环统一（`right 220ms / opacity 180ms`）
- [ ] popup 有独立 `xxxSettings.js` 模块
- [ ] 开关状态通过 `updateSettings` action 保存（合并语义）
- [ ] init.js 有 `showXxxSidebar: true` 默认值
- [ ] 接入 master 总开关（`ringSidebarEnabled`），判断用 `!== false`
- [ ] master 关闭时**移除 DOM**（不是只 `opacity:0`）
- [ ] popup 中子开关用 `ring-sub` class 缩进，master 关时 `disabled` 置灰
- [ ] 点击外部收起用 `setTimeout(0)` 延一帧绑 document click
- [ ] WRAPPER_ID 全局唯一，各 ring 无 id 冲突
- [ ] `:host` 显式设 `font-family`（防宿主字体穿透）
