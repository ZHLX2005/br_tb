---
name: injected-dom-toggle-pattern
description: 当用户要求创建"注入DOM的流程"、创建"悬浮展开的dot-nav侧边栏"、在popup添加对应控制按钮、创建"类似视频注入效果的侧边栏"、或需要在任意页面注入可展开收起UI（无论是右侧 ring 栈形式还是自由悬浮圆环形式）时触发。用于Chrome扩展中内容脚本注入模式的标准化开发。
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
| **已有圆环、要新增一个**悬浮入口（番茄钟、AI 助手、计时器等） | `references/adding-a-new-ring.md` | 6 步流程 + Shadow DOM 版可抄模板 + 错误样本 + 视觉同步关键 + 检查清单 |
| 多圆环场景下做「可拖动悬浮环」/ 拖动坐标偏差 530px / 想统一所有 ring 拖动 | `references/draggable-ring.md` | pointer 事件契约 + 双 CSS 变量系统 + 整体 ring 栈联动 + 位置记忆 |
| 多圆环（≥2）控制一个开关后中间空缺 / 想让剩下的 ring 自动顶位 | `references/ring-order-auto-fill.md` | ring-order 协调器 + 三档 dedup + 关闭瞬时顶位 + 与拖动双变量解耦 |
| **要新增一个自由悬浮的圆环**（不参与右侧栈、可拖到任意位置、不受 master 控制）| `references/free-floating-entry.md` | goto.js / noteRing.js 同款模式：独立 content_script block、单 host 不进 Shadow DOM、pointer 拖动 + click 区分阈值 |
| **注入 UI 里的下拉选择器点不动 / 看不到**（页面切换器、下拉菜单、选择器）| `references/dropdown-picker.md` | body 级 dropdown 定位（避开面板 overflow:hidden 裁剪）+ 拖拽 pointer capture 劫持点击 + capture 阶段 outside-click 误关 |
| **注入 DOM 要与 TabBoard module 共享数据**（两边同步增删改查）| `references/module-collaboration.md` | 共享 storage key + background action 唯一写路径 + onChanged 双向广播 + 防回环签名比较 + 切换前 flush |

**阅读顺序建议**：先读本 SKILL.md 理解整体架构 → 按任务匹配读对应 reference → 实现时对照该 reference 末尾的检查清单逐项核对。

> 九篇关系：`hover-reveal.md` = **原理**（怎么实现），`ux-design-style.md` = **设计**（为什么这么做），`adding-a-new-ring.md` = **ring-stack cookbook**（照抄模板），`free-floating-entry.md` = **自由圆环 cookbook**（goto / noteRing 同款模板），`dropdown-picker.md` = **下拉选择器专项**（body 级 dropdown + 点击劫持防坑），`module-collaboration.md` = **数据协作专项**（注入 DOM ↔ module 双向同步），`shadow-dom-isolation.md` = **ring-stack 强制前提**（ring-stack UI 必须 Shadow DOM），`draggable-ring.md` = **拖动扩展**（让 ring-stack 圆环可拖动到任意位置），`ring-order-auto-fill.md` = **协调扩展**（多 ring 自动补位）。**自由圆环不需要 Shadow DOM / ring-order / draggable-ring 三件套**——单 host 没有撞 CSS 风险，独立拖动不参与栈联动。

## 架构图

项目里注入式 UI 实际有**两类**模式，先判断属于哪一类，再读对应 cookbook：

### 模式 A：Ring-Stack Entry（右侧圆环，参与自动补位）

