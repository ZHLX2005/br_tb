/**
 * Note Ring — 网页便签（自由悬浮 + 多便签页 + tab 绑定）
 *
 * 工作模式：
 * - 通过 background 的 getActiveTabInfo action 检测当前 tab（content script 无 chrome.tabs）
 * - 自动选择绑定了当前 URL 的页面（首个）；无绑定 → 用户手动选择/新建
 * - 也可在面板内手动切换到任意页面（不依赖当前 tab URL）
 * - 内容 CRUD 与 modules/note 模块共享同一份 storage（chrome.storage.local.notePages）
 * - 任何模块修改 notePages → onChanged 触发 → 本面板自动重渲染
 *
 * 不受 ringSidebarEnabled 控制（独立顶层入口），受 settings.showNoteRing 控制。
 *
 * 注意：所有注入类名带 nr- 前缀（避免与宿主页通用类名撞车）;
 *        dropdown（页面选择器）挂在 document.body,避开面板 overflow:hidden 裁剪。
 */

(function () {
  'use strict';

  const WRAPPER_ID = 'tabboard-note-ring';
  const ACCENT = '#1a1a1a'; // 黑白灰主题(用户明确要求去红)

  if (window.__tabboardNoteRingInjected) return;
  window.__tabboardNoteRingInjected = true;

  // ===================== 状态 =====================
  let wrapper = null;
  let panel = null;
  let isExpanded = false;
  // 所见即所得编辑器: [[URL]] 渲染为图片块;光标进入时临时显示源码
  let pages = [];
  let currentPageId = null;
  let currentTabUrl = '';
  let currentTabTitle = '';
  let currentTabFavicon = '';

  // ===================== 样式 =====================
  const STYLES = `
    /* ========== 圆环 ========== */
    #${WRAPPER_ID} {
      position: fixed;
      bottom: 100px;
      right: 100px;
      width: 48px; height: 48px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
      cursor: grab;
      user-select: none; -webkit-user-select: none;
      touch-action: none;
    }
    #${WRAPPER_ID}.dragging { cursor: grabbing; }
    #${WRAPPER_ID}-circle {
      width: 48px; height: 48px; border-radius: 50%;
      background: #1a1a1a;
      color: #fff; /* svg currentColor: 收起时白 */
      box-shadow: 0 4px 14px rgba(0,0,0,0.28);
      display: flex; align-items: center; justify-content: center;
      transition: transform 180ms ease, box-shadow 180ms, color 180ms;
      position: relative;
    }
    #${WRAPPER_ID}-circle:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
    #${WRAPPER_ID}-circle.expanded { background: #fff; color: #1a1a1a; box-shadow: 0 6px 22px rgba(0,0,0,0.3); }

    /* ========== 面板 ========== */
    #${WRAPPER_ID}-panel {
      position: fixed;
      width: 320px; height: 420px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06);
      z-index: 999998;
      display: flex; flex-direction: column;
      overflow: hidden;
      opacity: 0; visibility: hidden; pointer-events: none;
      transform: translateY(-6px) scale(0.97);
      transform-origin: bottom right;
      transition: opacity 200ms ease, transform 220ms cubic-bezier(.16,1,.3,1), visibility 0s linear 220ms;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    #${WRAPPER_ID}-panel.open {
      opacity: 1; visibility: visible; pointer-events: auto;
      transform: translateY(0) scale(1);
      transition: opacity 200ms ease, transform 220ms cubic-bezier(.16,1,.3,1), visibility 0s;
    }
    #${WRAPPER_ID}-panel.dragging {
      box-shadow: 0 12px 36px rgba(0,0,0,0.24), 0 0 0 1px rgba(0,0,0,0.12);
      cursor: grabbing !important;
    }

    /* 标题栏（页面切换器） */
    .nr-header {
      display: flex; align-items: center;
      padding: 8px 8px 8px 12px;
      border-bottom: 1px solid #e8e8e8;
      background: #fafafa;
      flex-shrink: 0;
      cursor: grab;
      user-select: none; -webkit-user-select: none;
      touch-action: none;
      gap: 4px;
    }
    .nr-header.dragging { cursor: grabbing; }
    .nr-switcher {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 6px;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      transition: background 120ms;
    }
    .nr-switcher:hover { background: #e8e8e8; }
    .nr-page-name {
      flex: 1; min-width: 0;
      font-size: 13px; font-weight: 600; color: #1a1a1a;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .nr-page-name.placeholder { color: #999; font-weight: 400; }
    .nr-switcher svg { color: #888; flex-shrink: 0; }
    .nr-header-actions { display: flex; gap: 2px; }

    .nr-icon-btn {
      width: 24px; height: 24px;
      border: none; background: transparent;
      color: #888; cursor: pointer; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      transition: background 120ms, color 120ms;
      padding: 0; flex-shrink: 0;
    }
    .nr-icon-btn:hover { background: #e8e8e8; color: #1a1a1a; }
    .nr-icon-btn-danger:hover { background: #1a1a1a; color: #fff; }

    /* 当前 tab 提示条 */
    .nr-tab-hint {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px;
      font-size: 10.5px; color: #666;
      background: #fafafa;
      border-bottom: 1px solid #e8e8e8;
      flex-shrink: 0;
    }
    .nr-tab-hint .nr-fav {
      width: 12px; height: 12px; border-radius: 2px;
      object-fit: contain;
    }
    .nr-tab-hint-text {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .nr-tab-bind-btn {
      border: 1px solid #d0d0d0;
      background: #fff; color: #1a1a1a;
      padding: 2px 6px; font-size: 10px;
      border-radius: 3px; cursor: pointer;
      flex-shrink: 0;
      transition: background 120ms;
    }
    .nr-tab-bind-btn:hover { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }

    /* 页面选择器 dropdown（body 级, fixed 定位——不能放 panel 内,panel overflow:hidden 会裁剪） */
    .nr-picker {
      position: fixed;
      width: 300px;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.16);
      max-height: 280px; overflow-y: auto;
      z-index: 1000001;
      display: none;
    }
    .nr-picker.open { display: block; }
    .nr-picker-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      border-bottom: 1px solid #f0f0f0;
      font-size: 12px;
      transition: background 120ms;
    }
    .nr-picker-item:hover { background: #f5f5f5; }
    .nr-picker-item.active { background: #f0f0f0; font-weight: 600; }
    .nr-picker-item-main { flex: 1; min-width: 0; }
    .nr-picker-item-name {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: #1a1a1a;
    }
    .nr-picker-item-meta {
      font-size: 10px; color: #999; margin-top: 2px;
      display: flex; align-items: center; gap: 4px;
    }
    .nr-picker-item-actions {
      display: flex; gap: 2px;
      opacity: 0;
      transition: opacity 120ms;
    }
    .nr-picker-item:hover .nr-picker-item-actions { opacity: 1; }
    .nr-picker-new {
      padding: 8px 12px;
      background: #fafafa;
      cursor: pointer;
      font-size: 12px;
      color: #1a1a1a;
      display: flex; align-items: center; gap: 6px;
      border-top: 1px solid #e0e0e0;
      font-weight: 500;
    }
    .nr-picker-new:hover { background: #f0f0f0; }

    /* 文章编辑区 */
    .nr-body {
      flex: 1; min-height: 0;
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .nr-empty {
      padding: 32px 12px; text-align: center;
      color: #999; font-size: 12px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 100%;
    }
    .nr-empty-icon { font-size: 28px; margin-bottom: 6px; opacity: 0.4; }
    .nr-empty-cta {
      margin-top: 10px;
      padding: 6px 14px;
      background: #1a1a1a; color: #fff;
      border: none; border-radius: 4px;
      cursor: pointer; font-size: 11px;
    }
    .nr-empty-cta:hover { background: #000; }

    /* 底部状态条 */
    .nr-status-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 4px 12px;
      border-top: 1px solid #e8e8e8;
      background: #fafafa;
      font-size: 10.5px;
      color: #888;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .nr-status-bar .saved { color: #43a047; }
    .nr-status-bar .saving { color: #888; }

    /* 图床账号配置（默认收起） */
    .nr-settings {
      border-top: 1px solid #e8e8e8;
      background: #fafafa;
      padding: 6px 10px 8px;
      display: flex; flex-direction: column; gap: 5px;
      flex-shrink: 0;
    }
    .nr-settings-title {
      font-size: 10.5px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .nr-settings-row {
      display: flex; align-items: center; gap: 6px;
    }
    .nr-settings input {
      flex: 1;
      padding: 4px 7px;
      font-size: 11px;
      border: 1px solid #d0d0d0;
      border-radius: 3px;
      outline: none;
      background: #fff;
      font-family: inherit;
      min-width: 0;
    }
    .nr-settings input:focus { border-color: #1a1a1a; }
    .nr-settings-hint {
      font-size: 10.5px;
      color: #888;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 登录状态徽章(同步 background getLoginStatus) */
    .nr-status-pill {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 10px;
      background: #f0f0f0;
      color: #888;
      cursor: pointer;
      transition: background 120ms;
      white-space: nowrap;
    }
    .nr-status-pill:hover { background: #e8e8e8; }
    .nr-status-pill.ok { background: #e8f5e9; color: #2e7d32; }
    .nr-status-pill.warn { background: #fff8e1; color: #f57c00; }
    .nr-status-pill.err { background: #ffebee; color: #c62828; }

    /* WYSIWYG 编辑器(contenteditable) */
    .nr-editor {
      flex: 1; min-height: 0;
      overflow-y: auto;
      padding: 12px 14px;
      font-size: 13px;
      line-height: 1.65;
      color: #1a1a1a;
      background: #fff;
      outline: none;
      tab-size: 2;
      scrollbar-width: thin;
      scrollbar-color: #c0c0c0 transparent;
      word-break: break-word;
    }
    .nr-editor::-webkit-scrollbar { width: 5px; }
    .nr-editor::-webkit-scrollbar-thumb { background: #c0c0c0; border-radius: 3px; }
    .nr-editor::-webkit-scrollbar-track { background: transparent; }
    .nr-editor:empty::before {
      content: attr(data-placeholder);
      color: #c0c0c0;
      pointer-events: none;
    }

    /* 图片块(contenteditable=false): 默认显示图片;光标进入时内部换为 [[URL]] 源码文本 */
    .nr-img-block {
      display: inline-block;
      vertical-align: middle;
      position: relative;
      margin: 4px 2px;
      max-width: 100%;
      border-radius: 6px;
      line-height: 0;
      transition: box-shadow 120ms;
    }
    .nr-img-block img {
      display: block;
      max-width: 100%;
      max-height: 300px;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
    }
    .nr-img-block::after {
      content: '';
      position: absolute; inset: 0;
      border: 2px solid transparent;
      border-radius: 6px;
      pointer-events: none;
      transition: border-color 120ms;
    }
    .nr-img-block.nr-img-active::after { border-color: ${ACCENT}; }
    /* 删除按钮(hover 出现) */
    .nr-img-x {
      position: absolute; top: 4px; right: 4px;
      width: 18px; height: 18px;
      border: none; background: rgba(0,0,0,0.6);
      color: #fff; border-radius: 50%;
      cursor: pointer; font-size: 12px; line-height: 1;
      display: none; align-items: center; justify-content: center;
      padding: 0;
    }
    .nr-img-block:hover .nr-img-x { display: flex; }
    .nr-img-x:hover { background: ${ACCENT}; }

    /* Toolbar 行(取代老的 head title + page name + 当前 tab info) */
    .nr-panel-toolbar {
      display: flex; align-items: center;
      padding: 4px 6px;
      border-bottom: 1px solid #e8e8e8;
      background: #fafafa;
      flex-shrink: 0;
      cursor: grab;
      user-select: none; -webkit-user-select: none;
      touch-action: none;
      gap: 4px;
      min-height: 32px;
    }
    .nr-panel-toolbar.dragging { cursor: grabbing; }
    .nr-toolbar-spacer { flex: 1; }

    /* 右下角手柄(resize) */
    .nr-resize-handle {
      position: absolute;
      right: 0; bottom: 0;
      width: 16px; height: 16px;
      cursor: nwse-resize;
      touch-action: none;
      z-index: 2;
    }
    .nr-resize-handle::after {
      content: '';
      position: absolute; right: 3px; bottom: 3px;
      width: 8px; height: 8px;
      border-right: 2px solid #c0c0c0;
      border-bottom: 2px solid #c0c0c0;
      transition: border-color 120ms;
    }
    .nr-resize-handle:hover::after { border-color: ${ACCENT}; }

    /* 右下角登录徽章(浮动,不挤 head) */
    .nr-corner-pill {
      position: absolute;
      right: 28px; bottom: 4px;
      display: inline-flex; align-items: center;
      padding: 3px 8px;
      font-size: 11px; line-height: 1.4;
      border-radius: 11px;
      background: rgba(0,0,0,0.04);
      color: #666;
      cursor: pointer;
      user-select: none;
      pointer-events: auto;
      z-index: 3;
      transition: background 120ms;
    }
    .nr-corner-pill:hover { background: rgba(0,0,0,0.08); }
    .nr-corner-pill.dot { padding: 5px; }
    .nr-corner-pill .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #aaa;
    }
    .nr-corner-pill.logged-in .dot { background: #2c8a3a; }
    .nr-corner-pill.action { background: ${ACCENT}; color: #fff; }
  `;

  // ===================== 构建 =====================

  function _buildCore() {
    if (document.getElementById(WRAPPER_ID)) return;

    const styleEl = document.createElement('style');
    styleEl.id = WRAPPER_ID + '-style';
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);

    wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    wrapper.style.left = (window.innerWidth - 100) + 'px';
    wrapper.style.top = (window.innerHeight - 100) + 'px';
    wrapper.innerHTML = `
      <div id="${WRAPPER_ID}-circle">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/>
          <circle cx="12" cy="12" r="4" fill="currentColor"/>
        </svg>
      </div>
    `;
    document.body.appendChild(wrapper);

    panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';
    panel.innerHTML = `
      <div class="nr-panel-toolbar" data-note-drag-handle>
        <button class="nr-icon-btn" data-note-action="toggle-picker" title="切换便签页">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7h6a2 2 0 012 2v0H5a2 2 0 01-2-2v0z"/>
            <path d="M21 7h-6a2 2 0 00-2 2v0h6a2 2 0 002-2v0z"/>
            <path d="M3 17h6a2 2 0 002-2v0H5a2 2 0 00-2 2v0z"/>
            <path d="M21 17h-6a2 2 0 01-2-2v0h6a2 2 0 012 2v0z"/>
          </svg>
        </button>
        <div class="nr-toolbar-spacer"></div>
        <button class="nr-icon-btn" data-note-action="bind-current-tab" title="绑定当前标签页">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
          </svg>
        </button>
        <button class="nr-icon-btn" data-note-action="capture-frame" title="截取视频帧">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="6" width="18" height="13" rx="2"/>
            <circle cx="12" cy="12.5" r="3.5"/>
            <path d="M8 6l1.5-2h5L16 6"/>
          </svg>
        </button>
        <div class="nr-toolbar-spacer"></div>
        <button class="nr-icon-btn" data-note-action="open-in-board" title="在便签模块打开（登录与账号配置在此）">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
        <button class="nr-icon-btn" data-note-action="close-panel" title="收起">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>
          </svg>
        </button>
      </div>
      <div class="nr-body" id="${WRAPPER_ID}-body"></div>
      <div class="nr-status-bar">
        <span id="${WRAPPER_ID}-status-left">就绪</span>
        <span id="${WRAPPER_ID}-status-right"></span>
      </div>
      <div class="nr-resize-handle" data-note-resize-handle></div>
      <div class="nr-corner-pill" data-note-corner-pill title="打开便签模块"></div>
    `;
    panel.style.left = (window.innerWidth - 360) + 'px';
    panel.style.top = '80px';
    // 从 chrome.storage.local 还原上次尺寸(若有)
    chrome.storage.local.get(['noteRingPanelDims']).then((r) => {
      const d = r && r.noteRingPanelDims;
      if (d && Number.isFinite(d.width) && Number.isFinite(d.height)) {
        panel.style.width = d.width + 'px';
        panel.style.height = d.height + 'px';
      }
    }).catch(() => {});
    document.body.appendChild(panel);

    // picker 挂在 body 层（不能放 panel 内,panel overflow:hidden 会裁剪）
    const picker = document.createElement('div');
    picker.className = 'nr-picker';
    picker.setAttribute('data-note-picker', '');
    document.body.appendChild(picker);
    panel.addEventListener('click', (e) => e.stopPropagation());
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    bindRingDragAndClick(wrapper);
    bindPanelDrag(panel, panel.querySelector('[data-note-drag-handle]'));
    bindPanelResize(panel, panel.querySelector('[data-note-resize-handle]'));

    // header actions
    panel.querySelector('[data-note-action="toggle-picker"]').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePicker();
    });
    panel.querySelector('[data-note-action="close-panel"]').addEventListener('click', (e) => {
      e.stopPropagation();
      setExpanded(false);
    });
    panel.querySelector('[data-note-action="bind-current-tab"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      bindCurrentTab();
    });
    panel.querySelector('[data-note-action="capture-frame"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      captureFrameAndInsert();
    });
    panel.querySelector('[data-note-action="open-in-board"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openInBoard();
    });

    // corner pill click → 打开便签模块
    const cornerPill = panel.querySelector('[data-note-corner-pill]');
    if (cornerPill && !cornerPill._bound) {
      cornerPill._bound = true;
      cornerPill.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openTabboard' });
      });
    }

    // 初次加载数据
    refreshFromStorage();
  }

  // ===================== 拖动 =====================

  function bindRingDragAndClick(host) {
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
      if (!moved && Math.hypot(dx, dy) > TH) {
        moved = true; host.classList.add('dragging');
      }
      if (moved) {
        host.style.left = clamp(sl + dx, 0, window.innerWidth - host.offsetWidth) + 'px';
        host.style.top = clamp(st + dy, 0, window.innerHeight - host.offsetHeight) + 'px';
        host.style.right = 'auto'; host.style.bottom = 'auto';
      }
    });
    host.addEventListener('pointerup', () => {
      pid = null;
      if (moved) { host.classList.remove('dragging'); moved = false; }
      else setExpanded(!isExpanded);
    });
  }

  function bindPanelDrag(panelEl, handle) {
    if (!handle) return;
    const TH = 4;
    let pid = null, sx = 0, sy = 0, sl = 0, st = 0, moved = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // 排除按钮——避免 drag 的 setPointerCapture 劫持 click
      if (e.target.closest('button, .nr-icon-btn')) return;
      pid = e.pointerId;
      try { handle.setPointerCapture(pid); } catch (_) {}
      sx = e.clientX; sy = e.clientY;
      const r = panelEl.getBoundingClientRect();
      sl = r.left; st = r.top; moved = false;
    });
    handle.addEventListener('pointermove', (e) => {
      if (pid === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) > TH) {
        moved = true; handle.classList.add('dragging'); panelEl.classList.add('dragging');
      }
      if (moved) {
        panelEl.style.left = clamp(sl + dx, 0, window.innerWidth - panelEl.offsetWidth) + 'px';
        panelEl.style.top = clamp(st + dy, 0, window.innerHeight - panelEl.offsetHeight) + 'px';
        panelEl.style.right = 'auto'; panelEl.style.bottom = 'auto';
      }
    });
    const release = () => {
      pid = null;
      if (moved) {
        handle.classList.remove('dragging');
        panelEl.classList.remove('dragging');
        moved = false;
      }
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /**
   * 右下角 resize:pointer-based,沿用现有 bindPanelDrag 风格。
   * 拖动期间实时改 panel.style.width/height;松手时持久化到
   * chrome.storage.local.noteRingPanelDims。
   * 尺寸下限 240×200(保证编辑器可读),上限视口 - 16。
   */
  function bindPanelResize(panelEl, handle) {
    if (!handle) return;
    const MIN_W = 240, MIN_H = 200;
    const TH = 3;
    let pid = null, sx = 0, sy = 0, sw = 0, sh = 0, moved = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pid = e.pointerId;
      try { handle.setPointerCapture(pid); } catch (_) {}
      sx = e.clientX; sy = e.clientY;
      sw = panelEl.offsetWidth; sh = panelEl.offsetHeight; moved = false;
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (pid === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) > TH) moved = true;
      if (!moved) return;
      const maxW = Math.max(MIN_W, window.innerWidth - panelEl.offsetLeft - 16);
      const maxH = Math.max(MIN_H, window.innerHeight - panelEl.offsetTop - 16);
      const nw = Math.max(MIN_W, Math.min(maxW, sw + dx));
      const nh = Math.max(MIN_H, Math.min(maxH, sh + dy));
      panelEl.style.width = nw + 'px';
      panelEl.style.height = nh + 'px';
    });
    const release = () => {
      if (pid === null) return;
      pid = null;
      if (moved) {
        moved = false;
        const dims = { width: panelEl.offsetWidth, height: panelEl.offsetHeight };
        chrome.storage.local.set({ noteRingPanelDims: dims }).catch(() => {});
      }
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);
  }

  // ===================== 数据 =====================

  async function refreshFromStorage() {
    try {
      const [notesRes, curRes] = await Promise.all([
        chrome.runtime.sendMessage({ action: 'getNotes' }),
        chrome.runtime.sendMessage({ action: 'getNoteCurrentPageId' })
      ]);
      pages = (notesRes?.success && Array.isArray(notesRes.notePages)) ? notesRes.notePages : [];
      currentPageId = curRes?.success ? curRes.currentPageId : null;
    } catch (_) {
      pages = [];
      currentPageId = null;
    }
    await detectCurrentTab();
    pickActivePage();
    render();
  }

  // content script 无 chrome.tabs → 走 background getActiveTabInfo(sender.tab)
  async function detectCurrentTab() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'getActiveTabInfo' });
      if (res?.success) {
        currentTabUrl = res.url || '';
        currentTabTitle = res.title || '';
        currentTabFavicon = res.favicon || '';
      }
    } catch (_) {}
  }

  function pickActivePage() {
    // 已选(全局默认 page)且仍存在 → 保持(不切,即使用户在别的 tab 选了别的 page)
    if (currentPageId && pages.find(p => p.id === currentPageId)) return;
    // 未选:首次打开或当前 page 被删 → 回退到第一个 page
    currentPageId = pages[0]?.id || null;
  }

  // ===================== 渲染 =====================

  function render() {
    if (!panel) return;
    renderBody();
    renderPicker();
    updateCircleAccent();
  }

  function renderBody() {
    const body = panel.querySelector('#' + WRAPPER_ID + '-body');
    if (!body) return;
    const page = pages.find(p => p.id === currentPageId);
    if (!page) {
      const msg = pages.length === 0
        ? `<div class="nr-empty">
             <div class="nr-empty-icon">📝</div>
             <div>还没有便签页</div>
             <button class="nr-empty-cta" data-note-action="new-page">新建第一个便签页</button>
           </div>`
        : `<div class="nr-empty">
             <div class="nr-empty-icon">📂</div>
             <div>请选择一个便签页</div>
             <div style="font-size:11px;margin-top:6px;color:#bbb;">点击标题栏 → 选择/新建</div>
             <button class="nr-empty-cta" data-note-action="open-picker">选择便签页</button>
           </div>`;
      body.innerHTML = msg;
      setStatus('', '');
      return;
    }
    // WYSIWYG 编辑器: [[URL]] 渲染为图片块;光标进入图片块附近时临时显示 [[url]] 源码
    // 截帧按钮已在顶部 compact toolbar(数据-action="capture-frame"),正文不再放,
    // 用户 R2/R8 要求:小按钮一行 + 正文为视觉核心。
    body.innerHTML = `
      <div class="nr-editor" id="${WRAPPER_ID}-editor" contenteditable="true" data-placeholder="开始写…Ctrl+B 或工具栏截帧后自动插入图片" spellcheck="false"></div>
    `;
    const editor = panel.querySelector('#' + WRAPPER_ID + '-editor');
    if (editor) {
      renderContentToEditor(editor, page.content || '');
      bindEditorEvents(editor);
      proxyEditorImages(editor);
    }
    setStatus(`${page.content?.length || 0} 字符`, '就绪');
    refreshLoginPill();
  }

  /**
   * HTTPS 页面(如 B 站)加载 http:// 图片被 Mixed Content 拦截。
   * 渲染时已把 http:// URL 放在 data-pending-src 上(不设 src,浏览器不发起请求)。
   * 此函数遍历 data-pending-src 的 img,通过扩展 SW 抓图转 dataURL,
   * 再写到 .src 上 → 无 Mixed Content 警告。
   * 笔记正文始终存原 http URL(几十字节)。
   */
  // ====== WYSIWYG 混合编辑器: [[URL]] → 图片块,光标进入时临时显示源码 ======

  /**
   * 把纯文本内容(含 [[URL]] 占位)渲染进 contenteditable editor
   * [[URL]] → <span class="nr-img-block" data-url=URL contenteditable=false><img data-pending-src=URL></span>
   * 其余文本按行分到 <div> 里(每行一个块,便于光标定位)
   */
  function renderContentToEditor(editor, content) {
    editor.innerHTML = "";
    if (!content) { editor.textContent = ""; return; }
    // 按 [[URL]] 切分
    const re = /(\[\[https?:\/\/[^\]]+\]\])/g;
    const parts = content.split(re);
    for (const part of parts) {
      const m = part.match(/^\[\[(https?:\/\/[^\]]+)\]\]$/);
      if (m) {
        const url = m[1];
        const isHttp = url.startsWith("http://");
        const span = document.createElement("span");
        span.className = "nr-img-block";
        span.setAttribute("contenteditable", "false");
        span.setAttribute("data-url", url);
        const img = document.createElement("img");
        img.alt = "视频帧";
        if (url) {
          // 始终先设 src;代理通道(SW fetchImageAsDataUrl)只能在 HTTPS 页绕开
          // Mixed Content 时成功。若代理失败/挂起,img.src 仍然是原始 URL,
          // 浏览器会尝试直接加载(在 HTTP 页面/HTTPS 页面下行为不同,但 img
          // 至少有 src,绝不会变成只有 × 按钮残留的"字母 x"假象)。
          img.src = url;
          if (isHttp) img.setAttribute("data-pending-src", url);
        }
        const x = document.createElement("button");
        x.className = "nr-img-x";
        x.type = "button";
        x.textContent = "×";
        x.title = "删除这张图";
        x.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const block = e.currentTarget.closest(".nr-img-block");
          if (!block) return;
          // 删除图片块 + 它前面的零宽空格(若有)
          const prev = block.previousSibling;
          block.remove();
          if (prev && prev.nodeType === 3 && prev.textContent === "\u200b") prev.remove();
          scheduleEditorSave(editor);
        });
        span.appendChild(img);
        span.appendChild(x);
        editor.appendChild(span);
      } else if (part) {
        // 文本:按 \n 分行,每行一个 <div>(空行用 <div><br></div>)
        const lines = part.split("\n");
        lines.forEach((line, idx) => {
          const div = document.createElement("div");
          if (line) div.textContent = line;
          else div.appendChild(document.createElement("br"));
          editor.appendChild(div);
        });
      }
    }
    if (!editor.childNodes.length) editor.textContent = "";
  }

  /**
   * 把 contenteditable editor 序列化回 [[URL]] + 文本 格式
   * 规则:<div> 之间换行;图片块 → [[url]];其它(如临时的源码 span)按 textContent
   */
  /**
   * 把 contenteditable editor 序列化回 [[URL]] + 文本 格式
   * 规则:<div> 之间换行;图片块 → [[url]];其它(如临时的源码 span)按 textContent
   *
   * 防御:source 态 (nr-img-source) 可能在 contenteditable 里被用户/浏览器
   * 改成任意文本(例如单个 ×)。存储必须以 data-url 兜底:只有 source textContent
   * 是合法 [[URL]] 形式才用它,否则用 data-url 重建,绝不写入损坏的字符串。
   */
  function serializeEditor(editor) {
    let out = "";
    const kids = Array.from(editor.childNodes);
    kids.forEach((node, i) => {
      if (node.nodeType === 3) {
        // 纯文本节点
        out += node.textContent;
      } else if (node.nodeType === 1) {
        const el = node;
        if (el.classList && el.classList.contains("nr-img-block")) {
          const url = el.getAttribute("data-url");
          if (url) out += `[[${url}]]`;
          // 无 data-url 的孤儿:不写入任何字符(避免 × 按钮字符污染)
        } else if (el.classList && el.classList.contains("nr-img-source")) {
          const txt = (el.textContent || "").trim();
          const m = txt.match(/^\[\[(https?:\/\/[^\]]+)\]\]$/);
          if (m) {
            out += txt;
          } else {
            const fallback = el.getAttribute("data-url") || "";
            if (fallback) out += `[[${fallback}]]`;
          }
        } else {
          // <div> / <br> 等
          const tag = el.tagName;
          if (tag === "BR") {
            out += "\n";
          } else {
            // div:用纯文本,但排除内嵌的图片块子树(其 × 按钮字符不应泄漏)
            const t = pureTextContent(el);
            out += t;
            if (i < kids.length - 1) out += "\n";
          }
        }
      }
    });
    return out;
  }

  /**
   * 取元素纯文本内容,但排除任何内嵌的 nr-img-block / nr-img-source /
   * nr-img-pending 子树。否则容器 div 的 textContent 会把 × 按钮字符或
   * `[上传中…]` 占位文字当作普通文本写入存储。
   */
  function pureTextContent(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".nr-img-block, .nr-img-source, .nr-img-pending")
      .forEach((n) => n.remove());
    return clone.textContent || "";
  }

  /**
   * 光标感知:把光标所在的图片块临时显示为 [[url]] 源码(可编辑),其余保持图片
   */
  let _activeImgBlock = null;
  function syncImageActiveState(editor) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      deactivateAllImages(editor);
      return;
    }
    const node = sel.anchorNode;
    // 向上找最近的图片块(或临时源码 span)
    let target = null;
    if (node) {
      target = node.nodeType === 1 ? node.closest(".nr-img-block, .nr-img-source") : null;
      if (!target && node.parentElement) {
        target = node.parentElement.closest(".nr-img-block, .nr-img-source");
      }
    }
    if (target && target.classList.contains("nr-img-source")) {
      // 已经在源码态,保持
      return;
    }
    if (target && target.classList.contains("nr-img-block")) {
      // 光标在图片块上 → 激活为源码态
      activateImageAsSource(editor, target);
    } else {
      deactivateAllImages(editor);
    }
  }

  function activateImageAsSource(editor, block) {
    if (_activeImgBlock === block) return;
    deactivateAllImages(editor);
    _activeImgBlock = block;
    const url = block.getAttribute("data-url") || "";
    const span = document.createElement("span");
    span.className = "nr-img-source";
    span.setAttribute("contenteditable", "true");
    span.textContent = `[[${url}]]`;
    span.setAttribute("data-url", url);
    block.replaceWith(span);
    // 聚焦并把光标放末尾
    span.focus();
    const r = document.createRange();
    r.selectNodeContents(span);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  function deactivateAllImages(editor) {
    if (!_activeImgBlock) return;
    // 当前激活的可能已被替换为 .nr-img-source;若在,blur 时把它换回图片块
    const src = editor.querySelector(".nr-img-source");
    if (src) {
      const url = (src.textContent.match(/\[\[(https?:\/\/[^\]]+)\]\]/) || [])[1] || src.getAttribute("data-url");
      const span = makeImageBlock(url);
      src.replaceWith(span);
      proxyEditorImages(editor); // 补新块的 src
    }
    _activeImgBlock = null;
  }

  function onDeleteImgClick(e) {
    e.preventDefault(); e.stopPropagation();
    const block = e.currentTarget.closest(".nr-img-block");
    if (!block) return;
    const prev = block.previousSibling;
    block.remove();
    if (prev && prev.nodeType === 3 && prev.textContent === "\u200b") prev.remove();
    const editor = panel?.querySelector("#" + WRAPPER_ID + "-editor");
    if (editor) scheduleEditorSave(editor);
  }

  /**
   * editor 事件绑定:input → 防抖保存;selectionchange → 光标感知
   */
  function bindEditorEvents(editor) {
    if (editor._bound) return;
    editor._bound = true;
    editor.addEventListener("input", () => {
      setStatus(`${serializeEditor(editor).length} 字符`, "保存中…", "saving");
      scheduleEditorSave(editor);
    });
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "  ");
      }
      e.stopPropagation();
    });
    // 粘贴图片 → 上传图床 → 插入 [[URL]] 图片块(与截帧同链路)
    editor.addEventListener("paste", (e) => onEditorPaste(e, editor));
    // 光标感知:监听 document selectionchange(只在 editor 内变化时处理)
    // 具名引用,remove() 时清理,避免 destroy 重建后累积监听器
    editor._selChange = () => {
      if (!panel || document.activeElement !== editor) return;
      syncImageActiveState(editor);
    };
    document.addEventListener("selectionchange", editor._selChange);
    // blur 时把所有源码态换回图片
    editor.addEventListener("blur", () => deactivateAllImages(editor));
  }

  /**
   * 粘贴处理:剪贴板含图片 → 转 dataURL → 上传图床 → 后端落盘 → 渲染回编辑器
   *
   * 设计原则:文本层与显示层解耦。
   * - 上传返回 URL 后,直接 chrome.storage.local 写入 [[URL]],不经过 DOM 序列化。
   *   后端是唯一真理来源,显示层只是渲染。
   * - 期间用占位块 `[上传中…]` 提供视觉反馈,但 cancel 已有的 auto-save timer
   *   防止它把占位块序列化进存储。
   * - 这消除了 "DOM 已插入,文本层仍是原值" 的窗口期,以及 × 等脏数据
   *   污染存储的路径(因为持久化路径完全绕开了 contenteditable DOM)。
   */
  async function onEditorPaste(e, editor) {
    if (!currentPageId) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    let imageItem = null;
    for (const it of items) {
      if (it.type && it.type.startsWith("image/")) { imageItem = it; break; }
    }
    if (!imageItem) return; // 没图片 → 走默认文本粘贴
    e.preventDefault();
    const blob = imageItem.getAsFile();
    if (!blob) return;
    // blob → dataURL
    const dataUrl = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => res(null);
      r.readAsDataURL(blob);
    });
    if (!dataUrl) return;
    // 凭证预检
    const status = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getLoginStatus" }, (r) => {
        if (chrome.runtime.lastError) resolve({ hasCredentials: false });
        else resolve(r || { hasCredentials: false });
      });
    });
    if (!status.hasCredentials) {
      if (confirm("未配置图床账号,打开便签模块填写吗?")) {
        chrome.runtime.sendMessage({ action: "openTabboard" });
      }
      return;
    }

    // 1) 占位块 — 用户看到即时反馈。禁止已有的 auto-save,防止序列化中间态。
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    deactivateAllImages(editor);
    const placeholder = makePendingBlock();
    insertNodeAtCursor(editor, placeholder);
    setStatus("", "上传粘贴图…", "saving");

    let res;
    try {
      res = await chrome.runtime.sendMessage({ action: "uploadNoteImage", dataUrl });
    } catch (err) {
      placeholder.remove();
      setStatus("", "上传失败", "saved");
      alert("上传失败: " + err.message);
      return;
    }
    if (!res?.success || !res.url) {
      placeholder.remove();
      setStatus("", "上传失败", "saved");
      alert("上传失败: " + (res?.error || ""));
      return;
    }

    // 2) 后端落盘 — 用 pages 里原 content 拼接,不经过 DOM 序列化
    const page = pages.find((p) => p.id === currentPageId);
    if (!page) { placeholder.remove(); return; }
    const prev = page.content || "";
    const sep = prev && !prev.endsWith("\n") ? "\n" : "";
    const newContent = prev + sep + `[[${res.url}]]`;
    await chrome.runtime.sendMessage({ action: "updateNoteContent", id: currentPageId, content: newContent });
    page.content = newContent;

    // 3) 占位块 → 真实图片块
    const realBlock = makeImageBlock(res.url);
    placeholder.replaceWith(realBlock);
    proxyEditorImages(editor);
    setStatus("", "已粘贴上传 ✓", "saved");
  }

  /**
   * 上传期间的占位块:显示 "[上传中…]",完全不影响存盘文本(序列化时按
   * 防御策略剥离)。绝不放进 storage,绝不依赖 DOM 序列化回填。
   */
  function makePendingBlock() {
    const span = document.createElement("span");
    span.className = "nr-img-pending";
    span.setAttribute("contenteditable", "false");
    span.textContent = "[上传中…]";
    return span;
  }

  /**
   * 通用光标位置插入
   */
  function insertNodeAtCursor(editor, node) {
    const sel = window.getSelection();
    let inserted = false;
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      inserted = true;
    }
    if (!inserted) editor.appendChild(node);
  }

  let _saveTimer = null;
  function scheduleEditorSave(editor) {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      if (!currentPageId) return;
      const content = serializeEditor(editor);
      await chrome.runtime.sendMessage({ action: "updateNoteContent", id: currentPageId, content });
      setStatus(`${content.length} 字符`, "已保存", "saved");
    }, 500);
  }

  /**
   * 代理编辑器里所有 data-pending-src 的 http 图片 → SW fetch 转 dataURL
   * Mixed Content 兜底优化。img.src 已由 _render/renderContentToEditor 写好
   * 原始 URL;SW 失败时保留原 src,避免代理路径断时图片退化成只有 × 按钮
   * (被误判成"字母 x")。
   *
   * 命中走 background 的 LRU 池(共享内存缓存),miss 才 fetch。
   */
  function proxyEditorImages(editor) {
    const imgs = editor.querySelectorAll("img[data-pending-src]");
    imgs.forEach((img) => {
      const url = img.getAttribute("data-pending-src");
      if (!url) return;
      chrome.runtime.sendMessage({ action: "fetchImageAsDataUrl", url }, (res) => {
        if (res?.success && res.dataUrl) {
          img.src = res.dataUrl;
          img.removeAttribute("data-pending-src");
        }
        // 失败分支:不动 img.src,保留原始 URL。不再设 alt='图片加载失败'。
      });
    });
  }


  // 兼容旧调用(selectPage/newPage 等仍调 flushContentSave):
  // 切页/新建前,把当前 editor 的待保存内容立即落盘
  async function flushContentSave() {
    const editor = panel?.querySelector('#' + WRAPPER_ID + '-editor');
    if (!editor || !currentPageId) return;
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    const content = serializeEditor(editor);
    await chrome.runtime.sendMessage({
      action: 'updateNoteContent',
      id: currentPageId,
      content: content || ''
    });
  }

  function setStatus(left, right, rightCls) {
    const l = panel?.querySelector('#' + WRAPPER_ID + '-status-left');
    const r = panel?.querySelector('#' + WRAPPER_ID + '-status-right');
    if (l) l.textContent = left;
    if (r) {
      r.textContent = right;
      r.className = rightCls || '';
    }
  }

  function renderPicker() {
    const picker = document.querySelector('[data-note-picker]');
    if (!picker) return;
    if (pages.length === 0) {
      picker.innerHTML = `
        <div class="nr-picker-item" data-note-action="new-page">
          <div class="nr-picker-item-main">
            <div class="nr-picker-item-name">+ 新建便签页</div>
          </div>
        </div>
      `;
      return;
    }
    const sorted = [...pages].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    picker.innerHTML = sorted.map(p => {
      const chars = p.content?.length || 0;
      const tabs = p.boundTabs?.length || 0;
      return `
        <div class="nr-picker-item ${p.id === currentPageId ? 'active' : ''}" data-page-id="${escAttr(p.id)}">
          <div class="nr-picker-item-main" data-note-action="select-page">
            <div class="nr-picker-item-name">${escHtml(p.name)}</div>
            <div class="nr-picker-item-meta">${chars} 字符${tabs ? ` · ${tabs} 标签页` : ''}</div>
          </div>
          <div class="nr-picker-item-actions">
            <button class="nr-icon-btn" data-note-action="rename-page" data-page-id="${escAttr(p.id)}" title="重命名">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('') + `
      <div class="nr-picker-new" data-note-action="new-page">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        新建便签页
      </div>
    `;
  }

  function updateCircleAccent() {
    const circle = wrapper?.querySelector('#' + WRAPPER_ID + '-circle');
    if (circle) circle.classList.toggle('expanded', isExpanded);
  }

  // ===================== 工具 =====================

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(s) { return String(s ?? '').replace(/"/g,'&quot;'); }

  // ===================== 操作 =====================

  function togglePicker() {
    const picker = document.querySelector('[data-note-picker]');
    if (!picker) return;
    // 渲染后再 toggle 防止内容为空
    if (!picker.innerHTML.trim()) renderPicker();
    if (picker.classList.contains('open')) {
      picker.classList.remove('open');
      return;
    }
    // 定位:锚定在 toolbar 的「切换便签页」按钮下方。
    // 注意:老的 .nr-switcher 锚点已随 head 精简删除,必须锚到工具栏按钮,
    // 否则 position:fixed 的 picker 没有 left/top,会跑到视口左上角看不见。
    const anchor = panel?.querySelector('[data-note-action="toggle-picker"]')
      || panel?.querySelector('.nr-panel-toolbar');
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      picker.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 308)) + 'px';
      picker.style.top = (r.bottom + 4) + 'px';
    } else if (panel) {
      // 兜底:锚到 panel 左上角,至少可见可点
      const pr = panel.getBoundingClientRect();
      picker.style.left = Math.max(8, pr.left) + 'px';
      picker.style.top = (pr.top + 40) + 'px';
    }
    picker.classList.add('open');
  }

  async function selectPage(actionEl) {
    const id = actionEl.closest('[data-page-id]')?.getAttribute('data-page-id');
    if (!id) return;
    if (id === currentPageId) {
      document.querySelector('[data-note-picker]')?.classList.remove('open');
      return;
    }
    // 切换前 flush 待保存内容
    await flushContentSave();
    currentPageId = id;
    // 持久化:记住这个选择,下次开面板自动用
    chrome.runtime.sendMessage({ action: 'setNoteCurrentPageId', id });
    document.querySelector('[data-note-picker]')?.classList.remove('open');
    render();
  }

  async function newPage() {
    const name = prompt('便签页名称', currentTabTitle ? currentTabTitle.slice(0, 30) : '新便签页');
    if (!name) return;
    const r = await chrome.runtime.sendMessage({ action: 'createNotePage', name });
    if (!r?.success) { alert(r.error || '创建失败'); return; }
    if (/^https?:\/\//.test(currentTabUrl)) {
      // 自动绑定当前 tab
      await chrome.runtime.sendMessage({
        action: 'bindTabToPage',
        pageId: r.page.id,
        url: currentTabUrl,
        title: currentTabTitle,
        favicon: currentTabFavicon
      });
    }
    currentPageId = r.page.id;
    chrome.runtime.sendMessage({ action: 'setNoteCurrentPageId', id: r.page.id });
    document.querySelector('[data-note-picker]')?.classList.remove('open');
    await refreshFromStorage();
  }

  async function renamePage(actionEl) {
    const id = actionEl.closest('[data-page-id]')?.getAttribute('data-page-id');
    if (!id) return;
    const page = pages.find(p => p.id === id);
    if (!page) return;
    const name = prompt('重命名', page.name);
    if (!name || name === page.name) return;
    await chrome.runtime.sendMessage({ action: 'renameNotePage', id, name });
    await refreshFromStorage();
  }

  async function deleteCurrentPage() {
    if (!currentPageId) return;
    const page = pages.find(p => p.id === currentPageId);
    if (!page) return;
    if (!confirm(`删除便签页「${page.name}」？文章内容将丢失。`)) return;
    await flushContentSave();
    const r = await chrome.runtime.sendMessage({ action: 'deleteNotePage', id: currentPageId });
    if (r?.success) {
      currentPageId = null;
      document.querySelector('[data-note-picker]')?.classList.remove('open');
      await refreshFromStorage();
    }
  }

  async function renameCurrentPage() {
    if (!currentPageId) return;
    const page = pages.find(p => p.id === currentPageId);
    if (!page) return;
    const name = prompt('重命名', page.name);
    if (!name || name === page.name) return;
    await flushContentSave();
    await chrome.runtime.sendMessage({ action: 'renameNotePage', id: currentPageId, name });
    await refreshFromStorage();
  }

  async function bindCurrentTab() {
    if (!currentPageId) return;
    if (!/^https?:\/\//.test(currentTabUrl)) return;
    await chrome.runtime.sendMessage({
      action: 'bindTabToPage',
      pageId: currentPageId,
      url: currentTabUrl, title: currentTabTitle, favicon: currentTabFavicon
    });
    await refreshFromStorage();
  }

  function setExpanded(expanded) {
    if (!panel) return;
    isExpanded = expanded;
    panel.classList.toggle('open', expanded);
    updateCircleAccent();
    if (expanded) {
      // 聚焦编辑器
      setTimeout(() => {
        const editor = panel.querySelector('#' + WRAPPER_ID + '-editor');
        if (editor) editor.focus();
      }, 80);
    } else {
      document.querySelector('[data-note-picker]')?.classList.remove('open');
    }
  }

  // ===================== 截帧上传 =====================

  /**
   * 截取当前页面一个视频的当前帧 → 缩放到 MAX_FRAME_W 以内 → PNG dataURL
   * 与 content/content.js 中的同名逻辑一致（noteRing 在视频页可直接截帧，免一次 IPC）
   */
  function capturePageFrame() {
    const MAX_FRAME_W = 1920;
    return new Promise((resolve) => {
      const videos = Array.from(document.querySelectorAll('video'));
      if (!videos.length) { resolve(null); return; }
      const inViewport = (v) => {
        const r = v.getBoundingClientRect();
        return r.bottom > 0 && r.right > 0 &&
               r.top < window.innerHeight && r.left < window.innerWidth &&
               r.width > 50 && r.height > 50;
      };
      const video =
        videos.find(v => !v.paused && v.readyState >= 2) ||
        videos.filter(inViewport).sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        })[0] ||
        videos[0];
      const draw = () => {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) { resolve(null); return; }
        const scale = Math.min(1, MAX_FRAME_W / w);
        const cw = Math.round(w * scale), ch = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        try {
          canvas.getContext('2d').drawImage(video, 0, 0, cw, ch);
          resolve(canvas.toDataURL('image/png'));
        } catch (_) { resolve(null); }
      };
      if (video.readyState >= 2) draw();
      else {
        let done = false;
        const finish = () => { if (!done) { done = true; draw(); } };
        video.addEventListener('loadeddata', finish, { once: true });
        setTimeout(finish, 2500);
      }
    });
  }

  /**
   * 截当前页视频帧 → 上传图床 → 把 [[URL]] 插入正文
   * 编辑模式：插入到 textarea 光标处
   * 预览模式：追加到正文末尾并重渲染预览
   */
  async function captureFrameAndInsert() {
    if (!currentPageId) { alert('请先选择一个便签页'); return; }
    // 凭证预检(优先用 background getLoginStatus,模块里有账号配置入口)
    const status = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getLoginStatus' }, (r) => {
        if (chrome.runtime.lastError) resolve({ hasCredentials: false });
        else resolve(r || { hasCredentials: false });
      });
    });
    if (!status.hasCredentials) {
      if (confirm('未配置图床账号,打开便签模块填写吗?')) {
        chrome.runtime.sendMessage({ action: 'openTabboard' });
      }
      return;
    }
    setStatus('', '截取视频帧…', 'saving');
    const dataUrl = await capturePageFrame();
    if (!dataUrl) { setStatus('', '未找到视频', 'saved'); alert('当前页面未检测到可截取的视频'); return; }
    setStatus('', '上传到图床…', 'saving');
    let res;
    try {
      res = await chrome.runtime.sendMessage({ action: 'uploadNoteImage', dataUrl });
    } catch (err) {
      setStatus('', '上传失败', 'saved');
      alert('上传失败: ' + err.message);
      return;
    }
    if (!res?.success) { setStatus('', '上传失败', 'saved'); alert('上传失败: ' + (res?.error || '')); return; }
    // 笔记正文存原 http:// URL(几十字节,可分享);
    // 编辑器里 [[URL]] 渲染为图片块,http:// 通过 SW 代理转 dataURL 显示(无 Mixed Content)
    const url = res.url;
    const editor = panel.querySelector('#' + WRAPPER_ID + '-editor');
    if (editor) {
      // 后端驱动:先 cancel auto-save,后端落盘,再渲染占位→真实块。
      // 不依赖 DOM 序列化决定持久化(避免 × 按钮字符污染)。
      if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
      deactivateAllImages(editor);
      const placeholder = makePendingBlock();
      insertNodeAtCursor(editor, placeholder);

      const page = pages.find((p) => p.id === currentPageId);
      const prev = (page?.content || '');
      const sep = prev && !prev.endsWith('\n') ? '\n' : '';
      const newContent = prev + sep + `[[${url}]]`;
      await chrome.runtime.sendMessage({ action: 'updateNoteContent', id: currentPageId, content: newContent });
      if (page) page.content = newContent;

      const realBlock = makeImageBlock(url);
      placeholder.replaceWith(realBlock);
      proxyEditorImages(editor);
    } else {
      // editor 不存在(无选中页)→ 直接追加到 content 存储
      const page = pages.find(p => p.id === currentPageId);
      const prev = (page?.content || '');
      const content = prev + (prev && !prev.endsWith('\n') ? '\n' : '') + `[[${url}]]`;
      await chrome.runtime.sendMessage({ action: 'updateNoteContent', id: currentPageId, content });
    }
    setStatus(`${url.length + 4} 字节图`, '已上传 ✓', 'saved');
  }

  function makeImageBlock(url) {
    const span = document.createElement('span');
    span.className = 'nr-img-block';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-url', url);
    const img = document.createElement('img');
    img.alt = '视频帧';
    if (url) {
      // 始终先设 src(代理是优化,不是必需)。否则代理失败时只剩 × 按钮,
      // 用户感知到的就是"字母 x"。
      img.src = url;
      if (url.startsWith('http://')) img.setAttribute('data-pending-src', url);
    }
    const x = document.createElement('button');
    x.className = 'nr-img-x';
    x.type = 'button';
    x.textContent = '×';
    x.title = '删除这张图';
    x.addEventListener('click', onDeleteImgClick);
    span.appendChild(img);
    span.appendChild(x);
    return span;
  }

  // ===================== 登录状态徽章(同步 background getLoginStatus) =====================

  function refreshLoginPill() {
    if (!panel) return;
    const pill = panel.querySelector('[data-note-corner-pill]');
    if (!pill) return;
    chrome.runtime.sendMessage({ action: 'getLoginStatus' }, (r) => {
      pill.classList.remove('logged-in', 'action');
      if (!r || r.success === false) {
        pill.classList.add('dot');
        pill.textContent = '';
        return;
      }
      if (r.hasCredentials && r.tokenValid) {
        pill.classList.add('dot', 'logged-in');
        pill.textContent = '';
      } else if (r.hasCredentials) {
        pill.classList.add('dot');
        pill.textContent = '';
      } else {
        pill.textContent = '未配置';
        pill.classList.add('action');
      }
    });
  }

  function openInBoard() {
    // 通过 background 转调 tabboard,避免 content script 自己 chrome.tabs.create 的权限成本
    chrome.runtime.sendMessage({ action: 'openTabboard' });
  }

  // 状态徽章点击 → 打开模块
  // (委托到 panel 上,click 时找最近 [data-pill-action] 或 #loginPill)

  // ===================== 快捷键 Ctrl+B(截帧) =====================

  function onHotkey(e) {
    // Ctrl+B: Chrome 不占用,便签编辑器不支持加粗,抢占用作截帧无副作用。
    // 关键:用户通常在编辑便签(焦点在 contenteditable editor)时截帧,
    //       所以 editor 内也必须生效;只在邮箱/密码/标题等 INPUT 时让出。
    const k = e.key?.toLowerCase();
    if (!(e.ctrlKey && !e.altKey && !e.shiftKey && k === 'b')) return;
    if (!panel || !isExpanded) return;
    // 让出:焦点在 INPUT(邮箱/密码/标题输入框)时,避免误触
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.id !== WRAPPER_ID + '-editor') return;
    // editor 是 contenteditable div(tagName=DIV, isContentEditable=true),允许
    e.preventDefault();
    captureFrameAndInsert();
  }

  // ===================== 事件委托 =====================

function bindPanelDelegation() {
    if (panel._delegationBound) return;
    panel._delegationBound = true;
    panel.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-note-action]');
      if (!actionEl) return;
      const a = actionEl.getAttribute('data-note-action');
      try {
        switch (a) {
          case 'select-page': return selectPage(actionEl);
          case 'new-page': return newPage();
          case 'open-picker': return togglePicker();
          case 'rename-page': return renamePage(actionEl);
          case 'bind-tab': return bindCurrentTab();
          case 'capture-frame': return captureFrameAndInsert();
          case 'open-login': return openInBoard();
          case 'open-in-board': return openInBoard();
        }
      } catch (err) {
        console.error('[noteRing] action', a, 'failed:', err);
      }
    });
  }

  function bindPickerDelegation() {
    const picker = document.querySelector('[data-note-picker]');
    if (!picker || picker._delegationBound) return;
    picker._delegationBound = true;
    picker.addEventListener('click', (e) => {
      e.stopPropagation();
      const actionEl = e.target.closest('[data-note-action]');
      if (!actionEl) return;
      const a = actionEl.getAttribute('data-note-action');
      try {
        switch (a) {
          case 'select-page': return selectPage(actionEl);
          case 'new-page': return newPage();
          case 'rename-page': return renamePage(actionEl);
        }
      } catch (err) {
        console.error('[noteRing] picker action', a, 'failed:', err);
      }
    });
  }

  // ===================== 生命周期 =====================

  function applyEnabled(enabled) {
    if (enabled) build();
    else remove();
  }

  function remove() {
    // 关闭前先保存未 flush 的防抖内容（fire-and-forget）
    if (_saveTimer && currentPageId && panel) {
      const editor = panel.querySelector('#' + WRAPPER_ID + '-editor');
      if (editor) {
        const content = serializeEditor(editor);
        if (content) {
          chrome.runtime.sendMessage({
            action: 'updateNoteContent',
            id: currentPageId,
            content
          });
        }
      }
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
    // 清理 document 级 selectionchange 监听
    const editor = panel?.querySelector('#' + WRAPPER_ID + '-editor');
    if (editor && editor._selChange) {
      document.removeEventListener('selectionchange', editor._selChange);
    }
    document.getElementById(WRAPPER_ID)?.remove();
    panel?.remove();
    document.querySelector('[data-note-picker]')?.remove();
    document.getElementById(WRAPPER_ID + '-style')?.remove();
    panel = null;
    wrapper = null;
    pages = [];
    currentPageId = null;
    isExpanded = false;
  }

  // ===================== 启动 =====================

  async function init() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
      const settings = res.success ? (res.settings || {}) : {};
      applyEnabled(settings.showNoteRing !== false);
    } catch (_) {}
  }

  // ESC 收起 + 截帧快捷键(capture 阶段,确保先于宿主页收到 Ctrl+B)
  document.addEventListener('keydown', (e) => {
    // 截帧快捷键(只展开面板时生效)
    onHotkey(e);
    if (e.key === 'Escape' && isExpanded && panel) {
      const picker = document.querySelector('[data-note-picker]');
      if (picker?.classList.contains('open')) {
        picker.classList.remove('open');
        return;
      }
      const editor = panel.querySelector('#' + WRAPPER_ID + '-editor');
      if (document.activeElement === editor) return;
      setExpanded(false);
    }
  }, true);

  // 顶层一次性 document 级监听（幂等）:
  //   点击外部只关闭 picker 下拉框;面板保持 pin 行为(不随外部点击收起,
  //   只能点 X 按钮或 ESC 关闭)——用户明确要求
  if (!window.__tabboardNoteRingDocBound) {
    window.__tabboardNoteRingDocBound = true;
    document.addEventListener('click', (e) => {
      const pickerEl = document.querySelector('[data-note-picker]');
      // 点圆环:交给 ring 的 toggle 逻辑,不处理
      if (wrapper && wrapper.contains(e.target)) return;
      // 关闭 picker:点击在 panel/picker 外
      if (pickerEl && pickerEl.classList.contains('open') && panel && !panel.contains(e.target) && !pickerEl.contains(e.target)) {
        pickerEl.classList.remove('open');
      }
      // 注意:不在此收起面板(用户要求 pin,点击外部保持展开)
    }, true);
  }

  // storage change → 刷新数据 + 重新渲染 picker(不要重建文章 textarea,会打断编辑)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.notePages || !panel) return;
    const newPages = changes.notePages.newValue || [];
    const activeStillExists = currentPageId && newPages.find(p => p.id === currentPageId);
    // 比对页面列表(数量/名称/绑定),如果只是内容更新,不动 article
    const oldPages = pages;
    const oldSig = oldPages.map(p => `${p.id}:${p.name}:${p.boundTabs?.length || 0}`).join('|');
    const newSig = newPages.map(p => `${p.id}:${p.name}:${p.boundTabs?.length || 0}`).join('|');
    const listChanged = oldSig !== newSig;
    pages = newPages;
    if (!activeStillExists) {
      // 当前页失效(被删) → 按 URL 重新自动选 / 回退第一个
      currentPageId = null;
      pickActivePage();
      render();
      return;
    }
    if (listChanged) {
      // 页面列表变了(新建/重命名/绑定变化) → 只刷 picker
      renderPicker();
    }
    // 内容变化不打断编辑器;但若用户未在编辑,同步外部改动
    if (currentPageId) {
      const page = newPages.find(p => p.id === currentPageId);
      const editorEl = panel.querySelector('#' + WRAPPER_ID + '-editor');
      if (editorEl && page && document.activeElement !== editorEl) {
        renderContentToEditor(editorEl, page.content || '');
        proxyEditorImages(editorEl);
      }
    }
  });

  // tab 激活广播 → 重新探测当前 tab 并自动选中绑定页
  chrome.runtime.onMessage.addListener((req) => {
    if (req?.action === 'noteTabActivated' && panel) {
      refreshFromStorage();
    }
  });

  // settings 变化
  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'local' || !changes.settings) return;
    const s = changes.settings.newValue || {};
    applyEnabled(s.showNoteRing !== false);
  });

  // 注入后绑定 delegation
  function build() {
    _buildCore();
    bindPanelDelegation();
    bindPickerDelegation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();