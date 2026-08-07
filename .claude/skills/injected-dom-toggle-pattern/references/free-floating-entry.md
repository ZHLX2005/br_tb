---
name: free-floating-entry
description: 自由悬浮的注入式圆环（不参与 ring-order 栈、不接入 master 总开关、可拖动到任意位置），与「右侧圆环侧边栏」平级。参考 goto.js / noteRing.js 实现。
---

# Free-Floating Entry — 自由悬浮注入模式

## 适用场景

注入一个**自由悬浮**的圆环（不参与右侧 ring 栈联动），典型需求：

- 网页便签 / 速记 / Todo / 提醒
- 速查工具（颜色拾取、截图、翻译）
- AI 助手入口
- 与 goto 同性质的"快捷菜单"

## 与 Ring-Stack Entry 的核心区别

| 维度 | Ring-Stack Entry | Free-Floating Entry |
|------|------------------|---------------------|
| 位置 | 右侧边栏，垂直自动补位 | 自由定位（默认右下角） |
| 拖动 | 整体联动（保持 52px 间距） | 单独拖动到任意位置 |
| 总开关 | 受 `ringSidebarEnabled` 控制 | **独立**，不受任何 master 控制 |
| 内容脚本 block | 与 ring-order/draggable-ring 同 block | **独立** content_scripts block |
| Ring-order 注册 | 必调 `__tabboardRingOrder.register` | **不调** |
| Shadow DOM | **必须**（栈内有多个 ring，会撞 CSS） | **不需要**（只有一个 host，用 `document.head` 注入 `<style>` 隔离即可） |
| Popup 中位置 | 缩进（`.ring-sub`） | 顶层（独立 checkbox） |

> **关键判断**：如果你的圆环会和其他 ring 共存于右侧并参与拖动栈联动 → Ring-Stack Entry。
> 如果圆环是独立工具、单独出现、单独拖动 → Free-Floating Entry。

## 文件清单

| 文件 | 职责 |
|------|------|
| `content/xxxRing.js` | IIFE：自包含构建、样式、交互、拖动。无外部依赖 |
| `popup/popup.html` | 在「注入DOM控制」板块下，加**顶层** checkbox（不带 `.ring-sub`） |
| `popup/modules/xxxSettings.js` | popup 开关模块（用 `updateSettings` action） |
| `popup/popup.js` | import 并调用 load/bind |
| `background/init.js` | `settings` 加 `showXxx: true` 默认值 + 旧用户迁移 |
| `manifest.json` | **独立** content_scripts block（与 goto.js 并列） |

> **不**依赖 `content/shared/ring-order.js` 或 `draggable-ring.js`。
> **不**在 popup/modules/ringSettings.js 的 `updateSubToggles` ID 列表中加（它不归 master 管，不会被置灰）。

## Step 1：manifest.json — 独立 block

```json
{
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content/lcSidebar.js", "..."], "run_at": "document_end" },
    { "matches": ["<all_urls>"], "js": ["content/xxxRing.js"], "run_at": "document_end" },
    { "matches": ["<all_urls>"], "js": ["content/inject/goto/goto.js"], "run_at": "document_end" }
  ]
}
```

## Step 2：content script — 最小可抄模板

