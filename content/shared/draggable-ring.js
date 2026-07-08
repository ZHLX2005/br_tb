/**
 * Draggable Ring — 多圆环整体拖动 + 位置记忆
 * 暴露 window.__tabboardRingDrag.attach(trigger, panel, { defaultOrder })
 * 通过 window.__tabboardRings 数组联动：拖任一圆环 → 所有圆环整体移动(保持 52px 间距)
 *
 * 配套文档: .claude/skills/injected-dom-toggle-pattern/references/draggable-ring.md
 *
 * 改动(配合 content/shared/ring-order.js):
 *   - 入参 ringIndex 改名 defaultOrder(语义更准:是 manifest 注册顺序,不是当前顺序)
 *   - applyStackPosition / initPositionFromStorage 改用 __tabboardRingOrder.getCurrentOrder(ringId)
 *     来获取每个 ring 的**当前** order(关闭其他 ring 后顺序会重排)
 *   - 通过 ringId 标识 ring(从入参传入,无 ringId 时用入参的 defaultOrder 匹配注册表)
 */
(function () {
  'use strict';

  const SPACING = 52;        // ring 之间垂直间距(px, 与 cookbook 一致)
  const DRAG_THRESHOLD = 5;  // pointermove 距离超过此值才进入拖动模式(避免与 click 冲突)
  const EDGE_TOP = 20;       // 拖动上边界
  const EDGE_BOTTOM = 60;    // 拖动下边界(给圆环底部留呼吸空间)
  const STORAGE_KEY = 'ringStackOffsetY';
  const DRAG_FLAG = '__tabboardRingDragging';

  // 共享状态
  window.__tabboardRings = window.__tabboardRings || [];
  window.__tabboardRingDrag = window.__tabboardRingDrag || { attach };

  function attach(triggerEl, panelEl, opts = {}) {
    const defaultOrder = opts.defaultOrder;
    const ringId = opts.ringId || null; // 可选;若提供则用 ringId 查当前 order,更准
    if (defaultOrder == null) {
      console.warn('[draggable-ring] defaultOrder required');
      return;
    }

    // 同一 ring 重复 attach 防呆
    if (window.__tabboardRings.some(r => r.trigger === triggerEl)) return;

    // 入栈;ringId 在后续 recompute 时用,目前先保存 defaultOrder 作为 fallback
    const ringEntry = { trigger: triggerEl, panel: panelEl, defaultOrder, ringId };
    window.__tabboardRings.push(ringEntry);

    // 初始化位置：从 storage 读取已保存的 Y(以 defaultOrder=0 为锚点)
    initPositionFromStorage(ringEntry);

    // 拖动状态(per-trigger, 闭包)
    let dragState = null;
    let didDrag = false;
    let scheduledFrame = null;

    triggerEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;  // 仅左键
      try { triggerEl.setPointerCapture(e.pointerId); } catch (_) {}
      // 记录的是"锚点(LC) ring 的 top":当前 LC 的 top = 锚点;被拖 ring 的 top = 锚点 + N * 52
      // 但被拖 ring 不一定是 LC。简化:用被拖 ring 的当前 inline top 减去它的当前 order * 52 = 锚点 top
      const myTop = getCurrentTopPx(triggerEl);
      const myOrder = getRingOrder(ringEntry);
      const anchorY = myTop - myOrder * SPACING;
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        anchorY
      };
      didDrag = false;
    });

    triggerEl.addEventListener('pointermove', (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!didDrag && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      if (!didDrag) {
        didDrag = true;
        window[DRAG_FLAG] = true;
      }

      const newAnchorY = clamp(
        dragState.anchorY + dy,
        EDGE_TOP,
        window.innerHeight - EDGE_BOTTOM
      );

      if (scheduledFrame) return;
      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = null;
        applyStackPosition(newAnchorY);
      });
    });

    triggerEl.addEventListener('pointerup', (e) => {
      if (!dragState) return;
      try { triggerEl.releasePointerCapture(e.pointerId); } catch (_) {}
      if (didDrag) {
        const myTop = parseFloat(triggerEl.style.top) || 0;
        const myOrder = getRingOrder(ringEntry);
        const anchorY = myTop - myOrder * SPACING;
        schedulePersist(anchorY);
        suppressNextClick(triggerEl);
      }
      dragState = null;
      setTimeout(() => { window[DRAG_FLAG] = false; }, 50);
    });
  }

  // 查询某 ring 的当前 order;优先用 ringId 查注册表(准确,反映重排后的位置);
  // fallback 到 defaultOrder(在 ring-order.js 还没注册时,例如初始化竞态)
  function getRingOrder(ringEntry) {
    if (ringEntry.ringId && window.__tabboardRingOrder && typeof window.__tabboardRingOrder.getCurrentOrder === 'function') {
      const n = window.__tabboardRingOrder.getCurrentOrder(ringEntry.ringId);
      if (n >= 0) return n;
    }
    return ringEntry.defaultOrder;
  }

  // 联动核心：锚点 Y → 所有 ring top
  // 用每个 ring 的**当前** order(可能因 ring-order 重排而变化),保证 ring 栈始终紧密
  function applyStackPosition(anchorY) {
    for (const ring of window.__tabboardRings) {
      const order = getRingOrder(ring);
      const top = anchorY + order * SPACING;
      ring.trigger.style.top = `${top}px`;
      ring.trigger.style.transform = 'translateY(-50%)';
      if (ring.panel) {
        ring.panel.style.top = `${top}px`;
        // panel 默认 transform 是 translate(10px, -50%)(hidden), 展开态是 translate(-56px, -50%)
        // 拖动期间不强制改 transform, 让 panel 自身的展开/隐藏 transition 继续
      }
    }
  }

  // 初始化位置：已持久化则用持久值(绝对像素),按当前 order 偏移;否则不动
  function initPositionFromStorage(ringEntry) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const savedY = result[STORAGE_KEY];
      if (typeof savedY === 'number') {
        // 用当前 order(不是 defaultOrder)算偏移,这样关闭/重排后位置仍正确
        const order = getRingOrder(ringEntry);
        const top = savedY + order * SPACING;
        ringEntry.trigger.style.top = `${top}px`;
        if (ringEntry.panel) ringEntry.panel.style.top = `${top}px`;
        ringEntry.trigger.dataset.dragInitialized = '1';
      }
    });
  }

  // 防抖写入 storage
  let persistTimer = null;
  function schedulePersist(anchorY) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      chrome.storage.local.set({ [STORAGE_KEY]: anchorY });
    }, 300);
  }

  // 拖动后 click 抑制
  function suppressNextClick(el) {
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
      el.removeEventListener('click', swallow, true);
    };
    el.addEventListener('click', swallow, true);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function getCurrentTopPx(el) {
    const inline = el.style.top;
    if (inline && inline.endsWith('px')) return parseFloat(inline);
    const computed = window.getComputedStyle(el).top;
    if (computed && computed.endsWith('px')) return parseFloat(computed);
    return window.innerHeight / 2;
  }
})();