```
manifest.json
├── content_scripts (matches: "<all_urls>")  ← 一个 block
│   ├── content/shared/ring-order.js          ← 协调器(必含,manifest 第一位)
│   ├── content/shared/draggable-ring.js      ← 拖动(可选)
│   ├── content/xxxSidebar.js (IIFE)          ← 各 ring,按 defaultOrder 顺序排
│   │   ├── Shadow DOM + WRAPPER_ID 唯一前缀
│   │   ├── build() 末尾:
│   │   │   → __tabboardRingDrag.attach(trigger, panel, host, opts) [可选]
│   │   │   → __tabboardRingOrder.register({ ringId, host, defaultOrder, isAlive }) [必做]
│   │   └── shouldHide(s) — master (ringSidebarEnabled) + 子开关 (showXxxSidebar) 双守卫
│   └── 共享 mousemove (__tabboardSideReveal) 触发 :host(.near) + body.tabboard-side-near
│
popup/popup.html「注入DOM控制」板块
├── <input id="popupRingSidebarEnabled"> 总开关 (ring-master, 加粗 + 下分隔线)
└── <input id="popupShowXxxSidebar"> 各 ring-sub 子开关（缩进 20px, master 关时置灰）
└── popup/modules/xxxSettings.js — popup 独立设置模块

background/init.js
└── settings 含 showXxxSidebar: true + ringSidebarEnabled: true
```

### 模式 B：Free-Floating Entry（自由圆环，独立存在，可拖到任意位置）

```
manifest.json
├── content_scripts (matches: "<all_urls>")  ← 独立 block（与 ring block 并列）
│   └── content/xxxRing.js (IIFE)             ← 单 host,无外部依赖
│       ├── <style> 注入 document.head（不进 Shadow DOM — 单 host 无撞 CSS 风险）
│       ├── pointer 拖动 + 6px 阈值区分 click
│       └── shouldHide(s) — 只查自己的开关 (showXxx)，不查 ringSidebarEnabled
│
popup/popup.html「注入DOM控制」板块
└── <input id="popupShowXxx"> 顶层条目（不带 .ring-sub，不被 master 置灰）
└── popup/modules/xxxSettings.js — popup 独立设置模块

background/init.js
└── settings 含 showXxx: true（不接触 ringSidebarEnabled）
```

> **两类模式互斥**：一个圆环要么走 A（接入栈），要么走 B（自由）。**不要混搭**——
> 混搭会同时进 Shadow DOM + 注册 ring-order + 顶层 checkbox + 自己的拖动 = 行为冲突、状态错乱。
>
> 当前实际清单：
> - **A 类**：lcSidebar, vpSidebar, timerSidebar, captureRing, speedRing（5 个 ring-stack entry）
> - **B 类**：goto (`content/inject/goto/goto.js`)，noteRing (`content/noteRing.js`)

## 多 ring 垂直自动补位(≥2 个 ring 时必看)

> **当 ring ≥2 时必须接入**。否则关闭中间一个 ring 会在视觉上留下 52px 永久空缺(剩下的 ring 仍是硬编码的 N 位置)。

**核心机制**:CSS 变量 + 协调器,两个维度解耦:

- `top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0))`
- `--ring-stack-anchor` — 拖动锚点(px,默认 50%),由 `draggable-ring.js` 写
- `--ring-order` — 该 ring 在存活列表中的连续序号(0/1/2...),由 `ring-order.js` 写

**3 个文件协同**:
1. `content/shared/ring-order.js`(manifest 第一位)— 暴露 `__tabboardRingOrder.register / recompute / getLastSettings / getCurrentOrder`
2. `content/shared/draggable-ring.js`(manifest 第二位,可选)— 暴露 `__tabboardRingDrag.attach(trigger, panel, host, { defaultOrder, ringId })`
3. 每个 ring 的 build() 末尾:**先 attach(可选)后 register(必做)**

**关闭 LC 的视觉追踪**:
| 步骤 | VP | Timer | Capture |
|------|----|----|---------|
| 4 ring 都在(初始) | `--ring-order: 1` | `--ring-order: 2` | `--ring-order: 3` |
| 关闭 LC 后 | `--ring-order: 0`(顶位) | `--ring-order: 1`(顶位) | `--ring-order: 2`(顶位) |

关闭 → 各 host 的 `--ring-order` 由协调器重写 → CSS calc 重算 → 位置瞬时顶位,无 52px 间隙。拖动过的位置(`--ring-stack-anchor`)保留不动。

**完整设计 + dedup 三档(同 host 跳过/活 host 跳过/死 host 替换)+ 注册表 + 错误案例** → `references/ring-order-auto-fill.md`

