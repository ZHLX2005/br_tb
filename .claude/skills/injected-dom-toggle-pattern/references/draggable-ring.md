# Draggable Ring — 圆环拖动 + 位置记忆(双 CSS 变量版)

> 配套 `ring-order-auto-fill.md`(自动补位协调器)和 `shadow-dom-isolation.md`(Shadow DOM 基础)。
> 本 ref 讲**拖动 + 跨 ring 联动 + 位置记忆**的可复用模式,使用统一 CSS 变量系统。

## 适用场景

多个悬浮圆环希望:
- 用户**按住拖动**到任意 Y 位置
- 拖动任一圆环时,**其他圆环整体跟随**(保持 52px 间距不变)
- 松手后位置**全局记忆**(下次打开还在原位)
- 与 `ring-order-auto-fill` 协作无冲突(拖动 + 自动补位双变量各管一维)
- 与 hover-reveal(靠近右边缘滑入)兼容不冲突

## 架构图

```
content/shared/ring-order.js   (manifest 第一位)
  └─ 协调器,管 --ring-order(序号)

content/shared/draggable-ring.js   (manifest 第二位)
  └─ 暴露 window.__tabboardRingDrag.attach(trigger, panel, host, { defaultOrder, ringId })
     内部维护:
     - window.__tabboardRings = [{ trigger, panel, host, defaultOrder, ringId }, ...]
     - window.__tabboardRingDragging = true  (拖动期间屏蔽 hover-reveal)
     - 写 host.style.setProperty('--ring-stack-anchor', y+'px')

content/lcSidebar.js     attach(trigger, panel, wrapper, { defaultOrder: 0, ringId: 'lc' })
content/vpSidebar.js     attach(trigger, panel, wrapper, { defaultOrder: 1, ringId: 'vp' })
content/timerSidebar.js  attach(trigger, panel, wrapper, { defaultOrder: 2, ringId: 'timer' })
content/captureRing.js   attach(trigger, panel, wrapper, { defaultOrder: 3, ringId: 'capture' })

chrome.storage.local.ringStackOffsetY  (全局共享锚点 Y 像素值)
```

## 装配顺序(manifest 关键)

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
        "content/captureRing.js"
      ],
      "run_at": "document_end"
    }
  ]
}
```

> `ring-order.js` 必须在第一位,`draggable-ring.js` 紧跟其后;ring 文件全部排在最后。

## API

```js
window.__tabboardRingDrag.attach(triggerEl, panelEl, hostEl, {
  defaultOrder: 0,                  // 必填, manifest 注册顺序(0/1/2/3...)
  ringId: 'lc'                      // 必填, 让 drag 用协调器查当前序号
});
```

- `triggerEl` / `panelEl` — shadow DOM 内的 trigger 和 panel(用于绑 pointer 事件)
- `hostEl` — **主文档可见的 host 元素**(`wrapper = document.getElementById(WRAPPER_ID)`)。drag 写 CSS 变量到这里,**不是 trigger**
- `defaultOrder` — manifest 注册顺序,recompute 时按它升序派发 0/1/2/3
- `ringId` — 唯一字符串,`getCurrentOrder(ringId)` 查动态序号(关闭其他 ring 后序号会变)

## 完整实现(双变量版)

```javascript
/**
 * Draggable Ring — 多圆环整体拖动 + 位置记忆(双 CSS 变量版)
 * 暴露 window.__tabboardRingDrag.attach(trigger, panel, host, { defaultOrder, ringId })
 * 写 host 的 --ring-stack-anchor;ring 的 CSS calc 与 --ring-order 组合算位置
 */
