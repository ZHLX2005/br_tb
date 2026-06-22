/**
 * VP Sidebar — 视频进度开关圆环
 * 悬浮在右侧边缘（LC 圆环下方），hover 近场浮现，点击展开两个开关：
 *   - 显示进度条        → settings.showCourseProgressBar
 *   - 无关网页也显示    → settings.showCourseProgressBarOnUnrelatedTabs
 * 这两个开关控制 content/courseProgressBar.js 注入到页面顶部的进度条。
 * 圆环本身总是显示（不受开关影响），开关只控制进度条。
 */

(function () {
  'use strict';

  const WRAPPER_ID = 'tabboard-vp-sidebar';
  const ACCENT = '#42a5f5';

  const STYLES = `
    #${WRAPPER_ID}-trigger {
      width: 40px; height: 40px; border-radius: 50%; background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      position: fixed; top: calc(50% + 52px); right: -16px;
      transform: translateY(-50%); opacity: 0; pointer-events: none;
      transition: right 220ms ease, opacity 180ms ease, box-shadow 200ms;
      border: 1px solid rgba(0,0,0,0.06);
    }
    /* 鼠标靠近右侧边缘（host 加 .near）或悬浮圆环本身时滑出 */
    :host(.near) #${WRAPPER_ID}-trigger,
    #${WRAPPER_ID}-trigger:hover {
      right: 8px; opacity: 1; pointer-events: auto;
    }
    #${WRAPPER_ID}-trigger:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.22); }
    #${WRAPPER_ID}-panel {
      position: fixed; top: calc(50% + 52px); right: 8px;
      transform: translate(10px, -50%); width: 240px;
      background: white; border-radius: 10px;
      box-shadow: -2px 4px 20px rgba(0,0,0,0.18);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s linear 240ms;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    :host(.expanded) #${WRAPPER_ID}-panel {
      opacity: 1; visibility: visible; pointer-events: auto;
      transform: translate(-56px, -50%);
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s;
    }
    #${WRAPPER_ID}-header {
      padding: 10px 12px; border-bottom: 1px solid #eee;
      display: flex; align-items: center; justify-content: space-between;
    }
    #${WRAPPER_ID}-title { font-size: 12px; font-weight: 600; color: #333; }
    .vp-close-btn {
      background: transparent; border: none; color: #999; font-size: 16px;
      line-height: 1; width: 22px; height: 22px; border-radius: 4px;
      cursor: pointer; padding: 0; transition: background 120ms, color 120ms;
    }
    .vp-close-btn:hover { background: #f0f0f0; color: #e53935; }
    #${WRAPPER_ID}-body { padding: 4px 12px; }
    .vp-switch-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 9px 0; font-size: 11px; color: #444; cursor: pointer;
    }
    .vp-switch-row + .vp-switch-row { border-top: 1px solid #f0f0f0; }
    .vp-switch {
      appearance: none; -webkit-appearance: none; width: 32px; height: 18px;
      border-radius: 9px; background: #ccc; position: relative; cursor: pointer;
      transition: background 180ms; flex-shrink: 0; margin: 0;
    }
    .vp-switch::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 14px; height: 14px; border-radius: 50%; background: white;
      transition: left 180ms; box-shadow: 0 1px 2px rgba(0,0,0,0.25);
    }
    .vp-switch:checked { background: ${ACCENT}; }
    .vp-switch:checked::after { left: 16px; }
  `;

  function build() {
    if (document.getElementById(WRAPPER_ID)) return;

    // 宿主 reset / 全局选择器无法穿透 Shadow Root，圆环在 Notion/Figma 等站点也能稳定渲染
    const wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    const shadow = wrapper.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    // 圆环 trigger
    const trigger = document.createElement('div');
    trigger.id = WRAPPER_ID + '-trigger';
    trigger.title = '视频进度';
    trigger.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20">
        <rect x="2" y="8" width="16" height="4" rx="2" fill="#e8eaf6"/>
        <rect x="2" y="8" width="10" height="4" rx="2" fill="${ACCENT}"/>
      </svg>
    `;
    shadow.appendChild(trigger);
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      wrapper.classList.toggle('expanded');
    });

    // 鼠标靠近右边缘时统一浮现：JS toggle body.tabboard-side-near，同时给所有 shadow host 加 .near
    // 幂等注册（多个 content script 都会执行这段，靠 window 标记只注册一次 mousemove）
    if (!window.__tabboardSideReveal) {
      window.__tabboardSideReveal = true;
      document.addEventListener('mousemove', (e) => {
        const near = e.clientX > window.innerWidth - 40;
        document.body.classList.toggle('tabboard-side-near', near);
        document.querySelectorAll('[id$="-sidebar"]:not([id$="-panel"]):not([id$="-trigger"])').forEach(host => {
          host.classList.toggle('near', near);
        });
      });
    }

    // 面板
    const panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';
    panel.innerHTML = `
      <div id="${WRAPPER_ID}-header">
        <div id="${WRAPPER_ID}-title">视频进度</div>
        <button class="vp-close-btn" data-vp-close title="收起">×</button>
      </div>
      <div id="${WRAPPER_ID}-body">
        <label class="vp-switch-row">
          <span>显示进度条</span>
          <input type="checkbox" class="vp-switch" data-key="showCourseProgressBar">
        </label>
        <label class="vp-switch-row">
          <span>无关网页也显示</span>
          <input type="checkbox" class="vp-switch" data-key="showCourseProgressBarOnUnrelatedTabs">
        </label>
      </div>
    `;
    shadow.appendChild(panel);

    // 开关：写回 settings（合并语义，只传改动的 key）
    panel.querySelectorAll('.vp-switch').forEach(sw => {
      sw.addEventListener('click', (e) => e.stopPropagation());
      sw.addEventListener('change', () => {
        chrome.runtime.sendMessage({
          action: 'updateSettings',
          settings: { [sw.dataset.key]: sw.checked }
        });
      });
    });

    // 收起按钮（仅收起，不持久化）
    panel.querySelector('[data-vp-close]').addEventListener('click', (e) => {
      e.stopPropagation();
      wrapper.classList.remove('expanded');
    });

    // 点击面板外部自动收起（事件已 retarget 到 host，wrapper.contains 即可）
    const onDocClick = (e) => {
      if (!wrapper.classList.contains('expanded')) return;
      if (wrapper.contains(e.target)) return;
      wrapper.classList.remove('expanded');
    };
    setTimeout(() => document.addEventListener('click', onDocClick), 0);

    document.body.appendChild(wrapper);
  }

  function syncSwitches(settings) {
    const wrapper = document.getElementById(WRAPPER_ID);
    if (!wrapper || !wrapper.shadowRoot) return;
    wrapper.shadowRoot.querySelectorAll('#' + WRAPPER_ID + '-panel .vp-switch').forEach(sw => {
      sw.checked = !!(settings && settings[sw.dataset.key]);
    });
  }

  function removeVp() {
    const w = document.getElementById(WRAPPER_ID);
    if (w) w.remove();
  }

  async function init() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
      const settings = res.success ? (res.settings || {}) : {};
      if (shouldHide(settings)) { removeVp(); return; }
      build();
      syncSwitches(settings);
    } catch (err) {
      // 扩展上下文可能失效
    }
  }

  // 显示条件：master 总开关开 + 本圆环子开关开（两者都默认开，undefined 视为开）
  function shouldHide(s) {
    return s.ringSidebarEnabled === false || s.showVpSidebar === false;
  }

  // settings 变化时：应当显示就 build、应当隐藏就移除；同时同步面板开关
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local' || !changes.settings) return;
    const s = changes.settings.newValue || {};
    const exists = !!document.getElementById(WRAPPER_ID);
    if (shouldHide(s)) {
      if (exists) removeVp();
    } else if (!exists) {
      build();
    }
    syncSwitches(s);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
