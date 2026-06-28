# Draggable Ring — 圆环拖动 + 位置记忆

> 配套 `shadow-dom-isolation.md` 和 `adding-a-new-ring.md`。那两篇讲 hover 浮现 + Shadow DOM,这篇讲**拖动 + 跨 ring 联动 + 位置记忆**的可复用模式。

## 适用场景

多个悬浮圆环希望:
- 用户**按住拖动**到任意 Y 位置
- 拖动任一圆环时,**其他圆环整体跟随**(保持 52px 间距不变)
- 松手后位置**全局记忆**(下次打开还在原位)
- 与 hover-reveal(靠近右边缘滑入)兼容不冲突

## 架构图

```
content/shared/draggable-ring.js  (manifest 中排在所有 ring 之前)
  └─ 暴露 window.__tabboardRingDrag.attach(trigger, panel, { ringIndex, totalRings })
     内部维护:
     - window.__tabboardRings = [{ trigger, panel, index, baseY }, ...]  (按注册顺序)
     - window.__tabboardDragging = false  (拖动期间屏蔽 hover-reveal)

content/lcSidebar.js   → attach(trigger, panel, { ringIndex: 0 })
content/vpSidebar.js    → attach(trigger, panel, { ringIndex: 1 })
content/timerSidebar.js → attach(trigger, panel, { ringIndex: 2 })

chrome.storage.local.ringStackOffsetY  (全局共享 Y 值, 第一个 ring 的中心 Y)
```

## 装配骨架(独立 content script)

manifest.json 把 `draggable-ring.js` 排在所有圆环之前(content_scripts 数组顺序):

```json
{
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content/shared/draggable-ring.js"], "run_at": "document_end" },
    { "matches": ["<all_urls>"], "js": ["content/lcSidebar.js"], "run_at": "document_end" },
    { "matches": ["<all_urls>"], "js": ["content/vpSidebar.js"], "run_at": "document_end" },
    { "matches": ["<all_urls>"], "js": ["content/timerSidebar.js"], "run_at": "document_end" }
  ]
}
```

## API

```js
window.__tabboardRingDrag.attach(triggerEl, panelEl, {
  ringIndex: 0,      // 必填, 在 ring 栈中的索引(0 = 第一个/锚点)
  totalRings: 3,     // 可选, 默认为 window.__tabboardRings.length(动态)
  storageKey: 'ringStackOffsetY'  // 可选, 默认 'ringStackOffsetY'
});
```

## 完整实现

