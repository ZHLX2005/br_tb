/**
 * SpeedRing - 视频倍速控制环
 * 悬浮右侧，hover 近场浮现，点击展开面板。
 * 读取/写入 chrome.storage.local['tabboard_global_video_speed']，
 * 通过 window.postMessage 通知同一页面内的 videoSpeed.js 立即应用。
 * Shadow DOM 隔离宿主 CSS。
 */
(function () {
  'use strict';

  const WRAPPER_ID = 'tabboard-speed-sidebar';
  const ACCENT = '#42a5f5'; // 蓝色，与其他环一致

  const STORAGE_KEY = 'tabboard_global_video_speed';

  const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // ---------- CSS ----------

  const STYLES = `
    :host {
      position: fixed; top: 50%; right: 0;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --accent: ${ACCENT};
    }
    #${WRAPPER_ID}-trigger {
      width: 40px; height: 40px; border-radius: 50%; background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      position: fixed; top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0)); right: -16px;
      transform: translateY(-50%); opacity: 0; pointer-events: none;
      transition: right 220ms ease, opacity 180ms ease, box-shadow 200ms;
      border: 1px solid rgba(0,0,0,0.06);
    }
    :host(.near) #${WRAPPER_ID}-trigger,
    #${WRAPPER_ID}-trigger:hover {
      right: 8px; opacity: 1; pointer-events: auto;
    }
    #${WRAPPER_ID}-trigger:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.22); }

    #${WRAPPER_ID}-panel {
      position: fixed; top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0)); right: 8px;
      transform: translate(10px, -50%); width: 240px;
      background: white; border-radius: 10px;
      box-shadow: -2px 4px 20px rgba(0,0,0,0.18);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s linear 240ms;
    }
    :host(.expanded) #${WRAPPER_ID}-panel {
      opacity: 1; visibility: visible; pointer-events: auto;
      transform: translate(-56px, -50%);
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s;
    }

    /* ---- 面板内部样式（shadow 内类名天然隔离） ---- */
    #${WRAPPER_ID}-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 14px 8px; border-bottom: 1px solid #f0f0f0;
    }
    #${WRAPPER_ID}-title {
      font-size: 14px; font-weight: 600; color: #333;
    }
    .sp-close-btn {
      width: 24px; height: 24px; border: none; background: transparent;
      font-size: 16px; cursor: pointer; color: #999; border-radius: 4px;
    }
    .sp-close-btn:hover { background: #f5f5f5; color: #333; }

    #${WRAPPER_ID}-body {
      padding: 12px 14px;
    }

    .sp-current {
      text-align: center; margin-bottom: 8px;
    }
    .sp-current-value {
      font-size: 32px; font-weight: 700;
      color: ${ACCENT}; font-variant-numeric: tabular-nums;
    }
    .sp-current-label {
      font-size: 12px; color: #999; margin-top: 2px;
    }

    .sp-presets {
      display: flex; gap: 4px; flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .sp-preset-btn {
      flex: 1; min-width: 40px; padding: 6px 0;
      font-size: 12px; font-weight: 600; border: 1px solid #e0e0e0;
      border-radius: 6px; background: white; color: #555; cursor: pointer;
      transition: all 0.15s;
    }
    .sp-preset-btn:hover { border-color: ${ACCENT}; color: ${ACCENT}; }
    .sp-preset-btn.active {
      background: ${ACCENT}; border-color: ${ACCENT}; color: white;
    }

    .sp-slider-container {
      margin-top: 8px;
    }
    .sp-slider-container label {
      display: block; font-size: 11px; color: #999; margin-bottom: 4px;
    }
    .sp-slider {
      width: 100%; -webkit-appearance: none; appearance: none;
      height: 6px; border-radius: 3px; background: #e0e0e0; outline: none;
    }
    .sp-slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 18px; height: 18px; border-radius: 50%;
      background: ${ACCENT}; cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    }

    .sp-toggle-row {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 10px; padding-top: 10px; border-top: 1px solid #f0f0f0;
    }
    .sp-toggle-row span { font-size: 12px; color: #666; }
    .sp-toggle {
      position: relative; width: 36px; height: 20px; flex-shrink: 0;
      -webkit-appearance: none; appearance: none; background: #ccc;
      border-radius: 10px; cursor: pointer; transition: background 0.2s; outline: none;
    }
    .sp-toggle::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 16px; height: 16px; background: white; border-radius: 50%;
      transition: transform 0.2s;
    }
    .sp-toggle:checked { background: ${ACCENT}; }
    .sp-toggle:checked::after { transform: translateX(16px); }
  `;

  // ---------- 状态 ----------

  let currentSpeed = 1;
  let speedEnabled = true;

  // ---------- 工具函数 ----------

  function clampSpeed(v) {
    return Math.min(4, Math.max(0.25, v));
  }

  function quantizeSpeed(v) {
    return Math.round(clampSpeed(v) * 4) / 4;
  }

  /** 对同页面所有 <video> 应用 speed（通过 postMessage 通知 videoSpeed.js） */
  function applySpeedToPage(speed) {
    // videoSpeed.js 监听 postMessage，收到后写入 storage + 应用到所有 <video>
    window.postMessage({ type: 'TABBOARD_SET_VIDEO_SPEED', speed: speed }, '*');
  }

  function loadSpeed(callback) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      currentSpeed = result[STORAGE_KEY] ?? 1;
      if (callback) callback(currentSpeed);
    });
  }

  // ---------- 面板 UI 同步 ----------

  function syncPanelUI() {
    const wrapper = document.getElementById(WRAPPER_ID);
    if (!wrapper || !wrapper.shadowRoot) return;
    const root = wrapper.shadowRoot;

    // current display
    const valueEl = root.getElementById('sp-current-value');
    if (valueEl) valueEl.textContent = currentSpeed + 'x';

    // presets
    root.querySelectorAll('.sp-preset-btn').forEach(btn => {
      const preset = parseFloat(btn.dataset.speed);
      btn.classList.toggle('active', Math.abs(preset - currentSpeed) < 0.01);
    });

    // slider
    const slider = root.getElementById('sp-slider');
    if (slider) slider.value = currentSpeed;

    // toggle
    const toggle = root.getElementById('sp-speed-toggle');
    if (toggle) toggle.checked = speedEnabled;
  }

  // ---------- 构建 DOM ----------

  function build() {
    if (document.getElementById(WRAPPER_ID)) return;

    const wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    const shadow = wrapper.attachShadow({ mode: 'open' });

    // style
    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    // trigger
    const trigger = document.createElement('div');
    trigger.id = WRAPPER_ID + '-trigger';
    trigger.title = '倍速控制';
    trigger.innerHTML = `<span style="font-size:14px;font-weight:700;color:${ACCENT}">×</span>`;
    shadow.appendChild(trigger);
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      const wasExpanded = wrapper.classList.contains('expanded');
      wrapper.classList.toggle('expanded');
      if (!wasExpanded) {
        // 展开时刷新当前速度
        loadSpeed(function () {
          syncPanelUI();
        });
      }
    });

    // 共享近场浮现
    if (!window.__tabboardSideReveal) {
      window.__tabboardSideReveal = true;
      document.addEventListener('mousemove', function (e) {
        if (window.__tabboardRingDragging) return;
        var near = e.clientX > window.innerWidth - 40;
        document.body.classList.toggle('tabboard-side-near', near);
        document.querySelectorAll('[id$="-sidebar"]:not([id$="-panel"]):not([id$="-trigger"])').forEach(function (host) {
          host.classList.toggle('near', near);
        });
      });
    }

    // panel
    const panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';
    panel.innerHTML = `
      <div id="${WRAPPER_ID}-header">
        <div id="${WRAPPER_ID}-title">倍速控制</div>
        <button class="sp-close-btn" data-sp-close title="收起">×</button>
      </div>
      <div id="${WRAPPER_ID}-body">
        <div class="sp-current">
          <div class="sp-current-value" id="sp-current-value">1x</div>
          <div class="sp-current-label">当前倍速</div>
        </div>

        <div class="sp-presets">
          ${PRESETS.map(v => `<button class="sp-preset-btn" data-speed="${v}">${v}x</button>`).join('')}
        </div>

        <div class="sp-slider-container">
          <label>微调${'  '}<span id="sp-slider-label">${currentSpeed}x</span></label>
          <input type="range" class="sp-slider" id="sp-slider"
                 min="0.25" max="4" step="0.25" value="${currentSpeed}">
        </div>

        <div class="sp-toggle-row">
          <span>倍速开关</span>
          <input type="checkbox" class="sp-toggle" id="sp-speed-toggle"${speedEnabled ? ' checked' : ''}>
        </div>
      </div>
    `;
    shadow.appendChild(panel);

    // 点击外部收起
    const onDocClick = function (e) {
      if (!wrapper.classList.contains('expanded')) return;
      if (wrapper.contains(e.target)) return;
      wrapper.classList.remove('expanded');
    };
    setTimeout(function () { document.addEventListener('click', onDocClick); }, 0);

    // 关闭按钮
    var closeBtn = shadow.querySelector('[data-sp-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        wrapper.classList.remove('expanded');
      });
    }

    // 预设按钮
    shadow.querySelectorAll('.sp-preset-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const speed = parseFloat(btn.dataset.speed);
        currentSpeed = speed;
        if (speedEnabled) applySpeedToPage(speed);
        syncPanelUI();
      });
    });

    // 滑块
    var slider = shadow.getElementById('sp-slider');
    if (slider) {
      slider.addEventListener('input', function (e) {
        e.stopPropagation();
        var speed = parseFloat(e.target.value);
        // live preview: 拖拽时实时更新显示但不保存(减少存储 write)
        var valEl = shadow.getElementById('sp-current-value');
        if (valEl) valEl.textContent = speed + 'x';
        var lblEl = shadow.getElementById('sp-slider-label');
        if (lblEl) lblEl.textContent = speed + 'x';
      });
      slider.addEventListener('change', function (e) {
        e.stopPropagation();
        const speed = parseFloat(e.target.value);
        currentSpeed = quantizeSpeed(speed);
        shadow.getElementById('sp-slider').value = currentSpeed;
        if (speedEnabled) applySpeedToPage(currentSpeed);
        syncPanelUI();
      });
    }

    // 启用/禁用切换
    var toggle = shadow.getElementById('sp-speed-toggle');
    if (toggle) {
      toggle.addEventListener('change', function (e) {
        e.stopPropagation();
        speedEnabled = toggle.checked;
        if (speedEnabled) {
          applySpeedToPage(currentSpeed);
        } else {
          // 关闭倍速 → 恢复 1x
          applySpeedToPage(1);
        }
        syncPanelUI();
      });
    }

    document.body.appendChild(wrapper);

    // 注册拖动
    window.__tabboardRingDrag && window.__tabboardRingDrag.attach(
      shadow.getElementById(WRAPPER_ID + '-trigger'),
      shadow.getElementById(WRAPPER_ID + '-panel'),
      wrapper,
      { defaultOrder: 4, ringId: 'speed' }
    );

    // 注册到 ring-order 协调器
    window.__tabboardRingOrder && window.__tabboardRingOrder.register({
      ringId: 'speed',
      host: wrapper,
      defaultOrder: 4,
      isAlive: function () {
        if (!document.getElementById(WRAPPER_ID)) return false;
        var s = window.__tabboardRingOrder.getLastSettings();
        if (!s) return true;
        return s.ringSidebarEnabled !== false && s.showSpeedRing !== false;
      }
    });
  }

  function shouldHide(s) {
    return s.ringSidebarEnabled === false || s.showSpeedRing === false;
  }

  function init() {
    try {
      chrome.runtime.sendMessage({ action: 'getSettings' }, function (res) {
        var s = res && res.success ? (res.settings || {}) : {};
        if (shouldHide(s)) return;
        // 加载当前速度
        loadSpeed(function () {
          build();
          syncPanelUI();
        });
      });
    } catch (err) { /* 扩展上下文可能失效 */ }
  }

  // 监听设置变化
  chrome.storage.onChanged.addListener(function (changes, ns) {
    if (ns !== 'local') return;

    // 速度值变了(其他页面修改了)
    if (changes[STORAGE_KEY]) {
      currentSpeed = changes[STORAGE_KEY].newValue ?? 1;
      syncPanelUI();
    }

    // 开关变了
    if (changes.settings) {
      var s = changes.settings.newValue || {};
      var el = document.getElementById(WRAPPER_ID);
      if (shouldHide(s)) {
        if (el) el.remove();
      } else if (!el) {
        init();
      }
      // 同步 enabled 状态(如果 settings 中有 speedEnabled 字段)
      if (s.speedEnabled !== undefined) {
        speedEnabled = s.speedEnabled !== false;
        syncPanelUI();
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
