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
  const ACCENT = '#333';

  if (window.__tabboardNoteRingInjected) return;
  window.__tabboardNoteRingInjected = true;

  // ===================== 状态 =====================
  let wrapper = null;
  let panel = null;
  let isExpanded = false;
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
      box-shadow: 0 4px 14px rgba(0,0,0,0.28);
      display: flex; align-items: center; justify-content: center;
      transition: transform 180ms ease, box-shadow 180ms;
      position: relative;
    }
    #${WRAPPER_ID}-circle:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
    #${WRAPPER_ID}-circle.expanded { background: #fff; box-shadow: 0 6px 22px rgba(0,0,0,0.3); }
    #${WRAPPER_ID}-circle svg path,
    #${WRAPPER_ID}-circle svg line { stroke: #fff; transition: stroke 180ms; }
    #${WRAPPER_ID}-circle.expanded svg path,
    #${WRAPPER_ID}-circle.expanded svg line { stroke: #1a1a1a; }

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

    .nr-article-wrap {
      flex: 1; min-height: 0;
      display: flex;
      overflow: hidden;
    }
    .nr-article {
      flex: 1; width: 100%;
      border: none; outline: none;
      resize: none;
      padding: 14px 16px;
      font-size: 13px;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      tab-size: 2;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: #c0c0c0 transparent;
    }
    .nr-article::-webkit-scrollbar { width: 5px; }
    .nr-article::-webkit-scrollbar-thumb { background: #c0c0c0; border-radius: 3px; }
    .nr-article::-webkit-scrollbar-track { background: transparent; }
    .nr-article::placeholder { color: #c0c0c0; }

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
          <path d="M5 4h11l3 3v13a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="${ACCENT}" stroke-width="1.8"/>
          <path d="M16 4v3h3" stroke="${ACCENT}" stroke-width="1.8"/>
          <line x1="7" y1="12" x2="15" y2="12" stroke="${ACCENT}" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="7" y1="15" x2="13" y2="15" stroke="${ACCENT}" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </div>
    `;
    document.body.appendChild(wrapper);

    panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';
    panel.innerHTML = `
      <div class="nr-header" data-note-drag-handle>
        <div class="nr-switcher" data-note-action="toggle-picker">
          <div class="nr-page-name placeholder">便签页</div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="nr-header-actions">
          <button class="nr-icon-btn" data-note-action="rename-current-page" title="重命名当前页">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
            </svg>
          </button>
          <button class="nr-icon-btn nr-icon-btn-danger" data-note-action="delete-page" title="删除当前页面">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
            </svg>
          </button>
          <button class="nr-icon-btn" data-note-action="close-panel" title="收起">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="nr-tab-hint" data-note-tab-hint></div>
      <div class="nr-body" id="${WRAPPER_ID}-body"></div>
      <div class="nr-status-bar">
        <span id="${WRAPPER_ID}-status-left">就绪</span>
        <span id="${WRAPPER_ID}-status-right"></span>
      </div>
    `;
    panel.style.left = (window.innerWidth - 360) + 'px';
    panel.style.top = '80px';
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

    // header actions
    panel.querySelector('[data-note-action="toggle-picker"]').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePicker();
    });
    panel.querySelector('[data-note-action="delete-page"]').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCurrentPage();
    });
    panel.querySelector('[data-note-action="rename-current-page"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      renameCurrentPage();
    });
    panel.querySelector('[data-note-action="close-panel"]').addEventListener('click', (e) => {
      e.stopPropagation();
      setExpanded(false);
    });

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
      // 排除按钮/切换器——避免 drag 的 setPointerCapture 劫持 click
      if (e.target.closest('button, .nr-switcher, .nr-icon-btn')) return;
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
    renderHeader();
    renderTabHint();
    renderBody();
    renderPicker();
    updateCircleAccent();
  }

  function renderHeader() {
    const page = pages.find(p => p.id === currentPageId);
    const nameEl = panel.querySelector('.nr-page-name');
    if (page) {
      nameEl.textContent = page.name;
      nameEl.classList.remove('placeholder');
    } else {
      nameEl.textContent = '便签页';
      nameEl.classList.add('placeholder');
    }
  }

  function renderTabHint() {
    const hint = panel.querySelector('[data-note-tab-hint]');
    if (!hint) return;
    if (!currentTabUrl || !/^https?:\/\//.test(currentTabUrl)) {
      hint.style.display = 'none';
      return;
    }
    const page = pages.find(p => p.id === currentPageId);
    const alreadyBound = page && page.boundTabs?.some(t => t.url === currentTabUrl);
    hint.style.display = '';
    hint.innerHTML = `
      ${currentTabFavicon ? `<img src="${escAttr(currentTabFavicon)}" class="nr-fav" onerror="this.style.display='none'">` : ''}
      <span class="nr-tab-hint-text" title="${escAttr(currentTabUrl)}">${escHtml(currentTabTitle || currentTabUrl)}</span>
      ${page
        ? (alreadyBound
            ? '<span style="color:#999;">已绑定</span>'
            : `<button class="nr-tab-bind-btn" data-note-action="bind-tab">绑定到本页面</button>`)
        : '<span style="color:#bbb;">未选择便签页</span>'}
    `;
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
    // 一页 = 一篇可编辑文章
    body.innerHTML = `
      <div class="nr-article-wrap">
        <textarea class="nr-article" id="${WRAPPER_ID}-article" placeholder="开始写…" spellcheck="false">${escHtml(page.content || '')}</textarea>
      </div>
    `;
    bindArticleEditor();
    setStatus(`${page.content?.length || 0} 字符`, '已加载');
  }

  // 文章编辑器：input → 自动保存
  function bindArticleEditor() {
    const article = panel.querySelector('#' + WRAPPER_ID + '-article');
    if (!article || article._bound) return;
    article._bound = true;
    article.addEventListener('input', () => {
      if (!currentPageId) return;
      setStatus(`${article.value.length} 字符`, '保存中…', 'saving');
      scheduleContentSave(article.value);
    });
    article.addEventListener('keydown', (e) => {
      // Tab 缩进支持
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = article.selectionStart, en = article.selectionEnd;
        article.value = article.value.slice(0, s) + '  ' + article.value.slice(en);
        article.selectionStart = article.selectionEnd = s + 2;
        if (currentPageId) scheduleContentSave(article.value);
      }
      e.stopPropagation();
    });
  }

  let _contentSaveTimer = null;
  function scheduleContentSave(content) {
    if (_contentSaveTimer) clearTimeout(_contentSaveTimer);
    _contentSaveTimer = setTimeout(() => doContentSave(content), 500);
  }

  async function flushContentSave() {
    if (!_contentSaveTimer) return;
    clearTimeout(_contentSaveTimer);
    _contentSaveTimer = null;
    const article = panel?.querySelector('#' + WRAPPER_ID + '-article');
    if (article && currentPageId) {
      await doContentSave(article.value);
    }
  }

  async function doContentSave(content) {
    if (!currentPageId) return;
    await chrome.runtime.sendMessage({
      action: 'updateNoteContent',
      id: currentPageId,
      content: content || ''
    });
    setStatus(`${content.length} 字符`, '已保存', 'saved');
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
    // 定位:锚定在标题栏 switcher 下方
    const switcher = panel?.querySelector('.nr-switcher');
    if (switcher) {
      const r = switcher.getBoundingClientRect();
      picker.style.left = Math.max(8, r.left) + 'px';
      picker.style.top = (r.bottom + 4) + 'px';
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
      // 聚焦文章编辑器(不是不存在的 input)
      setTimeout(() => {
        const article = panel.querySelector('#' + WRAPPER_ID + '-article');
        if (article) article.focus();
      }, 80);
    } else {
      document.querySelector('[data-note-picker]')?.classList.remove('open');
    }
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
          case 'rename-current-page': return renameCurrentPage();
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
    if (_contentSaveTimer && currentPageId && panel) {
      const article = panel.querySelector('#' + WRAPPER_ID + '-article');
      if (article && article.value) {
        chrome.runtime.sendMessage({
          action: 'updateNoteContent',
          id: currentPageId,
          content: article.value
        });
      }
      clearTimeout(_contentSaveTimer);
      _contentSaveTimer = null;
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

  // ESC 收起（先关 picker,再收面板）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isExpanded && panel) {
      const picker = document.querySelector('[data-note-picker]');
      if (picker?.classList.contains('open')) {
        picker.classList.remove('open');
        return;
      }
      const article = panel.querySelector('#' + WRAPPER_ID + '-article');
      if (document.activeElement === article) return;
      setExpanded(false);
    }
  });

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
      // 页面列表变了(新建/重命名/绑定变化) → 只刷 picker + header
      renderHeader();
      renderPicker();
      renderTabHint();
    }
    // 内容变化不打断编辑器
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