```javascript
/**
 * Draggable Ring — 多圆环整体拖动 + 位置记忆
 * 暴露 window.__tabboardRingDrag.attach(trigger, panel, { ringIndex })
 * 通过 window.__tabboardRings 数组联动: 拖任一圆环 → 所有圆环整体移动(保持 52px 间距)
 */
(function () {
  'use strict';

  const SPACING = 52;       // ring 之间垂直间距(px, 与 cookbook 一致)
  const DRAG_THRESHOLD = 5; // pointermove 距离超过此值才进入拖动模式(避免与 click 冲突)
  const EDGE_TOP = 20;       // 拖动上边界
  const EDGE_BOTTOM = 60;   // 拖动下边界(给圆环底部留呼吸空间)
  const STORAGE_KEY = 'ringStackOffsetY';
  const DRAG_FLAG = '__tabboardRingDragging';

  // 共享状态
  window.__tabboardRings = window.__tabboardRings || [];   // [{ trigger, panel, index }]
  window.__tabboardRingDrag = window.__tabboardRingDrag || { attach };

  function attach(triggerEl, panelEl, opts = {}) {
    const ringIndex = opts.ringIndex;
    if (ringIndex == null) {
      console.warn('[draggable-ring] ringIndex required');
      return;
    }

    // 同一 ring 重复 attach 防呆
    const existing = window.__tabboardRings.find(r => r.trigger === triggerEl);
    if (existing) return;

    window.__tabboardRings.push({ trigger: triggerEl, panel: panelEl, index: ringIndex });

    // 初始化: 从 storage 读取已保存的 Y(以 ringIndex=0 为锚点)
    initPositionFromStorage(triggerEl, panelEl, ringIndex);

    // 绑定拖动手柄(pointerdown 仅记录初始状态,不立即进入拖动)
    let dragState = null;
    let didDrag = false;

    triggerEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;  // 仅左键
      triggerEl.setPointerCapture(e.pointerId);
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        startTop: parseFloat(triggerEl.style.top) || getCurrentTopPx(triggerEl)
      };
      didDrag = false;
    });

    // pointermove: 距离 > 阈值才进入拖动模式
    triggerEl.addEventListener('pointermove', (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!didDrag && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      if (!didDrag) {
        // 首次进入拖动
        didDrag = true;
        window[DRAG_FLAG] = true;
      }

      // 计算锚点 ring(ringIndex=0) 的新 topY
      const newAnchorY = clamp(
        dragState.startTop + dy,
        EDGE_TOP,
        window.innerHeight - EDGE_BOTTOM
      );

      // RAF 节流更新所有 ring 位置(保持间距)
      requestAnimationFrame(() => applyStackPosition(newAnchorY));
    });

    // pointerup: 释放 + 防抖写入 storage + click 抑制
    triggerEl.addEventListener('pointerup', (e) => {
      if (!dragState) return;
      triggerEl.releasePointerCapture(e.pointerId);
      if (didDrag) {
        // 拖动结束 → 写入持久化
        const anchorY = parseFloat(triggerEl.style.top) || 0;
        schedulePersist(anchorY);
        // 拖动后这次 pointerup 不能被 click 误触
        suppressNextClick(triggerEl);
      }
      dragState = null;
      // 延迟清除 flag(让本次 click 的 suppression 先注册)
      setTimeout(() => { window[DRAG_FLAG] = false; }, 50);
    });
  }

  // 联动核心: 锚点 Y → 所有 ring top
  function applyStackPosition(anchorY) {
    for (const ring of window.__tabboardRings) {
      const top = anchorY + ring.index * SPACING;
      ring.trigger.style.top = `${top}px`;
      ring.trigger.style.transform = 'translateY(-50%)';  // 保持垂直居中
      if (ring.panel) {
        ring.panel.style.top = `${top}px`;
        ring.panel.style.transform = 'translate(-56px, -50%)';  // panel 滑出状态
      }
    }
  }

  // 初始化位置: 已持久化则用持久值, 否则用默认 50%
  function initPositionFromStorage(trigger, panel, ringIndex) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const savedY = result[STORAGE_KEY];
      if (typeof savedY === 'number') {
        // 持久化后用绝对 top, 不用 transform translateY(-50%) 居中
        const top = savedY + ringIndex * SPACING;
        trigger.style.top = `${top}px`;
        if (panel) panel.style.top = `${top}px`;
        trigger.dataset.dragInitialized = '1';
      }
      // 未持久化 → 保持默认 :host { top: 50% } 居中
    });
  }

  // 防抖写入 storage(避免拖动 1 秒触发几百次 set)
  let persistTimer = null;
  function schedulePersist(anchorY) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      chrome.storage.local.set({ [STORAGE_KEY]: anchorY });
    }, 300);
  }

  // 拖动后 click 抑制(pointerup 紧跟 click, 否则会误触面板)
  function suppressNextClick(el) {
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
      el.removeEventListener('click', swallow, true);
    };
    el.addEventListener('click', swallow, true);  // capture 阶段
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function getCurrentTopPx(el) {
    // 从 computed style 读 top(px), 处理 50% 这种百分比需要算像素
    const computed = window.getComputedStyle(el).top;
    if (computed.endsWith('px')) return parseFloat(computed);
    // 50% → innerHeight / 2
    return window.innerHeight / 2;
  }
})();
```

## 在每个 ring content script 中启用

只需在 build 末尾 appendChild 之后加一行:

```javascript
// content/lcSidebar.js (ringIndex: 0)
document.body.appendChild(wrapper);
window.__tabboardRingDrag?.attach(
  shadow.querySelector('#' + WRAPPER_ID + '-trigger'),
  shadow.querySelector('#' + WRAPPER_ID + '-panel'),
  { ringIndex: 0 }
);

// content/vpSidebar.js (ringIndex: 1)
window.__tabboardRingDrag?.attach(trigger, panel, { ringIndex: 1 });

// content/timerSidebar.js (ringIndex: 2)
window.__tabboardRingDrag?.attach(trigger, panel, { ringIndex: 2 });
```

`?.` 是因为 `draggable-ring.js` 可能因为加载顺序偶尔未就绪(理论上不会,但防御性写法)。

## 关键算法

### 联动位置计算
```
newAnchorY = clamp(startTop + dy, 20, innerHeight - 60)
ring.top = newAnchorY + ring.index * 52
ring.panel.top = 同上(保持对齐)
```

### 与 hover-reveal 兼容
- hover-reveal 在 `window[DRAG_FLAG] = true` 期间被屏蔽(每个 ring content script 在 mousemove handler 里跳过)
- 松手后延迟 50ms 清除 flag(让 click suppression 先注册)
- 或者更简单:drag 时给 `body` 加 `dragging` class, hover-reveal CSS 检查 `body:not(.dragging)`

### Shadow DOM 内 setPointerCapture
`triggerEl.setPointerCapture(e.pointerId)` 在 shadow root 内调用 works(标准支持)。**关键**:捕获后所有 pointermove/pointerup 都发到这个 trigger,即使鼠标拖出 trigger 范围也不丢事件。不需要 document 级 mousemove 监听。

