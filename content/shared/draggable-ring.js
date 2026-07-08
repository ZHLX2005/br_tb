/**
 * Draggable Ring — 多圆环整体拖动 + 位置记忆
 * 暴露 window.__tabboardRingDrag.attach(trigger, panel, host, { defaultOrder, ringId })
 * 通过 window.__tabboardRings 数组联动：拖任一圆环 → 所有圆环整体移动(保持 52px 间距)
 *
 * 关键设计(配合 content/shared/ring-order.js 统一 CSS 变量系统):
 *   - drag 不再写 trigger/panel 的 inline style.top
 *   - drag 写 host 元素的 CSS 变量 --ring-stack-anchor(锚点 Y,px 值)
 *   - 各 ring 的 trigger/panel CSS 用:
 *       top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0))
 *     一个 calc() 同时消费锚点 + 序号,关闭其他 ring 后序号变化时位置自动重算
 *   - applyStackPosition 按每个 ring 的**当前** order 派发,保证 ring 栈始终紧密
 *   - __tabboardRings 按 host.isConnected 过滤死 entry
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

  function attach(triggerEl, panelEl, hostEl, opts = {}) {
    const defaultOrder = opts.defaultOrder;
    const ringId = opts.ringId || null;
    if (defaultOrder == null) {
      console.warn('[draggable-ring] defaultOrder required');
      return;
    }
    if (!hostEl) {
      // 兜底:从 triggerEl 向上找最近的 shadow host
      // shadow root 内的元素 .getRootNode() 返回 shadowRoot,.host 才是主文档节点
      const root = triggerEl && triggerEl.getRootNode && triggerEl.getRootNode();
      hostEl = (root && root.host) || triggerEl;
    }

    // 清理同一 trigger 的旧 entry(理论上不会发生,但防呆)
    window.__tabboardRings = window.__tabboardRings.filter(function (r) { return r.trigger !== triggerEl; });

    const ringEntry = { trigger: triggerEl, panel: panelEl, host: hostEl, defaultOrder, ringId };
    window.__tabboardRings.push(ringEntry);

    // 初始化位置:从 storage 读取已保存的 Y,写 --ring-stack-anchor 到 host
    initPositionFromStorage(ringEntry);

    // 拖动状态(per-trigger, 闭包)
    let dragState = null;
    let didDrag = false;
    let scheduledFrame = null;

    triggerEl.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;  // 仅左键
      try { triggerEl.setPointerCapture(e.pointerId); } catch (_) {}
      // 锚点 Y = 当前锚点(CSS 变量;未设时回退到 50% 即 innerHeight/2)
      const anchorY = getCurrentAnchorY(hostEl);
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        anchorY: anchorY
      };
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

      const newAnchorY = clamp(
        dragState.anchorY + dy,
        EDGE_TOP,
        window.innerHeight - EDGE_BOTTOM
      );

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
        const anchorY = getCurrentAnchorY(hostEl);
        schedulePersist(anchorY);
        suppressNextClick(triggerEl);
      }
      dragState = null;
      setTimeout(function () { window[DRAG_FLAG] = false; }, 50);
    });
  }

  // 查询某 ring 的当前 order;优先用 ringId 查注册表,fallback 到 defaultOrder
  function getRingOrder(ringEntry) {
    if (ringEntry.ringId && window.__tabboardRingOrder && typeof window.__tabboardRingOrder.getCurrentOrder === 'function') {
      const n = window.__tabboardRingOrder.getCurrentOrder(ringEntry.ringId);
      if (n >= 0) return n;
    }
    return ringEntry.defaultOrder;
  }

  // 联动核心:锚点 Y → 所有 host 的 --ring-stack-anchor
  // 过滤掉死 host(已被 remove)
  // CSS calc 会在 trigger/panel 渲染时自动算出正确位置
  function applyStackPosition(anchorY) {
    // 过滤死 host
    window.__tabboardRings = window.__tabboardRings.filter(function (r) {
      return r.host && r.host.isConnected;
    });
    for (var i = 0; i < window.__tabboardRings.length; i++) {
      const ring = window.__tabboardRings[i];
      ring.host.style.setProperty('--ring-stack-anchor', anchorY + 'px');
    }
  }

  // 初始化位置:已持久化则写 --ring-stack-anchor;否则不动(默认 50%)
  function initPositionFromStorage(ringEntry) {
    chrome.storage.local.get([STORAGE_KEY], function (result) {
      if (!ringEntry.host || !ringEntry.host.isConnected) return; // 已被移除
      const savedY = result[STORAGE_KEY];
      if (typeof savedY === 'number') {
        ringEntry.host.style.setProperty('--ring-stack-anchor', savedY + 'px');
        ringEntry.host.dataset.dragInitialized = '1';
      }
    });
  }

  // 防抖写入 storage
  let persistTimer = null;
  function schedulePersist(anchorY) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      chrome.storage.local.set({ [STORAGE_KEY]: anchorY });
    }, 300);
  }

  // 拖动后 click 抑制
  function suppressNextClick(el) {
    const swallow = function (e) {
      e.stopPropagation();
      e.preventDefault();
      el.removeEventListener('click', swallow, true);
    };
    el.addEventListener('click', swallow, true);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // 读取 host 的当前锚点 Y(优先 inline CSS 变量;fallback 到 50% of innerHeight)
  function getCurrentAnchorY(hostEl) {
    const inline = hostEl.style.getPropertyValue('--ring-stack-anchor');
    if (inline && inline.endsWith('px')) {
      const n = parseFloat(inline);
      if (!isNaN(n)) return n;
    }
    return window.innerHeight / 2;
  }
})();