(function () {
  'use strict';

  const SPACING = 52;        // ring 之间垂直间距(px, 与 cookbook 一致)
  const DRAG_THRESHOLD = 5;  // pointermove 距离超过此值才进入拖动模式
  const EDGE_TOP = 20;       // 拖动上边界
  const EDGE_BOTTOM = 60;    // 拖动下边界
  const STORAGE_KEY = 'ringStackOffsetY';
  const DRAG_FLAG = '__tabboardRingDragging';

  // 共享状态
  window.__tabboardRings = window.__tabboardRings || [];
  window.__tabboardRingDrag = window.__tabboardRingDrag || { attach };

  function attach(triggerEl, panelEl, hostEl, opts = {}) {
    const defaultOrder = opts.defaultOrder;
    const ringId = opts.ringId || null;
    if (defaultOrder == null) {
      console.warn('[draggable-ring] defaultOrder required');
      return;
    }
    if (!hostEl) {
      // 兜底:从 triggerEl 找 shadow host
      const root = triggerEl && triggerEl.getRootNode && triggerEl.getRootNode();
      hostEl = (root && root.host) || triggerEl;
    }

    // 同 trigger 去重
    window.__tabboardRings = window.__tabboardRings.filter(function (r) { return r.trigger !== triggerEl; });

    const ringEntry = { trigger: triggerEl, panel: panelEl, host: hostEl, defaultOrder, ringId };
    window.__tabboardRings.push(ringEntry);

    initPositionFromStorage(ringEntry);

    let dragState = null;
    let didDrag = false;
    let scheduledFrame = null;

    triggerEl.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      try { triggerEl.setPointerCapture(e.pointerId); } catch (_) {}
      // 锚点 Y = 当前 --ring-stack-anchor(未设时 = innerHeight/2,等价于 50%)
      const anchorY = getCurrentAnchorY(hostEl);
      dragState = { startX: e.clientX, startY: e.clientY, anchorY };
      didDrag = false;
    });

    triggerEl.addEventListener('pointermove', function (e) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!didDrag && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!didDrag) {
        didDrag = true;
        window[DRAG_FLAG] = true;
      }
      const newAnchorY = clamp(dragState.anchorY + dy, EDGE_TOP, window.innerHeight - EDGE_BOTTOM);
      if (scheduledFrame) return;
      scheduledFrame = requestAnimationFrame(function () {
        scheduledFrame = null;
        applyStackPosition(newAnchorY);
      });
    });

    triggerEl.addEventListener('pointerup', function (e) {
      if (!dragState) return;
      try { triggerEl.releasePointerCapture(e.pointerId); } catch (_) {}
      if (didDrag) {
        schedulePersist(getCurrentAnchorY(hostEl));
        suppressNextClick(triggerEl);
      }
      dragState = null;
      setTimeout(function () { window[DRAG_FLAG] = false; }, 50);
    });
  }

  // 查当前序号;优先用 ringId 走协调器,fallback 到 defaultOrder
  function getRingOrder(ringEntry) {
    if (ringEntry.ringId && window.__tabboardRingOrder && typeof window.__tabboardRingOrder.getCurrentOrder === 'function') {
      const n = window.__tabboardRingOrder.getCurrentOrder(ringEntry.ringId);
      if (n >= 0) return n;
    }
    return ringEntry.defaultOrder;
  }

  // 核心:锚点 Y → 所有 host 的 --ring-stack-anchor(CSS 自动算每个 ring 的位置)
  function applyStackPosition(anchorY) {
    // 清理死 host(已被 remove)
    window.__tabboardRings = window.__tabboardRings.filter(function (r) {
      return r.host && r.host.isConnected;
    });
    for (var i = 0; i < window.__tabboardRings.length; i++) {
      window.__tabboardRings[i].host.style.setProperty('--ring-stack-anchor', anchorY + 'px');
    }
  }

  function initPositionFromStorage(ringEntry) {
    chrome.storage.local.get([STORAGE_KEY], function (result) {
      if (!ringEntry.host || !ringEntry.host.isConnected) return;
      const savedY = result[STORAGE_KEY];
      if (typeof savedY === 'number') {
        ringEntry.host.style.setProperty('--ring-stack-anchor', savedY + 'px');
        ringEntry.host.dataset.dragInitialized = '1';
      }
    });
  }

  let persistTimer = null;
  function schedulePersist(anchorY) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      chrome.storage.local.set({ [STORAGE_KEY]: anchorY });
    }, 300);
  }

  function suppressNextClick(el) {
    const swallow = function (e) {
      e.stopPropagation();
      e.preventDefault();
      el.removeEventListener('click', swallow, true);
    };
    el.addEventListener('click', swallow, true);
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function getCurrentAnchorY(hostEl) {
    const inline = hostEl.style.getPropertyValue('--ring-stack-anchor');
    if (inline && inline.endsWith('px')) {
      const n = parseFloat(inline);
      if (!isNaN(n)) return n;
    }
    return window.innerHeight / 2;
  }
})();
```

## 在每个 ring content script 中启用

```javascript
// content/lcSidebar.js
document.body.appendChild(wrapper);
window.__tabboardRingDrag && window.__tabboardRingDrag.attach(
  shadow.getElementById(WRAPPER_ID + '-trigger'),
  shadow.getElementById(WRAPPER_ID + '-panel'),
  wrapper,                            // ← 第三个参数是 host
  { defaultOrder: 0, ringId: 'lc' }   // ← ringId 让 drag 查动态序号
);
```

## 关键算法

### 联动位置计算(用动态序号,不是 defaultOrder)

```
newAnchorY = clamp(anchorY + dy, 20, innerHeight - 60)
for each ring:
  ring.host.style.setProperty('--ring-stack-anchor', newAnchorY + 'px')
  // ↑ CSS calc 内部用 getCurrentOrder(ringId) * 52 算每个 ring 偏移
  // ↑ 关闭其他 ring 后 getCurrentOrder 反映动态序号,不用手动算