### 锚点 Y 语义(避免联动错位)
- `anchorY` 必须是 **ringIndex=0(LC)的 top**,不是被拖 ring 自己的 top
- pointerdown: `anchorY = myTop - ringIndex * SPACING`(反推)
- pointermove: `newAnchorY = anchorY + dy`
- pointerup 持久化: `anchorY = myTop - ringIndex * SPACING`(同样反推)
- **不这样做**:拖 VP 时 `startTop + dy` 算成 VP 的新 top,传给 applyStackPosition 当锚点 → LC = newAnchorY,VP = newAnchorY + 52,间距对但 LC 跳到 VP 位置

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
- 三个 ring 拖动后,inline top 看起来 `39/91/143`(差 52),但实际 rectTop 差 530px(因为两个在不同坐标系)
- 拖动代码所有 `top` 都按"相对视口"算,哪个 ring host 有 transform 哪个就失效

**所有 ring 的 host CSS 必须字节级一致**(用同一个模板,不要各自复制粘贴)。详见 `shadow-dom-isolation.md` 坑 7。

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 没 `setPointerCapture`,鼠标拖出 trigger 后丢事件 | 拖动中断,圆环卡住 | pointerdown 立即 capture |
| `mousemove` 直接 `style.top = ...`(每帧多次) | 卡顿,掉帧 | `requestAnimationFrame` 节流 |
| 拖动中没屏蔽 hover-reveal | 鼠标靠近右边缘时圆环突然"贴回去",抖动 | 拖动期间 `window[DRAG_FLAG]=true` 或 `body.dragging`, hover-reveal 检查 |
| 拖动结束立即 `storage.set` | 拖 1 秒触发几百次写 | `schedulePersist` 防抖 300ms |
| 没裁剪边界 | 圆环拖出视口顶部/底部 | `clamp(y, 20, innerHeight - 60)` |
| 边界没留呼吸 | 圆环贴边完全切掉 | EDGE_TOP=20 / EDGE_BOTTOM=60 |
| 拖动后没 suppress click | 拖完立刻 click 触发面板展开(误触) | `suppressNextClick` 用 capture 阶段捕获并 stopPropagation |
| **拖动时用"被拖 ring 的 top" 当锚点 Y** | 拖 VP/Timer 时, LC/其他 ring 跳到错的位置(锚点概念搞反) | pointerdown 时记录 `anchorY = myTop - ringIndex * SPACING`(把被拖 ring 的 top 反推成 LC 的 top); 拖动 `newAnchorY = anchorY + dy`; 持久化也用同样的反推公式 |
| **pointerup 持久化 anchorY 用了被拖 ring 的 top** | 写入的 Y 是被拖 ring 的, 二次加载时所有 ring 错位 | 持久化时用 `myTop - ringIndex * SPACING` 还原为锚点 Y |
| **多 ring host CSS 不一致**(一个有 `transform`, 其他没有) | 拖动后 inline top 看着差 52(对), 但 rectTop 差 530px(混坐标系) | 所有 ring 用同一份 `:host` 模板, 字节级一致, 严禁 host 加 `transform` |
| 多 ring 各自存 Y | 拖一个其他不跟,违背"整体联动" | 全局存一个锚点 Y, ring.top = anchorY + index*52 |
| 持久化 `top: 50%`(百分比) | 二次加载位置不准(分辨率变) | 持久化像素值, 改用 `top: ${y}px` |
| `attach` 没去重 | 同一 trigger 绑多次 listener, 拖动一次触发多次更新 | 检查 `window.__tabboardRings` 已有则 return |
| **拖动时用"被拖 ring 的 top" 当锚点 Y** | 拖 VP/Timer 时, LC/其他 ring 跳到错的位置(锚点概念搞反) | pointerdown 时记录 `anchorY = myTop - ringIndex * SPACING`(把被拖 ring 的 top 反推成 LC 的 top); 拖动 `newAnchorY = anchorY + dy`; 持久化也用同样的反推公式 |

## 检查清单

- [ ] manifest.json `draggable-ring.js` 排在所有 ring 之前(content_scripts 数组顺序)
- [ ] 每个 ring content script 在 `body.appendChild(wrapper)` **之后**调 `attach`(否则 host 还没挂载,pointer 事件不通)
- [ ] trigger 内 `pointerdown` 立即 `setPointerCapture`
- [ ] pointermove 用 `requestAnimationFrame` 节流,**不用**直接同步写 style
- [ ] 拖动阈值 5px(避免 click 误触)
- [ ] 边界裁剪 `clamp(y, 20, innerHeight - 60)`
- [ ] 拖动期间屏蔽 hover-reveal(`window[DRAG_FLAG]` 或 `body.dragging`)
- [ ] 松手后 `suppressNextClick` 阻止误触
- [ ] 持久化用 `schedulePersist` 防抖 300ms
- [ ] 持久化值是**绝对像素 Y**(`top: ${y}px`),不是百分比
- [ ] 多 ring 联动存**一个**锚点 Y(`ringStackOffsetY`),不是每个 ring 独立存
- [ ] `attach` 检查去重(同 trigger 不重复绑)
- [ ] ringIndex 必填(无默认值,必须显式传)
- [ ] Shadow DOM 内 `triggerEl.style.top = ...` 直接写可生效(行内样式)
