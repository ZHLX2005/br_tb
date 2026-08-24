/**
 * Goto Manager Sidebar — goto 数据管理圆环 (Mode A Ring-Stack Entry)
 *
 * 预览所有 goto=true 的 group 完整 tab 列表,支持 CRUD:
 * - 新建 goto 分组(并标记为 goto)
 * - 取消 group 的 goto 标志
 * - 重命名 group
 * - 删除 group(带 confirm)
 * - 删除 group 内的 tab
 * - 快速添加当前 tab 到指定 goto 分组
 *
 * 数据全部走消息→ background/group-model.js(领域模型),本文件不直接读 chrome.storage.local.get/set。
 * 受 settings.ringSidebarEnabled(总开关) + settings.showGotoManagerSidebar(子开关)双守卫控制。
 */
(function () {
  'use strict';

  // === 常量(改 4 处)===
  const WRAPPER_ID = 'tabboard-goto-manager-sidebar';
  const ACCENT = '#42a5f5';
  const N = 4;                       // defaultOrder: manifest 中 ring 顺序(去掉协调器/拖动模块)— LC=0, VP=1, Capture=2, Speed=3, gotoManager=4
  const RING_ID = 'gotoManager';     // 全局唯一 ring id
  // ===================

  const STYLES = `
    :host {
      position: fixed; top: 50%; right: 0;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --accent: ${ACCENT};
    }
    /* 双 CSS 变量:trigger 与 panel 同 calc,与 ring-order / draggable-ring 协同 */
    /* 侧边栏 ★ trigger 尺寸固定 40px(不再跟随悬浮圆环大小设置) */
    #${WRAPPER_ID}-trigger {
      width: 40px; height: 40px;
      border-radius: 50%; background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      position: fixed;
      top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0));
      right: -16px;
      transform: translateY(-50%);
      opacity: 0; pointer-events: none;
      transition: right 220ms ease, opacity 180ms ease, box-shadow 200ms;
      border: 1px solid rgba(0,0,0,0.06);
    }
    :host(.near) #${WRAPPER_ID}-trigger,
    #${WRAPPER_ID}-trigger:hover {
      right: 8px; opacity: 1; pointer-events: auto;
    }
    /* panel 展开时 trigger 保持可见:用户点 size-btn 时鼠标离开 trigger,不能让它消失 */
    :host(.expanded) #${WRAPPER_ID}-trigger {
      right: 8px; opacity: 1; pointer-events: auto;
    }
    #${WRAPPER_ID}-trigger:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.22); }
    #${WRAPPER_ID}-trigger-badge {
      position: absolute; top: -2px; right: -2px;
      background: var(--accent); color: white;
      font-size: 10px; font-weight: 700;
      min-width: 16px; height: 16px; line-height: 16px;
      border-radius: 8px; padding: 0 4px;
      box-sizing: border-box; text-align: center;
    }

    #${WRAPPER_ID}-panel {
      position: fixed;
      top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0));
      right: 8px;
      transform: translate(10px, -50%);
      width: 320px; max-height: 70vh;
      background: white; border-radius: 10px;
      box-shadow: -2px 4px 20px rgba(0,0,0,0.18);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s linear 240ms;
      display: flex; flex-direction: column;
      font-size: 12px; color: #333;
    }
    :host(.expanded) #${WRAPPER_ID}-panel {
      opacity: 1; visibility: visible; pointer-events: auto;
      transform: translate(-56px, -50%);
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s;
    }

    /* 面板内部 */
    .gm-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 12px; border-bottom: 1px solid #eee; flex-shrink: 0;
    }
    .gm-title { font-weight: 700; font-size: 13px; color: #1a1a1a; }
    /* header 右侧的操作组:设置 ⚙ + 关闭 ×,语义统一,5px gap */
    .gm-header-actions {
      display: flex; align-items: center; gap: 5px;
    }
    .gm-close {
      background: none; border: none; cursor: pointer;
      font-size: 18px; color: #888; padding: 0 4px; line-height: 1;
    }
    .gm-close:hover { color: #333; }
    .gm-toolbar {
      display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #eee; flex-shrink: 0;
    }
    .gm-btn {
      flex: 1; padding: 6px 8px; background: white;
      border: 1px solid #ddd; border-radius: 5px;
      cursor: pointer; font-size: 11px; color: #555;
      transition: background 120ms, border-color 120ms;
    }
    .gm-btn:hover { background: #f5f5f5; border-color: #bbb; }
    .gm-btn-primary {
      background: var(--accent); color: white; border-color: var(--accent);
    }
    .gm-btn-primary:hover { background: #1e88e5; border-color: #1e88e5; }
    .gm-btn-active {
      background: var(--accent); color: white; border-color: var(--accent);
    }

    .gm-section {
      padding: 8px 12px; border-bottom: 1px solid #eee;
      background: #fafafa; flex-shrink: 0;
    }
    .gm-section-title {
      font-size: 11px; font-weight: 600; color: #666; margin-bottom: 6px;
    }
    .gm-add-current-list {
      max-height: 140px; overflow-y: auto;
    }
    .gm-add-current-item {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 8px; margin: 2px 0;
      border-radius: 4px; cursor: pointer;
      transition: background 120ms;
    }
    .gm-add-current-item:hover { background: #eee; }
    .gm-add-current-item-empty {
      padding: 8px; color: #999; font-size: 11px; text-align: center;
    }
    .gm-new-group-row { display: flex; gap: 6px; }
    .gm-new-group-input {
      flex: 1; padding: 5px 8px;
      border: 1px solid #ddd; border-radius: 4px;
      font-size: 11px; font-family: inherit;
    }
    .gm-new-group-input:focus { outline: none; border-color: var(--accent); }

    .gm-list {
      flex: 1; overflow-y: auto; padding: 4px 0;
    }
    .gm-empty {
      padding: 24px 12px; text-align: center; color: #999; font-size: 12px;
    }
    .gm-group {
      border-bottom: 1px solid #f0f0f0;
    }
    .gm-group:last-child { border-bottom: none; }
    .gm-group-header {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 12px; cursor: pointer;
      transition: background 120ms;
    }
    .gm-group-header:hover { background: #f8f8f8; }
    .gm-dot {
      width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    }
    .gm-group-name {
      flex: 1; font-weight: 500; color: #1a1a1a;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      min-width: 0;
    }
    .gm-rename-input {
      flex: 1; padding: 2px 4px;
      border: 1px solid var(--accent); border-radius: 3px;
      font-size: 12px; font-family: inherit; color: #1a1a1a;
      min-width: 0;
    }
    .gm-rename-input:focus { outline: none; }
    .gm-group-count {
      font-size: 10px; color: #999; flex-shrink: 0;
    }
    .gm-toggle {
      font-size: 10px; color: #999; flex-shrink: 0; width: 12px;
    }
    .gm-icon-btn {
      background: none; border: none; cursor: pointer;
      font-size: 13px; color: #888; padding: 2px 4px;
      border-radius: 3px; line-height: 1; flex-shrink: 0;
    }
    .gm-icon-btn:hover { background: #eee; color: #333; }
    .gm-icon-btn-danger:hover { background: #fee; color: #c33; }

    .gm-group-tabs {
      background: #fafafa; padding: 4px 0 6px;
    }
    .gm-tab {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 12px 5px 28px;
      font-size: 11px; color: #555;
    }
    .gm-tab:hover { background: #f0f0f0; }
    .gm-tab-title {
      flex: 1; cursor: pointer; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
      color: #1a1a1a;
    }
    .gm-tab-title:hover { color: var(--accent); text-decoration: underline; }
    .gm-tab-empty {
      padding: 6px 28px; font-size: 11px; color: #999; font-style: italic;
    }

    /* inline confirm 模态 */
    .gm-confirm-overlay {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.4); z-index: 10;
      display: flex; align-items: center; justify-content: center;
      border-radius: 10px;
    }
    .gm-confirm-box {
      background: white; border-radius: 8px;
      padding: 14px; width: 240px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .gm-confirm-msg {
      font-size: 12px; color: #333; margin-bottom: 12px;
      line-height: 1.4;
    }
    .gm-confirm-actions {
      display: flex; gap: 8px; justify-content: flex-end;
    }

    /* 滚动条样式 */
    .gm-list::-webkit-scrollbar, .gm-add-current-list::-webkit-scrollbar { width: 6px; }
    .gm-list::-webkit-scrollbar-thumb, .gm-add-current-list::-webkit-scrollbar-thumb {
      background: #ccc; border-radius: 3px;
    }

    /* ─── 圆环设置 section ─── */
    .gm-settings-row { margin-bottom: 10px; }
    .gm-settings-row:last-child { margin-bottom: 0; }
    .gm-settings-label {
      font-size: 11px; font-weight: 600; color: #666; margin-bottom: 6px;
    }
    .gm-size-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }
    .gm-size-btn {
      padding: 6px 4px;
      background: white; border: 1px solid #ddd; border-radius: 5px;
      cursor: pointer; font-size: 11px; color: #555;
      display: flex; flex-direction: column; align-items: center; gap: 3px;
      transition: background 120ms, border-color 120ms, transform 100ms;
    }
    .gm-size-btn:hover { background: #f5f5f5; border-color: #bbb; }
    .gm-size-btn:active { transform: scale(0.95); }
    .gm-size-btn.active {
      background: var(--accent); color: white; border-color: var(--accent);
    }
    .gm-size-btn-preview {
      width: 16px; height: 16px; border-radius: 50%;
      background: currentColor; opacity: 0.7;
    }
    .gm-size-btn[data-size="xxs"] .gm-size-btn-preview { width: 7px; height: 7px; }
    .gm-size-btn[data-size="xs"] .gm-size-btn-preview { width: 10px; height: 10px; }
    .gm-size-btn[data-size="sm"] .gm-size-btn-preview { width: 13px; height: 13px; }
    .gm-size-btn[data-size="md"] .gm-size-btn-preview { width: 16px; height: 16px; }
    .gm-size-btn[data-size="lg"] .gm-size-btn-preview { width: 19px; height: 19px; }
    .gm-size-btn[data-size="xl"] .gm-size-btn-preview { width: 22px; height: 22px; }

    /* 悬浮 goto 圆环背景 */
    .gm-bg-status {
      font-size: 11px; color: #555;
      padding: 6px 8px; background: white;
      border: 1px solid #ddd; border-radius: 5px;
      margin-bottom: 6px;
    }
    .gm-bg-actions {
      display: flex; gap: 6px;
    }
    .gm-bg-error {
      font-size: 11px; color: #c33; margin-top: 4px;
    }
  `;

  let menuData = [];   // 缓存 getGotoGroupsFull 返回值
  let isExpanded = false;

  // ─── 悬浮 goto 圆环个性化设置状态(由 background ring-settings.js 权威维护) ───
  // 本文件只是"设置面板",控制右下角 #tabboard-goto-ring-circle;侧边栏自己的 ★ trigger 大小恒定不变。
  let ringSize = 'md';
  // 悬浮圆环背景:null = 默认(☰ 显示),{type:'custom',data} = 已上传(背景图生效 + ☰ 隐藏)
  let floatingRingBg = null;

  // 悬浮圆环尺寸映射(与 background/ring-settings.js RING_SIZE_PX 保持一致)
  const RING_SIZE_PX = { xxs: 24, xs: 32, sm: 48, md: 60, lg: 72, xl: 84 };

  // ─── 工具:发送消息到后台(领域 API) ───
  async function send(action, payload) {
    try {
      return await chrome.runtime.sendMessage({ action, ...(payload || {}) });
    } catch (err) {
      console.warn('[GotoManager] sendMessage failed:', err);
      return null;
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  // ─── 圆环设置:刷新设置面板 UI(state → DOM) ───
  // 注意:本面板控制的是悬浮 goto 圆环(goto.js),不是侧边栏自身 trigger,
  // 因此这里只更新面板内的控件状态,不动侧边栏 ★ trigger。
  function renderSettingsUI() {
    const shadow = getShadow();
    if (!shadow) return;
    // size grid active
    shadow.querySelectorAll('.gm-size-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === ringSize);
    });
    // size current label(显示悬浮圆环目标像素值)
    const sizeCurrentEl = shadow.getElementById(WRAPPER_ID + '-size-current');
    if (sizeCurrentEl) sizeCurrentEl.textContent = (RING_SIZE_PX[ringSize] || 60) + 'px';
    // floating bg status
    const floatingStatusEl = shadow.getElementById(WRAPPER_ID + '-floating-bg-status');
    if (floatingStatusEl) {
      if (floatingRingBg && floatingRingBg.data) {
        const kb = Math.round(floatingRingBg.data.length / 1024);
        floatingStatusEl.textContent = `已选择图片(约 ${kb} KB),☰ 图标已隐藏`;
      } else {
        floatingStatusEl.textContent = '未选择图片(默认显示 ☰)';
      }
    }
  }

  // ─── 圆环设置:从后台拉悬浮圆环设置(size + bg) ───
  async function loadRingSettings() {
    const res = await send('getGotoRingSettings');
    if (res && res.success) {
      ringSize = res.size || 'md';
      floatingRingBg = res.bg || null;
      renderSettingsUI();
    }
  }

  // ─── 图片压缩:96x96 cover 裁剪 → PNG base64 ───
  async function compressTo96Cover(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const scale = Math.max(96 / img.width, 96 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (96 - w) / 2, (96 - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  }

  // ─── shadow DOM 查询辅助 ───
  function getShadow() {
    const w = document.getElementById(WRAPPER_ID);
    return w && w.shadowRoot;
  }

  // ─── panel 渲染 ───
  function renderPanel() {
    const shadow = getShadow();
    if (!shadow) return;
    const listEl = shadow.getElementById(WRAPPER_ID + '-list');
    const emptyEl = shadow.getElementById(WRAPPER_ID + '-empty');
    const badgeEl = shadow.getElementById(WRAPPER_ID + '-trigger-badge');
    if (!listEl) return;

    const totalGroups = menuData.length;
    if (badgeEl) {
      badgeEl.textContent = totalGroups > 99 ? '99+' : String(totalGroups);
      badgeEl.style.display = totalGroups > 0 ? '' : 'none';
    }

    if (totalGroups === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    // 缓存展开状态(在 rebuild 时保留)
    const expandedGroups = new Set();
    shadow.querySelectorAll('.gm-group-tabs:not([hidden])').forEach(el => {
      expandedGroups.add(el.dataset.groupId);
    });

    listEl.innerHTML = menuData.map(g => {
      const expanded = expandedGroups.has(g.id);
      return `
        <div class="gm-group" data-group-id="${escapeHtml(g.id)}">
          <div class="gm-group-header">
            <span class="gm-toggle">${expanded ? '▾' : '▸'}</span>
            <span class="gm-dot" style="background: ${escapeHtml(g.color || '#ccc')}"></span>
            <span class="gm-group-name" data-action="rename">${escapeHtml(g.name || '(未命名)')}</span>
            <span class="gm-group-count">${g.tabs.length} 个</span>
            <button class="gm-icon-btn" data-action="unset-goto" title="取消 goto 标记">★</button>
            <button class="gm-icon-btn gm-icon-btn-danger" data-action="delete-group" title="删除分组">×</button>
          </div>
          <div class="gm-group-tabs" data-group-id="${escapeHtml(g.id)}" ${expanded ? '' : 'hidden'}>
            ${g.tabs.length === 0
              ? '<div class="gm-tab-empty">(无 tab)</div>'
              : g.tabs.map(t => `
                <div class="gm-tab" data-tab-id="${escapeHtml(t.id)}">
                  <span class="gm-tab-title" data-action="open-tab" data-url="${escapeHtml(t.url)}" title="${escapeHtml(t.url)}">${escapeHtml(t.title || t.url)}</span>
                  <button class="gm-icon-btn gm-icon-btn-danger" data-action="delete-tab" title="删除">×</button>
                </div>
              `).join('')
            }
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── 拉数据 + 渲染 ───
  let loadSeq = 0;
  async function loadAndRender() {
    const seq = ++loadSeq;
    const res = await send('getGotoGroupsFull');
    if (seq !== loadSeq) return; // 过期请求,忽略
    if (!res || !res.success) {
      menuData = [];
    } else {
      menuData = res.menu || [];
    }
    renderPanel();
  }

  // ─── build / remove ───
  function build() {
    if (document.getElementById(WRAPPER_ID)) return;

    const wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    const shadow = wrapper.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    shadow.appendChild(styleEl);

    const trigger = document.createElement('div');
    trigger.id = WRAPPER_ID + '-trigger';
    trigger.title = 'goto 管理';
    trigger.innerHTML = `<span style="font-size:14px;font-weight:700;color:${ACCENT}">★</span><span id="${WRAPPER_ID}-trigger-badge" style="display:none">0</span>`;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      isExpanded = !isExpanded;
      wrapper.classList.toggle('expanded', isExpanded);
    });
    shadow.appendChild(trigger);

    const panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';
    panel.innerHTML = `
      <div class="gm-header">
        <span class="gm-title">goto 管理</span>
        <div class="gm-header-actions">
          <button class="gm-icon-btn" data-action="open-settings" title="圆环设置">⚙</button>
          <button class="gm-close" data-action="close">×</button>
        </div>
      </div>
      <div class="gm-toolbar">
        <button class="gm-btn" data-action="toggle-add-current">+ 当前 tab</button>
        <button class="gm-btn" data-action="toggle-new-group">+ 新建 goto 分组</button>
      </div>
      <div class="gm-section" data-section="add-current" hidden>
        <div class="gm-section-title">选择目标 goto 分组</div>
        <div class="gm-add-current-list" id="${WRAPPER_ID}-add-current-list"></div>
      </div>
      <div class="gm-section" data-section="new-group" hidden>
        <div class="gm-section-title">新建并标记为 goto</div>
        <div class="gm-new-group-row">
          <input type="text" class="gm-new-group-input" id="${WRAPPER_ID}-new-group-input" placeholder="分组名称(回车创建)" maxlength="50">
          <button class="gm-btn gm-btn-primary" data-action="submit-new-group">创建</button>
        </div>
      </div>
      <div class="gm-section" data-section="ring-settings">
        <div class="gm-section-title">悬浮 goto 圆环设置</div>
        <div class="gm-settings-row">
          <div class="gm-settings-label">大小(<span id="${WRAPPER_ID}-size-current">60px</span>)</div>
          <div class="gm-size-grid" id="${WRAPPER_ID}-size-grid">
            <button class="gm-size-btn" data-size="xxs"><span class="gm-size-btn-preview"></span>微型 24</button>
            <button class="gm-size-btn" data-size="xs"><span class="gm-size-btn-preview"></span>特小 32</button>
            <button class="gm-size-btn" data-size="sm"><span class="gm-size-btn-preview"></span>小 48</button>
            <button class="gm-size-btn" data-size="md"><span class="gm-size-btn-preview"></span>默认 60</button>
            <button class="gm-size-btn" data-size="lg"><span class="gm-size-btn-preview"></span>大 72</button>
            <button class="gm-size-btn" data-size="xl"><span class="gm-size-btn-preview"></span>特大 84</button>
          </div>
        </div>
        <div class="gm-settings-row">
          <div class="gm-settings-label">悬浮 goto 圆环背景</div>
          <div class="gm-bg-status" id="${WRAPPER_ID}-floating-bg-status">未选择图片(默认显示 ☰)</div>
          <div class="gm-bg-actions">
            <button class="gm-btn" data-action="upload-floating-bg">上传图片</button>
            <button class="gm-btn" data-action="reset-floating-bg">恢复默认</button>
            <input type="file" id="${WRAPPER_ID}-floating-bg-input" accept="image/*" hidden>
          </div>
          <div class="gm-bg-error" id="${WRAPPER_ID}-floating-bg-error" hidden></div>
        </div>
      </div>
      <div class="gm-list" id="${WRAPPER_ID}-list"></div>
      <div class="gm-empty" id="${WRAPPER_ID}-empty" hidden>暂无 goto 分组,点 "+ 新建 goto 分组" 开始</div>
    `;
    shadow.appendChild(panel);

    document.body.appendChild(wrapper);

    // ── 委托事件 ──
    panel.addEventListener('click', onPanelClick);
    console.log('[GotoManager] build: panel click listener registered');

    // ── header 点击 + rename 入口(list 元素上独立监听) ──
    bindHeaderClicks();

    // ── 新建分组输入框:回车提交 ──
    const newGroupInput = shadow.getElementById(WRAPPER_ID + '-new-group-input');
    newGroupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCreateNewGroup();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        toggleSection('new-group', false);
      }
    });

    // ── 可选:启用拖动(与其他 ring 一致)──
    window.__tabboardRingDrag?.attach(
      shadow.getElementById(WRAPPER_ID + '-trigger'),
      shadow.getElementById(WRAPPER_ID + '-panel'),
      wrapper,
      { defaultOrder: N, ringId: RING_ID }
    );

    // ── 注册到 ring-order 协调器,参与自动补位 ──
    window.__tabboardRingOrder?.register({
      ringId: RING_ID,
      host: wrapper,
      defaultOrder: N,
      isAlive: () => {
        if (!document.getElementById(WRAPPER_ID)) return false;
        const s = window.__tabboardRingOrder.getLastSettings();
        if (!s) return true;
        return s.ringSidebarEnabled !== false && s.showGotoManagerSidebar !== false;
      }
    });

    // ── 圆环设置:file input change 处理(其他点击走 onPanelClick 委托) ──
    const floatingInput = shadow.getElementById(WRAPPER_ID + '-floating-bg-input');
    if (floatingInput) {
      floatingInput.addEventListener('change', handleFloatingBgSelected);
    }

    // ── 拉首屏数据 ──
    loadAndRender();
    // 圆环个性化设置(size + floating bg)
    loadRingSettings();
  }

  function removeSidebar() {
    const w = document.getElementById(WRAPPER_ID);
    if (w) {
      const shadow = w.shadowRoot;
      if (shadow) {
        const panel = shadow.getElementById(WRAPPER_ID + '-panel');
        if (panel) panel.removeEventListener('click', onPanelClick);
      }
      w.remove();
    }
    isExpanded = false;
  }

  // ─── 委托事件处理 ───
  function onPanelClick(e) {
    // 区分两个概念:
    //   actionTarget — 最近带 data-action 的祖先,用来判断"做什么动作"
    //   e.target     — 原始事件目标(size-btn / gm-tab 等独立元素可能没有 data-action,但要响应点击)
    // 之前用同一个 target,导致 target 为 null 时后续 .closest 抛 TypeError。
    const actionTarget = e.target.closest('[data-action]');
    const action = actionTarget && actionTarget.dataset.action;
    console.log('[GotoManager] onPanelClick', { target: e.target.tagName + '#' + e.target.id, class: e.target.className, action });

    if (action === 'close') {
      isExpanded = false;
      const w = document.getElementById(WRAPPER_ID);
      if (w) w.classList.remove('expanded');
      return;
    }

    if (action === 'toggle-add-current') {
      const opening = !isSectionOpen('add-current');
      toggleSection('add-current', opening);
      if (opening) populateAddCurrentList();
      return;
    }

    if (action === 'toggle-new-group') {
      const opening = !isSectionOpen('new-group');
      toggleSection('new-group', opening);
      if (opening) {
        const shadow = getShadow();
        const input = shadow?.getElementById(WRAPPER_ID + '-new-group-input');
        if (input) setTimeout(() => input.focus(), 50);
      }
      return;
    }

    if (action === 'submit-new-group') {
      handleCreateNewGroup();
      return;
    }

    if (action === 'open-settings') {
      const opening = !isSectionOpen('ring-settings');
      toggleSection('ring-settings', opening);
      return;
    }

    if (action === 'upload-floating-bg') {
      const shadow = getShadow();
      const input = shadow?.getElementById(WRAPPER_ID + '-floating-bg-input');
      if (input) input.click();
      return;
    }

    if (action === 'reset-floating-bg') {
      handleResetFloatingBg();
      return;
    }

    // size-btn(没有 data-action,直接从 e.target 找)
    const sizeBtn = e.target.closest('.gm-size-btn');
    if (sizeBtn && sizeBtn.dataset.size) {
      handleSizeClick(sizeBtn.dataset.size);
      return;
    }

    // group 折叠/展开(点击 header 空白处)
    if (action === 'rename') {
      // 由 startRename 处理,见下方
      return;
    }

    const groupEl = e.target.closest('.gm-group');
    if (!groupEl) return;
    const groupId = groupEl.dataset.groupId;

    if (action === 'toggle-tabs' || (actionTarget && actionTarget.classList.contains('gm-group-header') && !actionTarget.dataset.action)) {
      toggleGroupExpanded(groupId);
      return;
    }

    if (action === 'unset-goto') {
      e.stopPropagation();
      handleUnsetGoto(groupId);
      return;
    }

    if (action === 'delete-group') {
      e.stopPropagation();
      handleDeleteGroup(groupId, groupEl);
      return;
    }

    // tab 级别
    const tabEl = e.target.closest('.gm-tab');
    if (tabEl) {
      const tabId = tabEl.dataset.tabId;
      if (action === 'open-tab') {
        const url = target.dataset.url;
        if (url) send('openTab', { url });
        return;
      }
      if (action === 'delete-tab') {
        e.stopPropagation();
        handleDeleteTab(groupId, tabId);
        return;
      }
    }
  }

  // ─── group header 点击 ───
  // 上面委托里 toggle-tabs / header 点击需要单独处理(因为 header 没有 data-action)
  // 这里用 capture 阶段单独捕获
  function bindHeaderClicks() {
    const shadow = getShadow();
    if (!shadow) return;
    const list = shadow.getElementById(WRAPPER_ID + '-list');
    if (!list) return;
    list.addEventListener('click', (e) => {
      const header = e.target.closest('.gm-group-header');
      if (!header) return;
      // 如果点击的是有 data-action 的子元素(icon-btn / rename),交给委托处理
      if (e.target.closest('[data-action]')) return;
      const groupEl = header.closest('.gm-group');
      if (groupEl) toggleGroupExpanded(groupEl.dataset.groupId);
    });

    // rename:点击名字 → 切换到 input
    list.addEventListener('click', (e) => {
      const renameEl = e.target.closest('[data-action="rename"]');
      if (!renameEl) return;
      const groupEl = renameEl.closest('.gm-group');
      if (!groupEl) return;
      e.stopPropagation();
      startRename(groupEl.dataset.groupId, renameEl);
    });
  }

  // 在 build 末尾注册上面两个监听器
  // (此处用 shadow 内的 list 元素,所以在 build() 内部调用更安全)

  // ─── 内部操作 ───
  function toggleGroupExpanded(groupId) {
    const shadow = getShadow();
    if (!shadow) return;
    const tabsEl = shadow.querySelector(`.gm-group-tabs[data-group-id="${CSS.escape(groupId)}"]`);
    const header = shadow.querySelector(`.gm-group[data-group-id="${CSS.escape(groupId)}"] .gm-toggle`);
    if (!tabsEl) return;
    const expanded = tabsEl.hasAttribute('hidden');
    if (expanded) {
      tabsEl.removeAttribute('hidden');
      if (header) header.textContent = '▾';
    } else {
      tabsEl.setAttribute('hidden', '');
      if (header) header.textContent = '▸';
    }
  }

  function isSectionOpen(name) {
    const shadow = getShadow();
    if (!shadow) return false;
    const sec = shadow.querySelector(`.gm-section[data-section="${name}"]`);
    return sec && !sec.hasAttribute('hidden');
  }

  function toggleSection(name, open) {
    const shadow = getShadow();
    if (!shadow) return;
    const sec = shadow.querySelector(`.gm-section[data-section="${name}"]`);
    if (sec) {
      if (open) sec.removeAttribute('hidden');
      else sec.setAttribute('hidden', '');
    }
    const btn = shadow.querySelector(`.gm-toolbar [data-action="toggle-${name}"]`);
    if (btn) btn.classList.toggle('gm-btn-active', open);
  }

  function populateAddCurrentList() {
    const shadow = getShadow();
    if (!shadow) return;
    const list = shadow.getElementById(WRAPPER_ID + '-add-current-list');
    if (!list) return;
    if (menuData.length === 0) {
      list.innerHTML = '<div class="gm-add-current-item-empty">暂无 goto 分组,请先创建</div>';
      return;
    }
    list.innerHTML = menuData.map(g => `
      <div class="gm-add-current-item" data-action="add-current-to" data-group-id="${escapeHtml(g.id)}">
        <span class="gm-dot" style="background: ${escapeHtml(g.color || '#ccc')}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.name)}</span>
        <span style="font-size:10px;color:#999">${g.tabs.length}</span>
      </div>
    `).join('');
    // 委托
    list.onclick = async (e) => {
      const item = e.target.closest('[data-action="add-current-to"]');
      if (!item) return;
      await handleAddCurrentTab(item.dataset.groupId);
    };
  }

  async function handleAddCurrentTab(groupId) {
    try {
      // content script 无 chrome.tabs 权限 → 走后台 getActiveTabInfo(sender.tab 拿到所在 tab)
      const tabRes = await send('getActiveTabInfo');
      const tab = tabRes && tabRes.success ? tabRes : null;
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        console.warn('[GotoManager] current tab is not addable');
        return;
      }
      const res = await send('addTab', {
        tab: { title: tab.title || tab.url, url: tab.url, favicon: tab.favicon || '' },
        groupId
      });
      if (res?.success) {
        toggleSection('add-current', false);
        await loadAndRender();
      }
    } catch (err) {
      console.warn('[GotoManager] addCurrentTab failed:', err);
    }
  }

  async function handleCreateNewGroup() {
    const shadow = getShadow();
    if (!shadow) return;
    const input = shadow.getElementById(WRAPPER_ID + '-new-group-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    // 默认颜色循环
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7', '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'];
    const color = colors[menuData.length % colors.length];
    const addRes = await send('addGroup', { name, color });
    if (addRes?.success && addRes.groupId) {
      await send('setGroupAsGoto', { groupId: addRes.groupId });
      input.value = '';
      toggleSection('new-group', false);
      await loadAndRender();
    }
  }

  async function handleUnsetGoto(groupId) {
    const target = menuData.find(g => g.id === groupId);
    if (!target) return;
    // 取消 goto:setGroupAsGoto toggle
    await send('setGroupAsGoto', { groupId });
    await loadAndRender();
  }

  function handleDeleteGroup(groupId, groupEl) {
    const target = menuData.find(g => g.id === groupId);
    if (!target) return;
    const shadow = getShadow();
    if (!shadow) return;
    // inline confirm
    const overlay = document.createElement('div');
    overlay.className = 'gm-confirm-overlay';
    overlay.innerHTML = `
      <div class="gm-confirm-box">
        <div class="gm-confirm-msg">确定删除分组「${escapeHtml(target.name)}」吗?<br>该分组内的所有 tab 也会被删除。</div>
        <div class="gm-confirm-actions">
          <button class="gm-btn" data-action="cancel">取消</button>
          <button class="gm-btn gm-btn-primary" data-action="confirm">删除</button>
        </div>
      </div>
    `;
    const panel = shadow.getElementById(WRAPPER_ID + '-panel');
    panel.appendChild(overlay);
    const cleanup = () => overlay.remove();
    overlay.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-action]')?.dataset.action;
      if (a === 'cancel') {
        cleanup();
      } else if (a === 'confirm') {
        cleanup();
        const res = await send('deleteGroup', { groupId });
        if (res?.success) await loadAndRender();
      }
    });
  }

  async function handleDeleteTab(groupId, tabId) {
    const res = await send('deleteTab', { groupId, tabId });
    if (res?.success) await loadAndRender();
  }

  // ─── 圆环设置:size 按钮点击(控制悬浮 goto 圆环) ───
  async function handleSizeClick(size) {
    if (size !== ringSize) {
      ringSize = size; // 本地先更新,立即给用户反馈
      send('updateGotoRingSize', { size }).then(res => {
        if (res && res.success) {
          console.log('[GotoManager] 悬浮圆环 size →', res.size);
        } else {
          console.warn('[GotoManager] size sync failed:', res?.error);
        }
      });
    }
    renderSettingsUI();
  }

  // ─── 圆环设置:悬浮 goto 圆环背景 ───
  // 上传 → 5MB 前置检查 → 96x96 cover 压缩 → 200KB 上限 → 写 storage
  // 写入后由 chrome.storage.onChanged 推送给所有 tab 的 goto.js,后者将 ☰ 图标隐藏(圆环本体仍显示)
  async function handleFloatingBgSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const shadow = getShadow();
    const errEl = shadow?.getElementById(WRAPPER_ID + '-floating-bg-error');
    // 5MB 前置压缩前检查
    if (file.size > 5 * 1024 * 1024) {
      if (errEl) { errEl.textContent = '图片太大,请选择 5MB 以内的图片'; errEl.hidden = false; }
      e.target.value = '';
      return;
    }
    try {
      const base64 = await compressTo96Cover(file);
      if (base64.length > 250 * 1024) {
        if (errEl) { errEl.textContent = '压缩后仍超过 200KB,请选择更小的图片'; errEl.hidden = false; }
        e.target.value = '';
        return;
      }
      const res = await send('updateGotoRingBg', { bg: { type: 'custom', data: base64 } });
      if (res?.success) {
        floatingRingBg = res.bg;
        if (errEl) errEl.hidden = true;
        renderSettingsUI();
      } else {
        if (errEl) { errEl.textContent = '保存失败: ' + (res?.error || '未知错误'); errEl.hidden = false; }
      }
    } catch (err) {
      console.warn('[GotoManager] floating bg upload failed:', err);
      if (errEl) { errEl.textContent = '图片处理失败,请尝试其他图片'; errEl.hidden = false; }
    } finally {
      e.target.value = '';
    }
  }

  // 恢复默认:清除 bg,悬浮 goto 圆环 circle 重新显示
  async function handleResetFloatingBg() {
    const res = await send('updateGotoRingBg', { bg: null });
    if (res?.success) {
      floatingRingBg = null;
      const shadow = getShadow();
      const errEl = shadow?.getElementById(WRAPPER_ID + '-floating-bg-error');
      if (errEl) errEl.hidden = true;
      renderSettingsUI();
    }
  }

  function startRename(groupId, nameEl) {
    if (!nameEl || nameEl.tagName === 'INPUT') return;
    const shadow = getShadow();
    if (!shadow) return;
    const groupEl = shadow.querySelector(`.gm-group[data-group-id="${CSS.escape(groupId)}"]`);
    if (!groupEl) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gm-rename-input';
    input.value = nameEl.textContent;
    input.maxLength = 50;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = async (save) => {
      if (done) return;
      done = true;
      const newName = input.value.trim();
      if (save && newName) {
        await send('updateGroupName', { groupId, newName });
      }
      await loadAndRender();
    };
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
  }

  // ─── 双守卫 ───
  function shouldHide(s) {
    return s.ringSidebarEnabled === false || s.showGotoManagerSidebar === false;
  }

  // ─── init ───
  async function init() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'getSettings' });
      const s = res.success ? (res.settings || {}) : {};
      if (shouldHide(s)) return;
      build();
    } catch (err) {
      // Extension context may be invalid
    }
  }

  // ─── listeners ───
  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'local') return;
    if (changes.settings) {
      const s = changes.settings.newValue || {};
      // 悬浮圆环 size / bg 变化 → 刷新设置面板显示
      if (s.gotoRingSize !== undefined || s.gotoRingBg !== undefined) {
        loadRingSettings();
      }
      const el = document.getElementById(WRAPPER_ID);
      if (shouldHide(s)) {
        if (el) removeSidebar();
      } else {
        if (!el) build();
      }
    }
    // groups / tabs 变化 → 失效信号,重拉(去掉自己刚触发的 setTimeout 防回环:这里用 seq 防)
    if (changes.groups || changes.tabs) {
      if (document.getElementById(WRAPPER_ID)) {
        loadAndRender();
      }
    }
  });

  // 监听后台主动广播(setGroupAsGoto 等触发的 broadcastGotoRefresh)
  chrome.runtime.onMessage.addListener((request) => {
    if (request && request.action === 'refreshGotoRing') {
      if (document.getElementById(WRAPPER_ID)) {
        loadAndRender();
      }
    }
    return false;
  });

  // ─── outside-click 关闭(setTimeout 0 延一帧绑) ───
  function bindOutsideClick() {
    const onDocClick = (e) => {
      if (!isExpanded) return;
      const w = document.getElementById(WRAPPER_ID);
      if (!w) return;
      // shadow DOM 内的事件 retarget 到 host,w.contains(e.target) 仍成立
      if (w.contains(e.target)) return;
      isExpanded = false;
      w.classList.remove('expanded');
    };
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  }

  // ─── 入口 ───
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); bindOutsideClick(); });
  } else {
    init();
    bindOutsideClick();
  }
})();