```javascript
/**
 * XXX Ring — 一句话描述
 * 自由悬浮的圆环（不参与 ring-order 栈），可拖动到任意位置
 */
(function () {
  'use strict';

  const WRAPPER_ID = 'tabboard-xxx-ring';
  const ACCENT = '#ffb74d';

  // 防止重复注入
  if (window.__tabboardXxxRingInjected) return;
  window.__tabboardXxxRingInjected = true;

  // 状态
  let wrapper = null;
  let panel = null;
  let isExpanded = false;

  // 样式（不进 Shadow DOM — 单 host，无撞 CSS 风险）
  const STYLES = `
    #${WRAPPER_ID} {
      position: fixed; bottom: 100px; right: 100px;
      width: 56px; height: 56px; z-index: 999999;
      cursor: grab; user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    #${WRAPPER_ID}.dragging { cursor: grabbing; }
    #${WRAPPER_ID}-circle {
      width: 56px; height: 56px; border-radius: 50%;
      background: white; border: 2px solid ${ACCENT};
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      display: flex; align-items: center; justify-content: center;
      transition: transform 200ms ease, box-shadow 200ms;
    }
    #${WRAPPER_ID}-circle:hover { transform: scale(1.08); }

    /* 面板（独立 fixed，append body） */
    #${WRAPPER_ID}-panel {
      position: fixed; top: 80px; right: 40px;
      width: 320px; max-height: 70vh;
      background: white; border-radius: 14px;
      box-shadow: -2px 6px 28px rgba(0,0,0,0.22);
      border: 1px solid ${ACCENT}33;
      z-index: 999998;
      opacity: 0; visibility: hidden; pointer-events: none;
      transform: translateY(-8px) scale(0.96);
      transform-origin: top right;
      transition: opacity 180ms ease, transform 220ms cubic-bezier(.16,1,.3,1), visibility 0s linear 220ms;
    }
    #${WRAPPER_ID}-panel.open {
      opacity: 1; visibility: visible; pointer-events: auto;
      transform: translateY(0) scale(1);
      transition: opacity 180ms ease, transform 220ms cubic-bezier(.16,1,.3,1), visibility 0s;
    }
    /* ... 面板内容样式 ... */
  `;

  function build() {
    if (document.getElementById(WRAPPER_ID)) return;

    // 样式注入 document.head（不是 shadow — 单 host 不需要 Shadow DOM 隔离）
    const styleEl = document.createElement('style');
    styleEl.id = WRAPPER_ID + '-style';
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);

    // 圆环 host（可拖动）
    wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    wrapper.style.left = (window.innerWidth - 100) + 'px';
    wrapper.style.top = (window.innerHeight - 100) + 'px';
    wrapper.innerHTML = `
      <div id="${WRAPPER_ID}-circle">
        <svg width="26" height="26" viewBox="0 0 24 24"><!-- 图标 --></svg>
      </div>
    `;
    document.body.appendChild(wrapper);

    // 面板
    panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';
    panel.innerHTML = `<!-- 面板内容 -->`;
    document.body.appendChild(panel);

    // 拖动 + 点击（区分阈值 6px）
    bindDragAndClick(wrapper, /* clickCallback */ () => togglePanel());

    // 阻止面板内点击冒泡
    panel.addEventListener('click', e => e.stopPropagation());
  }

  function bindDragAndClick(host, onClick) {
    const TH = 6;
    let pid = null, sx = 0, sy = 0, sl = 0, st = 0, moved = false;
    host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pid = e.pointerId;
      try { host.setPointerCapture(pid); } catch (_) {}
      sx = e.clientX; sy = e.clientY;
      const r = host.getBoundingClientRect();
      sl = r.left; st = r.top; moved = false;
    });
    host.addEventListener('pointermove', (e) => {
      if (pid === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) > TH) { moved = true; host.classList.add('dragging'); }
      if (moved) {
        host.style.left = Math.max(0, Math.min(window.innerWidth - host.offsetWidth, sl + dx)) + 'px';
        host.style.top = Math.max(0, Math.min(window.innerHeight - host.offsetHeight, st + dy)) + 'px';
        host.style.right = 'auto'; host.style.bottom = 'auto';
      }
    });
    host.addEventListener('pointerup', () => {
      pid = null;
      if (moved) { host.classList.remove('dragging'); moved = false; }
      else onClick();
    });
  }

  function togglePanel() {
    if (!panel) return;
    isExpanded = !isExpanded;
    panel.classList.toggle('open', isExpanded);
  }

  function applyEnabled(enabled) {
    if (enabled) build(); else remove();
  }

  function remove() {
    document.getElementById(WRAPPER_ID)?.remove();
    panel?.remove(); panel = null; wrapper = null;
    document.getElementById(WRAPPER_ID + '-style')?.remove();
    isExpanded = false;
  }

  async function init() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
      const s = res.success ? (res.settings || {}) : {};
      // 不受 ringSidebarEnabled 控制，只看自己的开关
      applyEnabled(s.showXxx !== false);
    } catch (_) {}
  }

  // 点击外部收起
  document.addEventListener('click', () => {
    if (isExpanded && panel) { isExpanded = false; panel.classList.remove('open'); }
  });

  // ESC 收起
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isExpanded) {
      isExpanded = false; panel?.classList.remove('open');
    }
  });

  // settings 变化
  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'local' || !changes.settings) return;
    applyEnabled((changes.settings.newValue || {}).showXxx !== false);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
```

## Step 3：popup — 顶层条目

popup.html 「注入DOM控制」板块下加**顶层** checkbox（不带 `.ring-sub`，不被 master 置灰）：

```html
<label class="setting-row">
  <input type="checkbox" id="popupShowXxx">
  <span>我的自由圆环</span>
</label>
```

> **不要**用 `.ring-sub` class —— 自由圆环不归 master 管，master 关闭时不应被置灰。

## Step 4：popup/modules/xxxSettings.js

参考 `popup/modules/gotoSettings.js`：
- `loadXxxSetting()` — 从 settings 加载开关
- `bindXxxEvents()` — change 时调 `updateSettings` action（合并语义）

## Step 5：background/init.js

```javascript
if (updatedSettings.showXxx === undefined) {
  updatedSettings.showXxx = true;
  needUpdate = true;
}
```

## 成功标准检查清单

- [ ] manifest.json 中**独立** content_scripts block（与 ring 块并列）
- [ ] **不**注入 `content/shared/ring-order.js` 或 `draggable-ring.js`
- [ ] **不**调用 `__tabboardRingOrder.register` 或 `__tabboardRingDrag.attach`
- [ ] **不**进 Shadow DOM（单 host 无撞 CSS 风险，`<style>` 注入 document.head）
- [ ] 圆环默认右下角，pointer 拖动（6px 阈值区分 click）
- [ ] 拖动用 `host.setPointerCapture` + `getBoundingClientRect()` 算位移，clamp 到视口内
- [ ] 点击外部收起（document click）
- [ ] popup 中是**顶层** checkbox（不带 `.ring-sub`），不被 master 置灰
- [ ] `popup/modules/ringSettings.js` 的 `updateSubToggles` ID 列表中**不**加
- [ ] `shouldHide` 只检查自己的开关（不查 `ringSidebarEnabled`）
- [ ] WRAPPER_ID 全局唯一，**不用 `-sidebar` 后缀**（避开 ring 栈的 `[id$="-sidebar"]` 共享选择器）

## 相关专项 ref（按需深入）

| 你的附加需求 | 读这篇 |
|------------|--------|
| 面板里有**下拉选择器**（页面切换器 / 下拉菜单） | [[dropdown-picker]] |
| 注入 DOM 要和 **TabBoard module 共享数据**（双向同步 CRUD） | [[module-collaboration]] |