## 文件清单与职责

### Mode A：Ring-Stack Entry

| 文件 | 职责 |
|------|------|
| `manifest.json` | 添加 `content_scripts` 条目，**所有 ring + 共享模块合并到同一 block**，`"matches": ["<all_urls>"]` |
| `content/shared/ring-order.js` | **协调器**(必含,manifest 第一位)——ring 注册表 + recompute + 三档 dedup,管 `--ring-order` |
| `content/shared/draggable-ring.js` | **拖动共享模块**(可选,需要时才加)——管 `--ring-stack-anchor`,实现整体联动 + 位置记忆 |
| `content/xxxSidebar.js` | **Shadow DOM IIFE**：注入 DOM、样式、交互逻辑。build 末尾必调 `__tabboardRingOrder.register(...)`(≥2 ring) |
| `popup/popup.html` | 「注入DOM控制」板块：总开关（ring-master） + 缩进子开关（ring-sub） |
| `popup/modules/xxxSettings.js` | 独立的 popup settings 模块，`loadXxxSidebarSetting()` + `bindXxxSidebarEvents()` |
| `popup/popup.js` | import 并调用 `loadXxxSetting()` / `bindXxxSidebarEvents()` |
| `background/init.js` | `settings` 初始化时设置 `showXxxSidebar: true` + `ringSidebarEnabled` |

### Mode B：Free-Floating Entry

| 文件 | 职责 |
|------|------|
| `manifest.json` | 添加**独立** `content_scripts` 条目（与 ring block 并列,各自 block），`"matches": ["<all_urls>"]` |
| `content/xxxRing.js` | **IIFE**：单 host、`<style>` 注入 document.head、pointer 拖动 + click 区分。无外部依赖（不接 ring-order / draggable-ring） |
| `popup/popup.html` | 「注入DOM控制」板块：**顶层** checkbox（不带 `.ring-sub`，不被 master 置灰） |
| `popup/modules/xxxSettings.js` | 独立的 popup settings 模块（参考 `gotoSettings.js` / `noteSettings.js`） |
| `popup/popup.js` | import 并调用 load/bind（不需要 master 联动逻辑） |
| `background/init.js` | `settings` 初始化时设置 `showXxx: true`（**不**接触 `ringSidebarEnabled`） |

> 模式 B 不在 `popup/modules/ringSettings.js` 的 `updateSubToggles` ID 列表中添加——它不受 master 控制。

## Step-by-Step 实现流程

> **前置**：先判断走哪条路径。
> - **Mode A（Ring-Stack）**：圆环要在右侧边栏叠在一起、参与整体拖动、受 master 总开关统一控制 → 读 Step 1-8
> - **Mode B（Free-Floating）**：圆环独立存在、可单独拖动、不受 master 控制 → 跳到 `references/free-floating-entry.md` 直接抄模板
>
> **不要混搭**——一个圆环只走一条路径（混搭会让 ring-order / 拖动 / Shadow DOM / popup 状态都冲突）。

### Mode A：Ring-Stack Entry

#### Step 1：垂直位置(动态序号,不要硬编码)

> **多 ring 必须用双 CSS 变量,不要写 `top: calc(50% + 52*N px)` 这种硬编码**。
> 硬编码会导致关闭中间一个 ring 后剩下 ring 留下 52px 永久空缺。详见"多 ring 垂直自动补位"段。

CSS 公式(每个 ring 的 trigger 和 panel 都要这样写):

```css
#${WRAPPER_ID}-trigger {
  position: fixed;
  top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0));
  right: -16px;
  /* ... */
}
```

- `--ring-stack-anchor` ——拖动锚点(默认 50%),`draggable-ring.js` 写
- `--ring-order` ——存活序号(默认 0),`ring-order.js` 写
- 两个变量各管一维,关闭其他 ring 时协调器重写 `--ring-order`,CSS calc 自动重算,瞬时顶位

**你需要做的**:在 manifest 里给新 ring 安排 `defaultOrder`(0, 1, 2, 3, ...),按列表顺序:

