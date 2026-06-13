# Hover-Reveal 风格 — 边缘近场浮现

适用于"静止时不可见、鼠标靠近屏幕边缘时滑入一个小入口"的注入式 UI。区别于"hover 直接展开面板"——这里 hover 只浮现入口本身，点击入口才展开具体内容。

## 适用场景

- 视频网站的悬浮进度条/暂停按钮
- 文档站点的悬浮目录入口
- 屏幕边缘收纳的快捷工具按钮（如 LeetCode 刷题侧边栏的圆环）
- 任意"近场浮现 → 点击展开"模式的轻量入口

## 架构图

```
<body>
  <div id="hover-zone">      ← 隐形触发带，position: fixed，right: 0
  <div id="wrapper">          ← 入口容器，position: fixed; right: -N; opacity: 0
    <div id="trigger">        ← 入口（小圆环/小按钮）
    <div id="panel">          ← 点击 trigger 后展开的具体内容
  </div>
</body>
```

## 核心 CSS 三件套

```css
/* 1. 隐形触发带：覆盖屏幕右边缘 */
#hover-zone {
  position: fixed;
  top: 0; right: 0;
  width: 32px;          /* 越大越容易触发，16-50px 都可 */
  height: 100vh;
  z-index: 999998;
}

/* 2. 入口：默认藏在右边缘外、不可点 */
#trigger {
  position: fixed;
  top: 50%; right: -40px;
  opacity: 0;
  pointer-events: none;
  transition: right 220ms ease, opacity 180ms ease, box-shadow 200ms;
}

/* 3. 跨父级联动：触发带被悬浮 OR 入口自身被悬浮 → 滑入 */
/* 关键：不能用 ~ 兄弟选择器，因为 trigger 在 wrapper 里，跟 hover-zone 不是兄弟 */
body:has(#hover-zone:hover) #trigger,
body:has(#trigger:hover) #trigger,
#trigger:hover {
  right: 8px;
  opacity: 1;
  pointer-events: auto;
}
```

## JS 行为编排

```js
// 1. 点击入口：展开/收起具体内容
trigger.addEventListener('click', (e) => {
  e.stopPropagation();
  wrapper.classList.toggle('expanded');
});

// 2. 点击外部：自动收起（延一帧绑，避免当次点击冒泡立刻触发）
setTimeout(() => {
  document.addEventListener('click', (e) => {
    if (!wrapper.classList.contains('expanded')) return;
    if (wrapper.contains(e.target)) return;
    wrapper.classList.remove('expanded');
  });
}, 0);
```

## 参数调节

| 参数 | 范围 | 影响 |
|------|------|------|
| 触发带宽度 | 16-50px | 越大越易触发，但越容易误触发 |
| 入口停靠 `right` | 4-16px | 距右边缘的距离，8-12px 比较自然 |
| 入口初始 `right` | -40 到 -W | 完全藏到屏外 |
| 滑入动画时长 | 180-280ms | 太短突兀，太长显得"跟手" |
| 触发带高度 | 100vh vs 中部 | 全屏任意高度触发；中部触发更"克制" |

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 兄弟选择器 `~` 跨父级匹配 | 悬浮触发带不响应 | 用 `body:has(:hover)` 跨父级 |
| 入口放在 `display: flex` 的 wrapper 里，wrapper 还有不可见但占位的兄弟 | 入口被推到屏幕中间（240px 偏移） | 入口和面板都 `position: fixed`，跟 wrapper 解耦 |
| 同步绑 `document.addEventListener('click', ...)` | 打开的当次点击冒泡立刻触发收起 | `setTimeout(0)` 延一帧再绑 |
| 用 `mouseleave` 监听收起 | 鼠标移到面板上会先触发 mouseleave 又被鼠标重新进入 | 改成点击外部收起，不要自动 hover 收回 |
| `display: none` 切换入口可见性 | 没有过渡动画，硬切 | 始终占位，用 `opacity` + `right` 控制 |
| 悬浮直接展开整个大面板 | 鼠标稍微掠过就弹大块内容，干扰阅读 | hover 只浮现入口，点击才展开 |

## 与"hover 直接展开面板"的取舍

| 维度 | hover 直接展开 | hover-reveal（推荐） |
|------|----------------|----------------------|
| 打扰程度 | 高，鼠标掠过就触发 | 低，静止完全不可见 |
| 误触成本 | 误展开后需主动关闭 | 误触只显示入口，零成本 |
| 视觉占据 | 大块面板随时待命 | 极小入口（40px 圆环级别） |
| 适用内容 | 强相关辅助信息 | 独立工具入口 |

## 成功标准检查清单

- [ ] 静止时入口完全不可见、不可点（`opacity: 0; pointer-events: none`）
- [ ] 触发带覆盖屏幕右边缘且宽度 ≥ 32px
- [ ] 用 `body:has(:hover)` 跨父级联动，不用 `~`
- [ ] 入口 `position: fixed`，不被任何 flex/grid 布局影响
- [ ] 点击入口展开具体内容，点击外部自动收起
- [ ] 关闭按钮延一帧绑 document 监听
- [ ] 滑入动画 200ms 左右，不超过 300ms
