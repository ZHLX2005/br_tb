# Hover-Reveal 风格 — 边缘近场浮现（mousemove 版）

适用于"静止时不可见、鼠标靠近屏幕边缘时滑入一个小入口"的注入式 UI。区别于"hover 直接展开面板"——这里 hover 只浮现入口本身，点击入口才展开具体内容。

## 适用场景

- 视频网站的悬浮进度条/暂停按钮
- 文档站点的悬浮目录入口
- 屏幕边缘收纳的快捷工具按钮（如 LeetCode 刷题侧边栏的圆环）
- 任意"近场浮现 → 点击展开"模式的轻量入口
- **多圆环系统**（LC + VP + Timer 等需要共享同一套浮现机制）

---

## 为什么选择 mousemove（而非 :has + hover-zone）

早期方案用 `body:has(#hover-zone:hover)` + 一个隐藏的 hover-zone div。但多圆环场景下，两条 hover-zone 同 z-index、同位置完全重叠，`:hover` 只对鼠标下**最顶层**元素生效 → 后建的 hover-zone 盖住先建的，**导致先建的圆环永远不浮现**（症状：N 个圆环只能看到 1 个）。每加一个圆环就要在 CSS 里抢 z-index 优先级，维护成本高。

**mousemove 方案**：不建任何 DOM 元素，一个共享的 `mousemove` 监听器全局检测鼠标 X 坐标。幂等注册一次，所有圆环自动协调浮现。加减圆环不需要改浮现逻辑。

---

## 架构图

```
<body class="tabboard-side-near">  ← JS 在 mousemove 中 toggle 这个 class
  ┌─── document ──────────────────────┐
  │   mousemove listener (幂等注册)     │
  │   ├── e.clientX > vw - 40          │
  │   └── toggle body class +          │
  │       所有 shadow host 的 .near     │
  │                                    │
  │   <host #sidebar> [class="near"]   │  ← shadow root 内的 trigger 响应
  │   ├── :host(.near) #trigger        │
  │   │     right: 8px; opacity: 1     │
  │   │     pointer-events: auto       │
  │   └── trigger:hover                │
  │         box-shadow 增强             │
  │                                    │
  │   <host #sidebar2> [class="near"]  │  ← 第二个圆环，同一个 mousemove
  │                                    │
  └────────────────────────────────────┘
```

---

## 核心 CSS（Shadow DOM 内）

```css
/* 入口：默认藏在右边缘外、不可点 */
#trigger {
  position: fixed;
  top: calc(50% + 52 * N px);  /* N = 0,1,2... 按 manifest 注册顺序 */
  right: -16px;
  opacity: 0;
  pointer-events: none;
  transition: right 220ms ease, opacity 180ms ease, box-shadow 200ms;
}

/* 鼠标靠近右边缘 OR 入口自身被悬浮 → 滑入 */
:host(.near) #trigger,
#trigger:hover {
  right: 8px;
  opacity: 1;
  pointer-events: auto;
}

/* 入口悬浮增强效果 */
#trigger:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.22);
}
```

**host 的 `top`必须设为 `50%`，不是 `calc(50% + offset)`** —— offset 只加在 trigger 和 panel 上（Shadow DOM 内 `:host` 的 transform 会影响 `position: fixed` 子元素的包含块，导致偏移叠加）。

---

## JS 行为编排

### 共享 mousemove 监听（幂等注册一次）

```javascript
if (!window.__tabboardSideReveal) {
  window.__tabboardSideReveal = true;
  document.addEventListener('mousemove', (e) => {
    const near = e.clientX > window.innerWidth - 40;
    // 1. 给 body 加 class（外部 CSS 用，可选）
    document.body.classList.toggle('tabboard-side-near', near);
    // 2. 给所有 shadow host 加 .near（shadow 内 :host(.near) 响应）
    document.querySelectorAll('[id$="-sidebar"]:not([id$="-panel"]):not([id$="-trigger"])')
      .forEach(host => host.classList.toggle('near', near));
  });
}
```

> `[id$="-sidebar"]` 匹配所有圆环 host（`id` 以 `-sidebar` 结尾）。用属性选择器精准匹配，不加额外 class。

### 点击入口：展开/收起具体内容

```javascript
trigger.addEventListener('click', (e) => {
  e.stopPropagation();
  wrapper.classList.toggle('expanded');
});
```

### 点击外部：自动收起（延一帧绑，避免当次点击冒泡立刻触发）