| 序号(`defaultOrder`) | 圆环 | 备注 |
|------|------|------|
| 0 | LC | 第一位,拖动锚点 |
| 1 | VP | |
| 2 | Timer | |
| 3 | Capture | |
| 4 | Speed | |
| 5 | 下一个 | 你的新 ring |

**关键约束**:
- `defaultOrder` 不能跳号,所有现存 ring 必须是 0,1,2,3... 连续
- trigger 和 panel 用同一份 calc 公式(都用 `--ring-order`,不是分别写)
- host 元素 `:host` 仍用 `top: 50%`(作为 calc 锚点 fallback)。如果 host 也带 offset,host 的 `transform: translateY(-50%)` 会影响 shadow 内 `position: fixed` 子元素的包含块,导致偏移叠加

#### Step 2：创建 content script（精简骨架）

> **完整可抄模板**（含 Shadow DOM 装配、错误处理、master 守卫、事件清理、register/attach 接入）见 `references/adding-a-new-ring.md` 的"最小代码模板"章节。这里只列出本 skill **独有**的两块：常量声明 + 共享近场浮现的幂等注册。

```javascript
// content/xxxSidebar.js
(function () {
  'use strict';

  // ① 常量 — 改 5 处
  const WRAPPER_ID = 'tabboard-xxx-sidebar';   // 唯一前缀（host id，主文档可见）
  const ACCENT = '#42a5f5';
  const N = 2;                                 // defaultOrder(manifest 列表顺序,0/1/2/3...)
  const RING_ID = 'myRing';                    // ringId 唯一字符串

  function build() { /* 见 adding-a-new-ring.md 最小代码模板 */ }
  function shouldHide(s) {
    // Mode A 双守卫:master 总开关 + 子开关（用 !== false，向后兼容 undefined）
    return s.ringSidebarEnabled === false || s.showXxxSidebar === false;
  }
  async function init() { /* 见 ref */ }
  chrome.storage.onChanged.addListener(/* 见 ref */);

  // ② 共享近场浮现：本 skill 独有，幂等注册
  // 同时 toggle body.tabboard-side-near(给外部逻辑)
  // + 每个 ring host 的 .near(shadow 内 :host(.near) 响应)
  // 选择器只挑 -sidebar 后缀的 host,自由圆环(note-ring 等)不会自动接入
  if (!window.__tabboardSideReveal) {
    window.__tabboardSideReveal = true;
    document.addEventListener('mousemove', (e) => {
      // 拖动期间屏蔽 hover-reveal，避免圆环被重新贴回右边
      if (window.__tabboardRingDragging) return;
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

**复制到你的圆环时改 5 处**:WRAPPER_ID、ACCENT、N(对应 manifest defaultOrder)、RING_ID,加上面板内容(图标 + innerHTML)。其他全部从 ref 抄。

**build() 末尾必做**(≥2 个 ring 时,见 `references/adding-a-new-ring.md` 完整模板):
```javascript
document.body.appendChild(wrapper);

// 可选:启用拖动
window.__tabboardRingDrag?.attach(
  shadow.getElementById(WRAPPER_ID + '-trigger'),
  shadow.getElementById(WRAPPER_ID + '-panel'),
  wrapper,                         // ← host 元素
  { defaultOrder: N, ringId: RING_ID }
);

