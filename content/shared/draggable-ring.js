/**
 * Draggable Ring — 多圆环整体拖动 + 位置记忆
 * 暴露 window.__tabboardRingDrag.attach(trigger, panel, { ringIndex })
 * 通过 window.__tabboardRings 数组联动：拖任一圆环 → 所有圆环整体移动(保持 52px 间距)
 *
 * 配套文档: .claude/skills/injected-dom-toggle-pattern/references/draggable-ring.md
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
    const ringIndex = opts.ringIndex;
    if (ringIndex == null) {
      console.warn('[draggable-ring] ringIndex required');
      return;
    }

    // 同一 ring 重复 attach 防呆
    if (window.__tabboardRings.some(r => r.trigger === triggerEl)) return;

    window.__tabboardRings.push({ trigger: triggerEl, panel: panelEl, index: ringIndex });

    // 初始化位置：从 storage 读取已保存的 Y(以 ringIndex=0 为锚点)
    initPositionFromStorage(triggerEl, panelEl, ringIndex);

    // 拖动状态(per-trigger, 闭包)
    let dragState = null;
    let didDrag = false;
    let scheduledFrame = null;

    triggerEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;  // 仅左键
      try { triggerEl.setPointerCapture(e.pointerId); } catch (_) {}
      // 【修复】记录的不是被拖 ring 的 top，而是整个 ring 栈的锚点 Y（ringIndex=0 的 top）
      // 这样拖 VP/Timer 时, dy 偏移应用到锚点, 三个 ring 的相对间距保持不变
      const myTop = getCurrentTopPx(triggerEl);
      const anchorY = myTop - ringIndex * SPACING;
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        anchorY       // 拖动起点时, 锚点(LC)的 top
      };
      didDrag = false;
    });

    triggerEl.addEventListener('pointermove', (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!didDrag && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      if (!didDrag) {
        // 首次进入拖动：屏蔽 hover-reveal
        didDrag = true;
        window[DRAG_FLAG] = true;
      }

      // 计算锚点 ring(ringIndex=0) 的新 topY
      // dragState.anchorY 是拖动起点时 LC 的 top, dy 是鼠标垂直偏移
      const newAnchorY = clamp(
        dragState.anchorY + dy,
        EDGE_TOP,
        window.innerHeight - EDGE_BOTTOM
      );

      // RAF 节流更新所有 ring 位置(保持间距)
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
        // 【修复】被拖 ring 的 top - 它在栈中的偏移 = 锚点(LC)的 top
        const myTop = parseFloat(triggerEl.style.top) || 0;
        const anchorY = myTop - ringIndex * SPACING;
        schedulePersist(anchorY);
        suppressNextClick(triggerEl);
      }
      dragState = null;
      // 延迟清除 flag(让 click suppression 先注册)
      setTimeout(() => { window[DRAG_FLAG] = false; }, 50);
    });
  }

  // 联动核心：锚点 Y → 所有 ring top
  function applyStackPosition(anchorY) {
    for (const ring of window.__tabboardRings) {
      const top = anchorY + ring.index * SPACING;
      ring.trigger.style.top = `${top}px`;
      ring.trigger.style.transform = 'translateY(-50%)';
      if (ring.panel) {
        ring.panel.style.top = `${top}px`;
        // panel 默认 transform 是 translate(10px, -50%)(hidden), 展开态是 translate(-56px, -50%)
        // 拖动期间不强制改 transform, 让 panel 自身的展开/隐藏 transition 继续
      }
    }
  }

  // 初始化位置：已持久化则用持久值(绝对像素)，否则保持默认 :host { top: 50% } 居中
  function initPositionFromStorage(trigger, panel, ringIndex) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const savedY = result[STORAGE_KEY];
      if (typeof savedY === 'number') {
        const top = savedY + ringIndex * SPACING;
        trigger.style.top = `${top}px`;
        if (panel) panel.style.top = `${top}px`;
        trigger.dataset.dragInitialized = '1';
      }
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
    // 优先读 inline style.top(像素)；否则读 computed(可能为百分比)
    const inline = el.style.top;
    if (inline && inline.endsWith('px')) return parseFloat(inline);
    const computed = window.getComputedStyle(el).top;
    if (computed && computed.endsWith('px')) return parseFloat(computed);
    // 默认 :host { top: 50% } 时, 圆环中心在视口中部
    return window.innerHeight / 2;
  }
})();