```

### 锚点 Y 语义

- `anchorY` 是 **defaultOrder=0(LC 等锚点 ring)的 top**,不是被拖 ring 自己的 top
- pointerdown: `anchorY = getCurrentAnchorY(hostEl)`(读 --ring-stack-anchor 变量)
- pointermove: `newAnchorY = anchorY + dy`
- pointerup 持久化: `anchorY = getCurrentAnchorY(hostEl)`(同样读变量)
- **不这样做**:拖 VP 时用 VP 的 top 当锚点 → 联动时 LC 跳到 VP 位置

### 与 hover-reveal 兼容

- hover-reveal 在 `window[DRAG_FLAG] = true` 期间被屏蔽(各 ring 的 mousemove handler 跳过)
- 松手后延迟 50ms 清除 flag(让 click suppression 先注册)
- 或者更简单:drag 时给 `body` 加 `dragging` class,hover-reveal CSS 检查 `body:not(.dragging)`

### Shadow DOM 内 setPointerCapture

`triggerEl.setPointerCapture(e.pointerId)` 在 shadow root 内调用 works(标准支持)。**关键**:捕获后所有 pointermove/pointerup 都发到这个 trigger,即使鼠标拖出 trigger 范围也不丢事件。

### Shadow DOM 协调(多 ring host 规则必须完全一致)

**所有 ring 的 `:host` 规则必须字节级一致**——任何不一致会导致坐标系混乱,拖动联动全错位:

```css
:host {
  position: fixed; top: 50%; right: 0;
  z-index: 999999;
  /* 绝对不要加: transform: translateY(-50%) 或任何 transform */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
```

**原因**:
- host 的 `transform` 创建 containing block,host 内的 `position: fixed` 子元素(trigger/panel)变成相对 host(不再相对视口)
- 一个 ring 有 transform,其他没有 → 两者 trigger top 像素值相同但渲染位置差 200-500px
- 拖动代码所有 `top` 都按"相对视口"算,哪个 ring host 有 transform 哪个就失效

**所有 ring 的 host CSS 必须字节级一致**(用同一个模板,不要各自复制粘贴)。详见 `shadow-dom-isolation.md`。

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 没 `setPointerCapture`,鼠标拖出 trigger 后丢事件 | 拖动中断,圆环卡住 | pointerdown 立即 capture |
| `mousemove` 直接 `style.top = ...`(每帧多次) | 卡顿,掉帧 | `requestAnimationFrame` 节流 |
| 拖动中没屏蔽 hover-reveal | 鼠标靠近右边缘时圆环突然"贴回去",抖动 | 拖动期间 `window[DRAG_FLAG]=true`,hover-reveal 检查 |
| 拖动结束立即 `storage.set` | 拖 1 秒触发几百次写 | `schedulePersist` 防抖 300ms |
| 没裁剪边界 | 圆环拖出视口顶部/底部 | `clamp(y, 20, innerHeight - 60)` |
| 边界没留呼吸 | 圆环贴边完全切掉 | EDGE_TOP=20 / EDGE_BOTTOM=60 |
| 拖动后没 suppress click | 拖完立刻 click 触发面板展开(误触) | `suppressNextClick` 用 capture 阶段捕获并 stopPropagation |
| **拖动时用"被拖 ring 的 top" 当锚点 Y** | 拖 VP/Timer 时, LC/其他 ring 跳到错的位置(锚点概念搞反) | pointerdown 时读 `--ring-stack-anchor` 变量(等价于 LC 的 top) |
| **拖动写 inline `style.top` 到 trigger/panel** | inline top 永久覆盖 CSS calc,关闭其他 ring 后其他 ring 不会动,自动补位失效 | drag 只写 `host.style.setProperty('--ring-stack-anchor', y+'px')` |
| **attach 第三个参数传 triggerEl** | drag 写 CSS 变量到 trigger(在 shadow DOM 内),CSS 变量在 host 上读不到,拖动不生效 | 传 `wrapper`(主文档可见的 host) |
| **不传 ringId,只用 defaultOrder** | 关闭其他 ring 后,drag 用旧 defaultOrder 算偏移,VP 拖动时 LC 跳到 VP 位置 | 传 `ringId`,drag 用 `__tabboardRingOrder.getCurrentOrder(ringId)` 查动态序号 |
| **多 ring host CSS 不一致**(一个有 `transform`, 其他没有) | 拖动后 inline top 看着差 52(对), 但 rectTop 差 530px(混坐标系) | 所有 ring 用同一份 `:host` 模板,字节级一致,严禁 host 加 `transform` |
| 多 ring 各自存 Y | 拖一个其他不跟,违背"整体联动" | 全局存一个锚点 Y,host 共享 `--ring-stack-anchor` |
| `attach` 没去重 | 同一 trigger 绑多次 listener,拖动一次触发多次更新 | 检查 `__tabboardRings` 已有同 trigger 则过滤掉 |
| 没考虑 `host.isConnected` | 已被 remove 的 host 仍参与 applyStackPosition,DOM 操作浪费 | 每次 applyStackPosition 先 filter `r.host.isConnected` |
| `getCurrentAnchorY` 读 computed style | 慢,layout thrashing | 读 inline style.getPropertyValue('--ring-stack-anchor') |

## 初始化闪烁(可接受,非 bug)

页面加载 + 之前拖过圆环:
1. 各 ring IIFE 跑,build,attach,register → `recompute` 同步设 `--ring-order`
2. 首次渲染:各 ring 在 `calc(50% + 52*order)` 的位置(0/52/104/156)
3. 几毫秒后 `initPositionFromStorage` 回调触发,写 `--ring-stack-anchor: savedY px` 到各 host
4. CSS 重算:整个 ring 栈从 center-spread 同步平移到 `savedY-spread`

**现象**:整个栈同步滑动一下,不是单 ring 闪烁。**可接受**。要消除可在 `attach` 时同步读 storage(用 `chrome.storage.local.get` 的 sync 版本),但实现复杂、收益小。

## 检查清单

- [ ] manifest 中 `draggable-ring.js` 排在所有 ring 之前(在 `ring-order.js` 之后)
- [ ] 每个 ring content script 在 `body.appendChild(wrapper)` **之后**调 `attach`(否则 host 还没挂载,pointer 事件不通)
- [ ] `attach` 调用是 4 参:trigger, panel, **host(wrapper)**, opts
- [ ] opts 含 `defaultOrder` 和 `ringId`,两者必填
- [ ] `defaultOrder` 按 manifest 注册顺序 0/1/2/3...
- [ ] `ringId` 在多 ring 间唯一
- [ ] trigger 内 `pointerdown` 立即 `setPointerCapture`
- [ ] pointermove 用 `requestAnimationFrame` 节流,**不用**直接同步写 style
- [ ] 拖动阈值 5px(避免 click 误触)
- [ ] 边界裁剪 `clamp(y, 20, innerHeight - 60)`
- [ ] 拖动期间屏蔽 hover-reveal(`window[DRAG_FLAG]` 或 `body.dragging`)
- [ ] 松手后 `suppressNextClick` 阻止误触
- [ ] 持久化用 `schedulePersist` 防抖 300ms
- [ ] 持久化值是**绝对像素 Y**(`${y}px`),不是百分比
- [ ] 多 ring 联动存**一个**锚点 Y(`ringStackOffsetY`),不是每个 ring 独立存
- [ ] drag **只写** `host.style.setProperty('--ring-stack-anchor', ...)`,不写 inline top
- [ ] drag 用 `getCurrentOrder(ringId)` 查动态序号(不直接用 `defaultOrder`)
- [ ] `__tabboardRings` 在 `applyStackPosition` 入口 filter `r.host.isConnected`
- [ ] `getCurrentAnchorY` 读 host 的 `--ring-stack-anchor` inline style,fallback 到 innerHeight/2
- [ ] 所有 ring 的 `:host` CSS 字节级一致(用同一份模板)