// 必做:注册到协调器(参与自动补位)
window.__tabboardRingOrder?.register({
  ringId: RING_ID,
  host: wrapper,
  defaultOrder: N,
  isAlive: () => {
    if (!document.getElementById(WRAPPER_ID)) return false;
    const s = window.__tabboardRingOrder.getLastSettings();
    if (!s) return true;
    return s.ringSidebarEnabled !== false && s.showXxxSidebar !== false;
    //   ↑ Mode A 双守卫:master + 子开关
  }
});
```

#### Step 3: 更新 manifest.json

**所有 ring + 共享模块合并到同一个 content_script block**,按以下顺序:

```json
{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "content/shared/ring-order.js",
        "content/shared/draggable-ring.js",
        "content/lcSidebar.js",
        "content/vpSidebar.js",
        "content/timerSidebar.js",
        "content/captureRing.js",
        "content/speedRing.js",
        "content/xxxSidebar.js"
      ],
      "run_at": "document_end"
    }
  ]
}
```

- `ring-order.js` **第一位**(协调器,所有 ring build 之前必须就绪)
- `draggable-ring.js` **第二位**(可选,需要拖动才加)
- 各 ring 排在最后,**按 defaultOrder 顺序**(0/1/2/3...),加新 ring 到列表末尾,defaultOrder = 列表长度 - 1
- Chrome 同 block 内按数组顺序串行注入,跨 block 顺序不可控(尽量别拆 block)

#### Step 4: 添加 popup 开关

**popup.html「注入DOM控制」板块**下,作为**子开关**（缩进 20px,受 master 控制）添加:
```html
<label class="setting-row ring-sub">
  <input type="checkbox" id="popupShowXxxSidebar">
  <span>我的圆环</span>