```javascript
setTimeout(() => {
  document.addEventListener('click', (e) => {
    if (!wrapper.classList.contains('expanded')) return;
    if (wrapper.contains(e.target)) return;
    wrapper.classList.remove('expanded');
  });
}, 0);
```

---

## 参数调节

| 参数 | 范围 | 影响 |
|------|------|------|
| 触发检测阈值（`clientX > vw - N`） | 16-50px | 越小越易触发，但越容易误触发 |
| 入口停靠 `right` | 4-16px | 距右边缘的距离，8-12px 比较自然 |
| 入口初始 `right` | -16 到 -W | 完全藏到屏外 |
| 滑入动画时长 | 180-280ms | 太短突兀，太长显得"跟手" |
| 触发检测高度 | 不限制（mousemove 全局） | 全屏任意高度触发 |

---

## 视觉同步关键（多圆环）

多条圆环各自用独立的 content script，但用户感知是"一组协调的圆环"：

1. **统一的浮现触发**：`window.__tabboardSideReveal` 幂等注册一次 mousemove，同步 toggle 所有 host 的 `.near`。一个文件注册，全局生效。
2. **统一 transition 参数**：`right 220ms ease, opacity 180ms ease`，panel 用 `transform 240ms cubic-bezier(.16,1,.3,1)`。参数一致 = 动效完全同步。
3. **统一位置公式**：`top: calc(50% + 52 * N px)`，N=0,1,2... 按 manifest 注册顺序。trigger 和 panel **必须同 top**。**host 本身用 `top: 50%`（不带 offset）**。
4. **统一收起逻辑**：每个圆环 `setTimeout(0)` 绑 document click，点外部收起。

---

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 兄弟选择器 `~` 跨父级匹配 | 悬浮触发带不响应 | 用 JS mousemove + 共享 class，不用 CSS 跨父级选择器 |
| 每个圆环各建一个 hover-zone div | 重叠覆盖，只能看到层序最高的圆环 | 不建任何 hover-zone，共享 mousemove 检测 |
| 入口放在 `display: flex` 的 wrapper 里，wrapper 还有不可见但占位的 panel | 入口被推到屏幕中间（240px 偏移） | 入口和 panel 都 `position: fixed`，跟 wrapper 解耦 |
| 同步绑 `document.addEventListener('click', ...)` | 打开的当次点击冒泡立刻触发收起 | `setTimeout(0)` 延一帧再绑 |
| 用 `mouseleave` 监听收起 | 鼠标移到面板上会先触发 mouseleave 又被鼠标重新进入 | 改成点击外部收起，不要自动 hover 收回 |
| `display: none` 切换入口可见性 | 没有过渡动画，硬切 | 始终占位，用 `opacity` + `right` 控制 |
| 悬浮直接展开整个大面板 | 鼠标稍微掠过就弹大块内容，干扰阅读 | hover 只浮现入口，点击才展开 |
| host 用了 `top: calc(50% + offset)` | host 的 transform 影响 shadow 内 `position: fixed` 子元素的包含块，偏移重叠，圆环位置不准 | host 始终坚持 `top: 50%`，offset 只加在 trigger 和 panel 上 |

---

## 与"hover 直接展开面板"的取舍

| 维度 | hover 直接展开 | hover-reveal（推荐） |
|------|----------------|----------------------|
| 打扰程度 | 高，鼠标掠过就触发 | 低，静止完全不可见 |
| 误触成本 | 误展开后需主动关闭 | 误触只显示入口，零成本 |
| 视觉占据 | 大块面板随时待命 | 极小入口（40px 圆环级别） |
| 适用内容 | 强相关辅助信息 | 独立工具入口 |

---

## 成功标准检查清单

- [ ] 静止时入口完全不可见、不可点（`opacity: 0; pointer-events: none`）
- [ ] 使用共享 mousemove 检测（`window.__tabboardSideReveal` 幂等注册），不建 hover-zone div
- [ ] mousemove 同时 toggle `body` class 和所有 shadow host 的 `.near` class
- [ ] 入口 `position: fixed`，不被任何 flex/grid 布局影响
- [ ] 点击入口展开具体内容，点击外部自动收起
- [ ] 关闭按钮延一帧绑 document 监听
- [ ] 滑入动画 220ms / 180ms，与已有圆环统一
- [ ] host 用 `top: 50%`，offset 只加在 trigger/panel 上