</label>
```

> **如果你的圆环要作为 Mode B 自由圆环**：不带 `ring-sub` class，放在顶层（与 goto / noteRing 平级），**不要**用 `popupShowXxxSidebar` 这种带 `Sidebar` 后缀的命名——直接 `popupShowXxx` 即可。详见 `references/free-floating-entry.md` Step 3。

**popup/modules/xxxSettings.js**（参考 `vpSettings.js` / `timerSettings.js`）：
- `loadXxxSidebarSetting()` — 从 settings 加载开关状态
- `bindXxxSidebarEvents()` — change 时调 `updateSettings` action（合并语义，不直接 set）

> 写 settings 用 `chrome.runtime.sendMessage({ action: 'updateSettings', settings })`，background 的合并语义会保留其他 key。**禁止** `chrome.storage.local.set({ settings: { myKey: val } })` 整体覆盖。

#### Step 5: 更新 background/init.js

```javascript
// 新字段（Mode A 用 showXxxSidebar，Mode B 用 showXxx）
if (updatedSettings.showXxxSidebar === undefined) {
  updatedSettings.showXxxSidebar = true;   // Mode A 默认开（受 master 控制）
  needUpdate = true;
}
```

#### Step 6: popup/modules/ringSettings.js 添加子开关禁用

在 `updateSubToggles` 的 ID 列表中加上新的 checkbox id（**Mode A 才需要这一步**，Mode B 不在 master 控制下，不需要禁用）：

```javascript
function updateSubToggles(enabled) {
  ['popupShowLcSidebar', 'popupShowVpSidebar', 'popupShowTimerSidebar', 'popupShowCaptureRing', 'popupShowSpeedRing', 'popupShowXxxSidebar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}
```

#### Step 7：可选 — 让圆环可拖动

如果用户希望圆环可以拖到任意位置（而不只是悬浮在右侧），在 `build()` 末尾加一行（必须在 `document.body.appendChild(wrapper)` 之后，pointer 事件才能在 host 上传递）:

```javascript
document.body.appendChild(wrapper);
window.__tabboardRingDrag?.attach(
  shadow.getElementById(WRAPPER_ID + '-trigger'),
  shadow.getElementById(WRAPPER_ID + '-panel'),
  wrapper,                            // ← 第三个参数必须是 host(不是 trigger)
  { defaultOrder: N, ringId: RING_ID }  // ← N 和 Step 1 一致;ringId 唯一
);
```

**关键约束**:

- `defaultOrder` 是该 ring 在 manifest 列表中的序号(0/1/2/...),决定整体拖动时的间距锚点;**不能重复,不能跳号**
- `ringId` 唯一字符串,让 drag 用 `getCurrentOrder(ringId)` 查动态序号(关闭其他 ring 后序号会变)
- 第三个参数必须是 `wrapper`(主文档可见的 host),**不是 trigger**(shadow DOM 内的 trigger 接收不到主文档的 CSS 变量)
- drag **只写** `host.style.setProperty('--ring-stack-anchor', ...)`,**禁止**写 inline `style.top`(会永久覆盖 CSS calc,关闭其他 ring 后其他 ring 不会动)
- 多 ring 拖动时**所有 ring 的 `:host` CSS 必须字节级一致**(特别是都不能带 `transform`),否则 `getBoundingClientRect()` 返回的坐标系会差 530px

详细原理 + 拖动契约 + 530px bug 复现 → `references/draggable-ring.md`

#### Step 8：必做 — 注册到 ring-order 协调器(≥2 ring 时)

每个 ring 的 `build()` 末尾还要再调一行 `register`(在 attach 之后或之前都行):

```javascript
window.__tabboardRingOrder?.register({
  ringId: RING_ID,
  host: wrapper,
  defaultOrder: N,
  isAlive: () => { /* 见 Step 2 的 isAlive 闭包 */ }
});
```

**不调 register 的后果**:ring 仍会 build 并显示,但关闭其他 ring 后**留下 52px 永久空缺**,不参与垂直自动补位。

完整协调器设计 + dedup 三档 + 错误案例 → `references/ring-order-auto-fill.md`

### Mode B：Free-Floating Entry

**跳到 `references/free-floating-entry.md` 直接抄模板**——那里有最小可运行代码 + 5 步流程 + 11 项检查清单。

---

## 多圆环总开关（master switch）

当注入式圆环 **≥2 个**时，加一个 master 总开关统一控制：

- **settings 字段**：`ringSidebarEnabled`（默认 `true`；判断用 `!== false` 而非 `=== true`，让 undefined 视为开，**向后兼容**）
- **每个 ring content script**：`init()` 里 `if (settings.ringSidebarEnabled === false) { return; }`；监听 `ringSidebarEnabled` 变化——关→**移除 DOM**，开→rebuild
- **关键**：关闭要**移除 DOM**（不只是 `opacity:0`），否则 hover/mousemove 仍能触发已"隐藏"的圆环

### popup 中的「注入DOM控制」专区

popup.html 里的板块标题是「注入DOM控制」(`section-title` class),板块内布局:

```
注入DOM控制
  ☑ 圆环侧边栏（总开关）               ← master，加粗 + 下分隔线（ring-master class）
    ☑ 刷题侧边栏（LeetCode CN）         ← ring-stack 子开关,缩进 20px（ring-sub class）
    ☑ 视频进度圆环                      ← ring-stack 子开关,缩进
    ☑ 计时圆环                         ← ring-stack 子开关,缩进
    ☑ 捕获视频圆环                      ← ring-stack 子开关,缩进
    ☑ 倍速控制圆环                      ← ring-stack 子开关,缩进
  ☑ 网页笔记圆环（独立注入）            ← Mode B 自由圆环（顶层,不带 ring-sub）
  ☑ 悬浮 goto 圆环（所有页面）          ← Mode B 自由圆环（顶层,不带 ring-sub）
```

**判定标准**:
- **Mode A ring-stack** → 用 `.ring-sub` 缩进 20px,master 关闭时 `disabled` 置灰;`settings.showXxxSidebar`
- **Mode B 自由圆环** → 顶层 checkbox,**不带** `.ring-sub`,master 关闭时**不影响**;`settings.showXxx`(不带 `Sidebar` 后缀,与 Mode A 命名区分)

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
| **多 ring 硬编码 `top: calc(50% + 52*N px)`** | 关闭中间一个 ring 后留下 52px 永久空缺,其他 ring 不会顶位 | 用双 CSS 变量 `calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0))`,每个 ring build 末尾调 `__tabboardRingOrder.register` |
| **drag 写 `trigger.style.top = '${y}px'`** | inline top 优先级永远高于 CSS calc,关闭其他 ring 后其他 ring 不动(永久 52px 间隙) | drag 只写 `host.style.setProperty('--ring-stack-anchor', y+'px')`,trigger/panel 不写 inline top |
| **新 ring 没注册到 ring-order 协调器** | ring 仍能 build 和显示,但关闭其他 ring 后它不参与自动补位(且**它自己**的位置仍正确) | 每个 ring build 末尾必调 `__tabboardRingOrder.register({ ringId, host, defaultOrder, isAlive })` |
| **attach 第三个参数传 triggerEl(不是 host)** | drag 写 CSS 变量到 trigger(在 shadow DOM 内),CSS 变量在 host 上读不到,拖动不生效 | 传 `wrapper`(主文档可见的 host) |
| **不传 ringId,只用 defaultOrder** | 关闭其他 ring 后,drag 用旧 defaultOrder 算偏移,VP 拖动时 LC 跳到 VP 位置 | 必传 `ringId`,drag 用 `__tabboardRingOrder.getCurrentOrder(ringId)` 查动态序号 |
| **recompute 不用 setTimeout(0)** | 同步跑时各 ring 还没 build/remove,recompute 看到的是中间态 DOM,序号分配错乱 | `chrome.storage.onChanged` 里 `setTimeout(recompute, 0)` 推到下一帧 |
| **isAlive 每次都 `chrome.runtime.sendMessage({action: 'getSettings'})`** | 异步,recompute 时 settings 还没回,看到空 | 用 `getLastSettings()` 读协调器缓存,fire-and-forget 仅在初始化时调一次 |
| **register dedup 用 `find` 后直接 `return`** | 快速 toggle 关→开时,旧 host 还没被清理,新 host 被 skip,新 wrapper 拿不到 `--ring-order` → 多 ring 重叠 | 三档 dedup:同 host 跳过 / 活 host 跳过 / 死 host 替换 |

### Mode B（Free-Floating）专属踩坑

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| **自由圆环也走 ring-stack 流程（Shadow DOM + ring-order.register + popupShowXxxSidebar）** | 圆环被塞进右侧栈、与其他 ring 撞位置、改了 `body.tabboard-side-near` 还让栈内其他圆环同时浮现 | 先判断走 Mode A 还是 Mode B;Mode B 走 `references/free-floating-entry.md`,不进 Shadow DOM,不调 `__tabboardRingOrder.register` |
| **自由圆环也写 `id` 为 `tabboard-xxx-sidebar`** | 被 `[id$="-sidebar"]` 选择器捕获,鼠标近场时 `.near` class 被加上,意外触发弹出 | Mode B 用 `tabboard-xxx-ring`(不带 `-sidebar` 后缀),绕开 ring-stack 选择器 |
| **自由圆环用 `popupShowXxxSidebar` 命名 + `.ring-sub` class** | master 总开关关时强制 `disabled`,用户关掉 master 后自由圆环也跟着灰掉 | Mode B 用 `popupShowXxx`(无 `Sidebar` 后缀)+ 不带 `.ring-sub` 顶层 checkbox;不要进 `updateSubToggles` 列表 |
| **自由圆环注入样式用 `shadow.appendChild(style)`(Shadow DOM)** | 单 host 没必要,且限制外部 CSS 工具调试;与 Mode A 模板混抄导致误判 | Mode B 用 `document.head.appendChild(styleEl)`(注:虽然 shadow-dom-isolation.md 说"必须 Shadow DOM",但**那是 Mode A 的强制前提**——Mode B 单 host 无撞 CSS 风险) |
| **自由圆环拖动和 click 都绑 `click` 事件** | 拖动结束后 click 也会触发,误展开面板 | pointer 事件 + 6px 阈值:超阈值 → drag,不触发 click;未超 → click,展开面板 |
| **自由圆环调用 `__tabboardRingDrag.attach`** | attach 会写入 `--ring-stack-anchor`,与 ring-stack 圆环的位置混淆,触发整体联动 | Mode B 自己写 pointer 拖动逻辑(模板见 `references/free-floating-entry.md`),不调用 `__tabboardRingDrag` |

---

## 成功标准检查清单

### Mode A：Ring-Stack Entry 基础
- [ ] manifest.json 的 ring content_scripts block 包含 `<all_urls>` 条目
- [ ] content script 使用 **Shadow DOM**（`attachShadow`），style + trigger + panel 都进 shadow
- [ ] shadow 内 host 自身样式/变量用 `:host`，**不用 `#host-id`**
- [ ] host 的 `top` 用 `50%`（不带 offset），offset 只加在 trigger 和 panel 上
- [ ] trigger 和 panel 用 `top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0))`(双 CSS 变量,**不要硬编码**)
- [ ] 近场浮现使用共享 mousemove（`__tabboardSideReveal` 幂等注册），同时 toggle `body.tabboard-side-near` + 各 host 的 `.near`
- [ ] transition 参数与已有圆环统一（`right 220ms / opacity 180ms`）
- [ ] popup 有独立 `xxxSettings.js` 模块
- [ ] 开关状态通过 `updateSettings` action 保存（合并语义）
- [ ] init.js 有 `showXxxSidebar: true` 默认值
- [ ] 接入 master 总开关（`ringSidebarEnabled`），判断用 `!== false`
- [ ] master 关闭时**移除 DOM**（不是只 `opacity:0`）
- [ ] popup 中子开关用 `ring-sub` class 缩进，master 关时 `disabled` 置灰
- [ ] popup/modules/ringSettings.js 的 `updateSubToggles` ID 列表中包含新 id
- [ ] 点击外部收起用 `setTimeout(0)` 延一帧绑 document click
- [ ] WRAPPER_ID 全局唯一,各 ring 无 id 冲突,**用 `-sidebar` 后缀**(让共享 mousemove 选择器能捕获)
- [ ] `:host` 显式设 `font-family`（防宿主字体穿透）

### Mode A：多 ring 协调(≥2 ring 时必做)
- [ ] manifest 把 `content/shared/ring-order.js` 排在所有 ring 之前(同 block 内)
- [ ] 每个 ring build 末尾调 `__tabboardRingOrder.register({ ringId, host, defaultOrder, isAlive })`
- [ ] `defaultOrder` 连续 0/1/2/3...,与 manifest 列表顺序一致
- [ ] `ringId` 字符串在所有 ring 间唯一
- [ ] `isAlive` 先查 `document.getElementById(WRAPPER_ID)`,再读 `getLastSettings()` 缓存,**双守卫** `ringSidebarEnabled !== false && showXxxSidebar !== false`

### Mode A：拖动(可选)
- [ ] manifest 注入 `content/shared/draggable-ring.js`(在 ring-order 之后、ring 之前)
- [ ] 每个 ring 调 `attach(trigger, panel, host, { defaultOrder, ringId })` 4 参
- [ ] 第三个参数是 `wrapper`(host),**不是 trigger**
- [ ] drag 只写 `host.style.setProperty('--ring-stack-anchor', ...)`,不写 inline `style.top`

### Mode B：Free-Floating Entry 基础
- [ ] manifest.json 中**独立** content_scripts block(与 ring block 并列,各 block 单独存在)
- [ ] **不**注入 `content/shared/ring-order.js` 或 `draggable-ring.js`
- [ ] **不**调用 `__tabboardRingOrder.register` 或 `__tabboardRingDrag.attach`
- [ ] **不**进 Shadow DOM——单 host 无撞 CSS 风险,`<style>` 注入 `document.head`
- [ ] WRAPPER_ID 用 `-ring` 后缀(不带 `-sidebar`),绕开 ring-stack 共享 mousemove 选择器
- [ ] 圆环默认右下角(`bottom: 100px; right: 100px`),pointer 拖动用 6px 阈值区分 click
- [ ] 拖动用 `host.setPointerCapture` + `getBoundingClientRect()` 算位移,clamp 到视口内
- [ ] 点击外部收起(document click)
- [ ] popup 中是**顶层** checkbox(不带 `.ring-sub`),不被 master 置灰
- [ ] popup/modules/ringSettings.js 的 `updateSubToggles` ID 列表中**不**包含
- [ ] `shouldHide` 只检查自己的开关(`showXxx`),**不查** `ringSidebarEnabled`
- [ ] popup 有独立 `xxxSettings.js` 模块(参考 `gotoSettings.js` / `noteSettings.js`)
- [ ] 开关状态通过 `updateSettings` action 保存（合并语义）
- [ ] init.js 有 `showXxx: true` 默认值(**不**带 `Sidebar` 后缀)
- [ ] 完整 11 项检查见 `references/free-floating-entry.md` 末尾
