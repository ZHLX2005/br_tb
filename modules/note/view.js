/**
 * NoteView - 便签页视图（每页 = 一篇可编辑文章）
 *
 * UI 结构：
 *   ┌─────────────────────────────────────────────┐
 *   │  头部: 标题 + 统计                            │
 *   ├──────────────┬──────────────────────────────┤
 *   │  页面列表     │  当前页面文章编辑器          │
 *   │  + 新建       │   - 页面名 + 绑定 tab 列表   │
 *   │  □ page 1     │   - WYSIWYG contenteditable │
 *   │  □ page 2     │   - 自动保存                 │
 *   └──────────────┴──────────────────────────────┘
 *
 * 编辑器模型：contenteditable 混合编辑器（WYSIWYG）。
 * [[URL]] 占位渲染为图片块（note-img-block）；光标进入图片块时临时显示 [[URL]] 源码可编辑。
 * 与 content/noteRing.js 同源语义（各自维护一份，避免运行时依赖）。
 *
 * 注意：本模块（看板页 chrome-extension://）无视频宿主，无截帧按钮；
 *       登录态是模块级全局配置，统一收进 header 右上 gear popover（见 _buildHeader）。
 */

import { modal, toast } from '../../shared/ModalDialog.js';

const STORAGE_KEYS = ['notePages'];
const AUTOSAVE_DELAY = 600; // ms

class NoteView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.container = null;
    this.pages = [];
    this.activePageId = null;

    // 自动保存
    this._saveTimer = null;
    this._saveDirty = false;

    // WYSIWYG: 当前激活为源码态的图片块
    this._activeImgBlock = null;

    // 监听器引用
    this._listeners = [];
    this._onStorageChange = null;
  }

  setContainer(c) { this.container = c; }

  updateData(data) {
    this.pages = Array.isArray(data.notePages) ? data.notePages : [];
  }

  render() {
    if (!this.container) return;
    const self = this;
    chrome.storage.local.get(STORAGE_KEYS, (res) => {
      self.pages = Array.isArray(res.notePages) ? res.notePages : [];
      // 默认选第一个页面
      if (!self.activePageId || !self.pages.find(p => p.id === self.activePageId)) {
        self.activePageId = self.pages[0]?.id || null;
      }
      self._updateStats();
      self.container.innerHTML = self._buildHTML();
      self._wireListeners();
      self._wireContainerDelegation();
      self._wireEditor();
    });
  }

  _updateStats() {
    const stats = document.getElementById('stats');
    if (!stats) return;
    const totalChars = this.pages.reduce((sum, p) => sum + (p.content?.length || 0), 0);
    stats.textContent = `${this.pages.length} 个页面 · ${totalChars} 字符`;
  }

  // ========== HTML 构建 ==========

  _buildHTML() {
    return `
      <div class="note-shell">
        ${this._buildHeader()}
        <div class="note-body">
          ${this._buildPageList()}
          ${this._buildEditor()}
        </div>
      </div>
    `;
  }

  _buildHeader() {
    return `
      <div class="note-header">
        <div class="note-header-left">
          <h2>便签页</h2>
          <span class="note-header-sub">每页一篇独立文章</span>
        </div>
        <div class="note-header-actions">
          <button class="note-icon-btn" id="noteLoginGear" title="图床账号" aria-haspopup="true" aria-expanded="false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
          <div class="note-login-popover" id="noteLoginPopover" hidden>
            ${this._buildLoginPopoverBody()}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 图床账号 popover 内容（由 header gear 触发显示）。
   * 登录态是模块级全局配置，与单篇便签无关，故收进 header 而非每个 page 编辑器。
   * 元素 id 与原 <details> 方案保持一致，_wireUploadSettings/_uploadCredListener 无需改。
   */
  _buildLoginPopoverBody() {
    return `
      <div class="note-setting-status">
        <span class="note-login-pill" id="noteLoginPill">…</span>
        <button class="note-btn note-btn-secondary" id="noteLoginBtn">登录</button>
      </div>
      <div class="note-setting-row">
        <label>邮箱</label>
        <input type="text" id="noteUploadEmail" class="note-setting-input" placeholder="图床登录邮箱" autocomplete="off">
      </div>
      <div class="note-setting-row">
        <label>密码</label>
        <input type="password" id="noteUploadPassword" class="note-setting-input" placeholder="图床登录密码" autocomplete="off">
      </div>
      <div class="note-setting-row" style="justify-content:flex-end;">
        <span class="note-setting-hint" id="noteUploadHint"></span>
        <button class="note-btn note-btn-secondary" id="noteUploadSaveBtn">保存</button>
      </div>
    `;
  }

  _buildPageList() {
    return `
      <aside class="note-sidebar">
        <div class="note-sidebar-header">
          <span class="note-sidebar-title">页面</span>
          <button class="note-icon-btn note-icon-btn-primary" data-note-action="new-page" title="新建便签页">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
        <div class="note-page-list" id="notePageList">
          ${this.pages.length === 0 ? this._emptyPageListHtml() : this.pages.map(p => this._pageItemHtml(p)).join('')}
        </div>
      </aside>
    `;
  }

  _emptyPageListHtml() {
    return `<div class="note-page-empty">还没有便签页<br><span>点击右上角 + 新建</span></div>`;
  }

  _pageItemHtml(page) {
    const isActive = page.id === this.activePageId;
    const preview = (page.content || '').slice(0, 40).replace(/\n/g, ' ');
    const tabs = page.boundTabs || [];
    const favsHtml = tabs.slice(0, 3).map(t =>
      t.favicon ? `<img src="${this._escapeAttr(t.favicon)}" class="note-favicon" onerror="this.style.display='none'">` : ''
    ).join('');
    return `
      <div class="note-page-item ${isActive ? 'active' : ''}" data-page-id="${this._escapeAttr(page.id)}">
        <div class="note-page-item-main" data-note-action="select-page">
          <div class="note-page-item-name">${this._escapeHtml(page.name)}</div>
          ${preview ? `<div class="note-page-item-preview">${this._escapeHtml(preview)}${page.content.length > 40 ? '…' : ''}</div>` : ''}
          <div class="note-page-item-meta">
            ${favsHtml ? `<span class="note-page-item-favs">${favsHtml}</span>` : ''}
            <span class="note-page-item-time">${this._formatTimeShort(page.updatedAt)}</span>
          </div>
        </div>
        <div class="note-page-item-actions">
          <button class="note-icon-btn" data-note-action="rename-page" data-page-id="${this._escapeAttr(page.id)}" title="重命名">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
            </svg>
          </button>
          <button class="note-icon-btn note-icon-btn-danger" data-note-action="delete-page" data-page-id="${this._escapeAttr(page.id)}" title="删除">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  _buildEditor() {
    const page = this.pages.find(p => p.id === this.activePageId);
    if (!page) {
      return `
        <section class="note-editor">
          <div class="note-editor-empty">
            <div class="note-editor-empty-icon">📝</div>
            <div>选中左侧一个页面开始写作</div>
            <div style="font-size:11px;color:#aaa;margin-top:6px;">或在右上角新建一个便签页</div>
          </div>
        </section>
      `;
    }
    return `
      <section class="note-editor" data-page-id="${this._escapeAttr(page.id)}">
        <div class="note-editor-header">
          <input class="note-editor-title-input" id="notePageTitle" value="${this._escapeAttr(page.name)}" maxlength="40" placeholder="便签页名">
          <div class="note-editor-meta">
            <span id="noteEditorStatus">${(page.content?.length || 0)} 字符 · ${this._formatTimeShort(page.updatedAt)}</span>
          </div>
        </div>
        ${this._buildBoundTabs(page)}
        <div class="note-editor-content-wrap">
          <div class="note-editor-content" id="notePageContent" contenteditable="true" data-placeholder="开始写…" spellcheck="false"></div>
        </div>
      </section>
    `;
  }

  _buildBoundTabs(page) {
    const tabs = page.boundTabs || [];
    if (tabs.length === 0) {
      return `<div class="note-bound-empty">暂未关联标签页（关联由网页便签面板自动完成）</div>`;
    }
    return `
      <div class="note-bound">
        ${tabs.map(t => `
          <span class="note-bound-tab" title="${this._escapeAttr(t.url)}">
            ${t.favicon ? `<img src="${this._escapeAttr(t.favicon)}" class="note-favicon" onerror="this.style.display='none'">` : ''}
            <span class="note-bound-tab-title">${this._escapeHtml((t.title || t.url).slice(0, 40))}</span>
            <button class="note-bound-tab-remove" data-note-action="unbind-tab" data-url="${this._escapeAttr(t.url)}" title="解绑">×</button>
          </span>
        `).join('')}
      </div>
    `;
  }

  // ========== 工具 ==========

  _escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  _escapeAttr(s) {
    return String(s ?? '').replace(/"/g, '&quot;');
  }

  _formatTimeShort(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      if (sameDay) return `${hh}:${mm}`;
      return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
    } catch (_) { return ''; }
  }

  // ========== 事件绑定 ==========

  _wireListeners() {
    if (!this._onStorageChange) {
      this._onStorageChange = (changes, area) => {
        if (area !== 'local' || !changes.notePages) return;
        const newPages = changes.notePages.newValue || [];
        const activeStillExists = newPages.find(p => p.id === this.activePageId);
        this.pages = newPages;
        this._updateStats();
        if (!activeStillExists) {
          // 当前页失效(被圆环删除/新建后切换) → 完整重渲染,不显示陈旧内容
          this.activePageId = newPages[0]?.id || null;
          if (this.container) {
            this.container.innerHTML = this._buildHTML();
            this._wireEditor();
          }
          return;
        }
        // 否则静默同步(不打断编辑):重建 sidebar 列表 + editor header + 绑定 tab 区
        if (this.container) {
          const list = this.container.querySelector('#notePageList');
          if (list) {
            list.innerHTML = this.pages.length === 0 ? this._emptyPageListHtml() : this.pages.map(p => this._pageItemHtml(p)).join('');
          }
          const page = this.pages.find(p => p.id === this.activePageId);
          if (page) {
            // 标题:用户没在编辑时同步
            const titleInput = this.container.querySelector('#notePageTitle');
            if (titleInput && document.activeElement !== titleInput) titleInput.value = page.name;
            // 状态 meta
            const statusEl = this.container.querySelector('#noteEditorStatus');
            if (statusEl) statusEl.textContent = `${page.content?.length || 0} 字符 · ${this._formatTimeShort(page.updatedAt)}`;
            // 绑定 tab 区:重建(委托在 container 上,点击仍冒泡,无需重绑)
            const boundEl = this.container.querySelector('.note-bound, .note-bound-empty');
            if (boundEl) boundEl.outerHTML = this._buildBoundTabs(page);
            // 正文同步:若用户未在编辑,重新渲染 editor(避免打断编辑)
            const editor = this.container.querySelector('#notePageContent');
            if (editor && document.activeElement !== editor) {
              this._renderContentToEditor(editor, page.content || '');
              this._proxyEditorImages(editor);
            }
          }
        }
      };
      chrome.storage.onChanged.addListener(this._onStorageChange);
    }
    // 图床账号外部修改 → 同步面板
    if (!this._uploadCredListener) {
      this._uploadCredListener = (changes, area) => {
        if (area !== 'local' || !changes.noteUpload || !this.container) return;
        const cfg = changes.noteUpload.newValue || {};
        const emailEl = this.container.querySelector('#noteUploadEmail');
        const passEl = this.container.querySelector('#noteUploadPassword');
        const hintEl = this.container.querySelector('#noteUploadHint');
        if (emailEl && document.activeElement !== emailEl && cfg.email !== undefined) emailEl.value = cfg.email || '';
        if (passEl && document.activeElement !== passEl && cfg.password !== undefined) passEl.value = cfg.password || '';
        this._updateUploadHint(cfg, hintEl);
        this._refreshLoginPill(this.container.querySelector('#noteLoginPill'));
      };
      chrome.storage.onChanged.addListener(this._uploadCredListener);
    }
  }

  _wireContainerDelegation() {
    if (this._delegationBound) return;
    this._delegationBound = true;
    this.container.addEventListener('click', (e) => {
      // 先看 action 按钮
      const actionEl = e.target.closest('[data-note-action]');
      if (actionEl) {
        const action = actionEl.getAttribute('data-note-action');
        const pageId = actionEl.getAttribute('data-page-id')
          || actionEl.closest('[data-page-id]')?.getAttribute('data-page-id');
        this._handleAction(action, { pageId, actionEl });
        return;
      }
      // 点击页面卡片主区域 → 选中
      const pageItem = e.target.closest('.note-page-item');
      if (pageItem) {
        const id = pageItem.getAttribute('data-page-id');
        if (id && id !== this.activePageId) {
          // 切走前 flush 待保存
          this._flushSave();
          this.activePageId = id;
          this._rerender();
        }
      }
    });
  }

  _wireEditor() {
    // 标题输入 → 重命名（debounce）
    const titleInput = this.container.querySelector('#notePageTitle');
    if (titleInput && !titleInput._bound) {
      titleInput._bound = true;
      titleInput.addEventListener('input', () => this._scheduleRename(titleInput.value));
      titleInput.addEventListener('keydown', (e) => e.stopPropagation());
    }
    // header（gear popover + 图床账号）：每次重渲染后重新挂载
    this._wireHeader();
    // WYSIWYG 编辑器:渲染内容 + 绑定事件 + 代理 http 图片
    const editor = this.container.querySelector('#notePageContent');
    if (editor) {
      const page = this.pages.find(p => p.id === this.activePageId);
      this._renderContentToEditor(editor, page?.content || '');
      this._bindEditorEvents(editor);
      this._proxyEditorImages(editor);
    }
  }

  /**
   * header gear popover：触发开关 + 外部点击/ESC 关闭 + 挂载图床账号面板。
   * 容器级 click/keydown 监听只绑一次（_headerWired 守卫，与 _wireContainerDelegation
   * 同样依赖 container 跨 _rerender 持久）；_wireUploadSettings 每次 render 重挂（fresh 节点）。
   */
  _wireHeader() {
    if (!this._headerWired) {
      this._headerWired = true;
      this.container.addEventListener('click', (e) => {
        const gear = e.target.closest('#noteLoginGear');
        const pop = this.container.querySelector('#noteLoginPopover');
        if (gear) {
          e.stopPropagation();
          if (pop) {
            const willOpen = pop.hasAttribute('hidden');
            pop.toggleAttribute('hidden', !willOpen);
            gear.setAttribute('aria-expanded', String(willOpen));
          }
          return;
        }
        // 外部点击关闭（点 popover 内部不关）
        if (pop && !pop.hasAttribute('hidden') && !e.target.closest('#noteLoginPopover')) {
          pop.setAttribute('hidden', '');
          this.container.querySelector('#noteLoginGear')?.setAttribute('aria-expanded', 'false');
        }
      });
      this.container.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const pop = this.container.querySelector('#noteLoginPopover');
        if (pop && !pop.hasAttribute('hidden')) {
          pop.setAttribute('hidden', '');
          this.container.querySelector('#noteLoginGear')?.setAttribute('aria-expanded', 'false');
        }
      });
    }
    // 图床账号面板：每次重渲染后重新挂载（container.innerHTML 重写会丢监听）
    if (this.container.querySelector('#noteUploadSaveBtn')) {
      this._wireUploadSettings();
    }
  }

  /**
   * 图床账号面板：读 storage 注到输入框,绑定保存事件
   * 注意：每次 _rerender() 重写 innerHTML 都会丢监听,这里每次重新挂
   */
  _wireUploadSettings() {
    const emailEl = this.container.querySelector('#noteUploadEmail');
    const passEl = this.container.querySelector('#noteUploadPassword');
    const hintEl = this.container.querySelector('#noteUploadHint');
    const saveBtn = this.container.querySelector('#noteUploadSaveBtn');
    const pillEl = this.container.querySelector('#noteLoginPill');
    const loginBtn = this.container.querySelector('#noteLoginBtn');
    if (!emailEl || !passEl || !saveBtn) return;
    // 加载已存凭证（仅 input 为空时填,避免覆盖用户正在输入的值）
    chrome.storage.local.get(['noteUpload']).then((r) => {
      const cfg = r.noteUpload || {};
      if (!emailEl.value && cfg.email) emailEl.value = cfg.email;
      if (!passEl.value && cfg.password) passEl.value = cfg.password;
      this._updateUploadHint(cfg, hintEl);
    });
    // 初始拉一次登录态(模块打开就显示)
    this._refreshLoginPill(pillEl);
    if (!saveBtn._bound) {
      saveBtn._bound = true;
      saveBtn.addEventListener('click', async () => {
        const email = emailEl.value.trim();
        const password = passEl.value;
        try {
          await chrome.storage.local.set({ noteUpload: { email, password } });
        } catch (err) {
          if (hintEl) hintEl.textContent = '保存失败: ' + err.message;
          return;
        }
        const cfg = { email, password };
        this._updateUploadHint(cfg, hintEl);
        if (hintEl) {
          hintEl.textContent = email ? '✓ 已保存' : '✓ 已清空';
          setTimeout(() => this._updateUploadHint(cfg, hintEl), 1500);
        }
        this._refreshLoginPill(pillEl);
      });
    }
    if (loginBtn && !loginBtn._bound) {
      loginBtn._bound = true;
      loginBtn.addEventListener('click', async () => {
        // 先保存输入,再触发登录(background ensureLogin 读 storage)
        const email = emailEl.value.trim();
        const password = passEl.value;
        if (email && password) {
          await chrome.storage.local.set({ noteUpload: { email, password } });
        }
        loginBtn.disabled = true;
        const prev = loginBtn.textContent;
        loginBtn.textContent = '登录中…';
        try {
          const r = await chrome.runtime.sendMessage({ action: 'ensureLogin' });
          if (r?.success) {
            if (hintEl) hintEl.textContent = '✓ 登录成功';
            setTimeout(() => this._updateUploadHint({ email, password }, hintEl), 1500);
          } else {
            if (hintEl) hintEl.textContent = '登录失败: ' + (r?.error || '');
          }
        } catch (err) {
          if (hintEl) hintEl.textContent = '登录错误: ' + err.message;
        } finally {
          loginBtn.disabled = false;
          loginBtn.textContent = prev;
          this._refreshLoginPill(pillEl);
        }
      });
    }
  }

  _updateUploadHint(cfg, hintEl) {
    if (!hintEl) return;
    if (!cfg || !cfg.email) hintEl.textContent = '未配置（无法上传）';
    else hintEl.textContent = `已配置: ${cfg.email}`;
  }

  /**
   * 通过 background getLoginStatus 同步模块面板的登录状态徽章
   * 状态:未配置 / 未登录(token 失效) / 已登录
   */
  async _refreshLoginPill(pillEl) {
    if (!pillEl) return;
    try {
      const r = await chrome.runtime.sendMessage({ action: 'getLoginStatus' });
      if (!r?.success) { pillEl.textContent = '?'; return; }
      if (!r.hasCredentials) {
        pillEl.textContent = '未配置';
        pillEl.className = 'note-login-pill err';
      } else if (r.tokenValid) {
        pillEl.textContent = `✓ 已登录 ${r.email}`;
        pillEl.className = 'note-login-pill ok';
      } else {
        pillEl.textContent = '未登录（点登录拿 token）';
        pillEl.className = 'note-login-pill warn';
      }
    } catch (_) {
      pillEl.textContent = '?';
    }
  }

  // ===================== WYSIWYG 混合编辑器 =====================
  // [[URL]] 渲染为图片块(note-img-block);光标进入图片块附近时临时显示 [[url]] 源码可编辑。
  // 与 content/noteRing.js 同源语义,各自维护一份避免运行时依赖。

  /**
   * 把纯文本内容(含 [[URL]] 占位)渲染进 contenteditable editor
   * [[URL]] → <span class="note-img-block" data-url=URL contenteditable=false><img></span>
   * 其余文本按行分到 <div> 里(每行一个块,便于光标定位)
   */
  _renderContentToEditor(editor, content) {
    editor.innerHTML = '';
    if (!content) { editor.textContent = ''; return; }
    // 按 [[URL]] 切分
    const re = /(\[\[https?:\/\/[^\]]+\]\])/g;
    const parts = content.split(re);
    for (const part of parts) {
      const m = part.match(/^\[\[(https?:\/\/[^\]]+)\]\]$/);
      if (m) {
        editor.appendChild(this._makeImageBlock(m[1]));
      } else if (part) {
        // 文本:按 \n 分行,每行一个 <div>(空行用 <div><br></div>)
        const lines = part.split('\n');
        lines.forEach((line) => {
          const div = document.createElement('div');
          if (line) div.textContent = line;
          else div.appendChild(document.createElement('br'));
          editor.appendChild(div);
        });
      }
    }
    if (!editor.childNodes.length) editor.textContent = '';
  }

  /**
   * 把 contenteditable editor 序列化回 [[URL]] + 文本 格式
   * 规则:<div> 之间换行;图片块 → [[url]];其它(如临时的源码 span)按 textContent
   *
   * 防御:临时源码态 (note-img-source) 可能在 contenteditable 里被用户/浏览器
   * 改成任意文本(包括单个 × 按钮的字符)。存储必须以 data-url 为准 —
   * 如果 source 的 textContent 不是合法 [[URL]] 形式(被改动/损坏),
   * 用 data-url 重建 [[url]]。否则只读 textContent 会产生 × 这种诡异单字符
   * 污染存储 — 后续刷新会让所有图片引用丢失。
   */
  _serializeEditor(editor) {
    let out = '';
    const kids = Array.from(editor.childNodes);
    kids.forEach((node, i) => {
      if (node.nodeType === 3) {
        // 纯文本节点
        out += node.textContent;
      } else if (node.nodeType === 1) {
        const el = node;
        if (el.classList && el.classList.contains('note-img-block')) {
          const url = el.getAttribute('data-url');
          if (url) out += `[[${url}]]`;
          // 没有 data-url 的孤儿图片块:不写入任何字符,绝不写入其 textContent
          // (textContent 会包含 × 按钮的字符,造成存储污染)
        } else if (el.classList && el.classList.contains('note-img-source')) {
          // 用户可能修改过 URL 文本:做合法性校验
          const txt = (el.textContent || '').trim();
          const m = txt.match(/^\[\[(https?:\/\/[^\]]+)\]\]$/);
          if (m) {
            // 用户改成了合法的 [[URL]] 形式:以新 URL 为准
            out += txt;
          } else {
            // 文本不合法(被删空/改成 × / 粘贴了无关内容) →
            // 回退到 data-url,绝不写入污染字符串
            const fallback = el.getAttribute('data-url') || '';
            if (fallback) out += `[[${fallback}]]`;
          }
        } else {
          // <div> / <br> 等
          const tag = el.tagName;
          if (tag === 'BR') {
            out += '\n';
          } else {
            // div:内容 + 换行(除非是最后一个空块)
            // 排除图片块后代里的 × 按钮字符:用 querySelector 反向排除任何
            // 包含图片相关 class 的元素子树,只取纯文本段落
            const t = this._pureTextContent(el);
            out += t;
            if (i < kids.length - 1) out += '\n';
          }
        }
      }
    });
    return out;
  }

  /**
   * 取元素的纯文本内容,但排除任何内嵌的 note-img-block / note-img-source /
   * note-img-pending 子树。否则容器 div 的 textContent 会把 × 按钮字符或
   * `[上传中…]` 占位文字当作普通文本写入存储。
   */
  _pureTextContent(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.note-img-block, .note-img-source, .note-img-pending')
      .forEach((n) => n.remove());
    return clone.textContent || '';
  }

  /**
   * editor 事件绑定:input → 防抖保存;selectionchange → 光标感知;blur → 还原图片
   */
  _bindEditorEvents(editor) {
    if (editor._bound) return;
    editor._bound = true;
    editor.addEventListener('input', () => {
      this._updateStatus(this._serializeEditor(editor).length);
      this._scheduleEditorSave(editor);
    });
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      }
      e.stopPropagation();
    });
    // 粘贴图片 → 上传图床 → 插入 [[URL]] 图片块(与 noteRing 同链路)
    editor.addEventListener('paste', (e) => this._onEditorPaste(e, editor));
    editor.addEventListener('blur', () => this._deactivateAllImages(editor));
    // document 级 selectionchange 只绑一次(实例级),handler 找当前 editor
    if (!this._docSelectionHandler) {
      this._docSelectionHandler = () => {
        if (!this.container) return;
        const ed = this.container.querySelector('#notePageContent');
        if (!ed || document.activeElement !== ed) return;
        this._syncImageActiveState(ed);
      };
      document.addEventListener('selectionchange', this._docSelectionHandler);
    }
  }

  /**
   * 光标感知:把光标所在的图片块临时显示为 [[url]] 源码(可编辑),其余保持图片
   */
  _syncImageActiveState(editor) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      this._deactivateAllImages(editor);
      return;
    }
    const node = sel.anchorNode;
    // 向上找最近的图片块(或临时源码 span)
    let target = null;
    if (node) {
      target = node.nodeType === 1 ? node.closest('.note-img-block, .note-img-source') : null;
      if (!target && node.parentElement) {
        target = node.parentElement.closest('.note-img-block, .note-img-source');
      }
    }
    if (target && target.classList.contains('note-img-source')) {
      // 已经在源码态,保持
      return;
    }
    if (target && target.classList.contains('note-img-block')) {
      // 光标在图片块上 → 激活为源码态
      this._activateImageAsSource(editor, target);
    } else {
      this._deactivateAllImages(editor);
    }
  }

  _activateImageAsSource(editor, block) {
    if (this._activeImgBlock === block) return;
    this._deactivateAllImages(editor);
    this._activeImgBlock = block;
    const url = block.getAttribute('data-url') || '';
    const span = document.createElement('span');
    span.className = 'note-img-source';
    span.setAttribute('contenteditable', 'true');
    span.textContent = `[[${url}]]`;
    span.setAttribute('data-url', url);
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

  _deactivateAllImages(editor) {
    if (!this._activeImgBlock) return;
    // 当前激活的可能已被替换为 .note-img-source;若在,blur 时把它换回图片块
    const src = editor.querySelector('.note-img-source');
    if (src) {
      const url = (src.textContent.match(/\[\[(https?:\/\/[^\]]+)\]\]/) || [])[1]
        || src.getAttribute('data-url') || '';
      const block = this._makeImageBlock(url);
      src.replaceWith(block);
      this._proxyEditorImages(editor); // 补新块的 src
    }
    this._activeImgBlock = null;
  }

  /**
   * 删除图片块 click handler(绑在每个 × 按钮上)
   */
  _onDeleteImgClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const block = e.currentTarget.closest('.note-img-block');
    if (!block) return;
    // 删除图片块 + 它前面的零宽空格(若有)
    const prev = block.previousSibling;
    block.remove();
    if (prev && prev.nodeType === 3 && prev.textContent === '​') prev.remove();
    const editor = this.container.querySelector('#notePageContent');
    if (editor) this._scheduleEditorSave(editor);
  }

  /**
   * 构造一个图片块 span(图片 + × 按钮)
   * 始终先设 img.src = url(浏览器直接加载),同时记 data-pending-src 给 SW 代理做
   * Mixed Content 防护(HTTPS 页注入了 noteRing 时优化用)。代理成功时 src 会被
   * dataURL 覆盖;代理失败时直接回退到原始 URL,避免 img 完全无 src 时只看到 × 按
   * 钮被误判为 "字母 x"。
   */
  _makeImageBlock(url) {
    const span = document.createElement('span');
    span.className = 'note-img-block';
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('data-url', url);
    const img = document.createElement('img');
    img.alt = '图片';
    if (url) {
      img.src = url;
      if (url.startsWith('http://')) img.setAttribute('data-pending-src', url);
    }
    const x = document.createElement('button');
    x.className = 'note-img-x';
    x.type = 'button';
    x.textContent = '×';
    x.title = '删除这张图';
    x.addEventListener('click', (e) => this._onDeleteImgClick(e));
    span.appendChild(img);
    span.appendChild(x);
    return span;
  }

  /**
   * 在编辑器当前光标位置插入图片块(光标不在 editor 内则追加到末尾)
   */
  _insertImageBlockAtCursor(editor, url) {
    const sel = window.getSelection();
    let inserted = false;
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const block = this._makeImageBlock(url);
      range.insertNode(block);
      range.setStartAfter(block);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      inserted = true;
    }
    if (!inserted) {
      editor.appendChild(this._makeImageBlock(url));
    }
  }

  /**
   * 粘贴图片 → 上传图床 → 立即用后端返回 URL 落盘 → 再渲染回编辑器
   *
   * 设计原则:文本层与显示层解耦。
   * - 上传成功后,直接把 [[URL]] 追加到 page.content(从 this.pages 读)并
   *   chrome.storage.local.set — 文本层立刻与后端同步,绝对不让 DOM 序列化
   *   决定持久化内容(那会因 contenteditable 中间态产生 × 等脏数据)。
   * - 显示层先用占位块 (_makePendingBlock) 给用户即时反馈,上传完成后
   *   替换占位块为正式图片块;整个过程不影响已落盘的文本。
   * - 这消除了"DOM 已插入,文本层仍是原值"的窗口期,也杜绝了序列化
   *   把 × 按钮字符写入存储的污染路径。
   */
  async _onEditorPaste(e, editor) {
    if (!this.activePageId) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    let imageItem = null;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) { imageItem = it; break; }
    }
    if (!imageItem) return; // 没图片 → 走默认文本粘贴
    e.preventDefault();
    const blob = imageItem.getAsFile();
    if (!blob) return;
    const dataUrl = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => res(null);
      r.readAsDataURL(blob);
    });
    if (!dataUrl) return;
    // 凭证预检
    const status = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getLoginStatus' }, (r) => {
        if (chrome.runtime.lastError) resolve({ hasCredentials: false });
        else resolve(r || { hasCredentials: false });
      });
    });
    if (!status.hasCredentials) {
      toast('未配置图床账号，请点右上角齿轮登录', 'error', 3500);
      return;
    }

    // 1) 先插占位块给用户视觉反馈(纯文字 "[上传中…]",不打存盘)。
    //    取消已有的 auto-save 计时,避免它在 placeholder 期间序列化。
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._deactivateAllImages(editor);
    const placeholder = this._makePendingBlock();
    this._insertNodeAtCursor(editor, placeholder);
    this._updateStatus(0);

    let up;
    try {
      up = await this.dataManager.sendMessage('uploadNoteImage', { dataUrl });
    } catch (err) {
      // 上传失败:撤回占位块,弹提示,保留之前落盘内容不变
      placeholder.remove();
      toast('上传失败: ' + err.message, 'error', 3500);
      return;
    }
    if (!up?.success || !up.url) {
      placeholder.remove();
      toast('上传失败: ' + (up?.error || ''), 'error', 3500);
      return;
    }

    // 2) 立即把 [[URL]] 写回后端(用 this.pages 里的原 content,而不是 DOM —
    //    这是关键决策点)。append 一个换行避免粘连到前一文本。
    const page = this.pages.find(p => p.id === this.activePageId);
    if (!page) { placeholder.remove(); return; }
    const prev = page.content || '';
    const sep = prev && !prev.endsWith('\n') ? '\n' : '';
    const newContent = prev + sep + `[[${up.url}]]`;
    await this.dataManager.sendMessage('updateNoteContent', {
      id: this.activePageId,
      content: newContent
    });
    // 同步本地缓存,后续 auto-save 也用对的内容(虽然这次之后不依赖序列化)
    page.content = newContent;
    this._saveDirty = false;

    // 3) 占位块 → 真正的图片块
    const realBlock = this._makeImageBlock(up.url);
    placeholder.replaceWith(realBlock);
    this._proxyEditorImages(editor);
  }

  /**
   * 上传期间的占位块:普通 contenteditable=false span,
   * 显示 "上传中…" 让用户感知;不影响任何存盘文本(完全不在序列化路径里)。
   */
  _makePendingBlock() {
    const span = document.createElement('span');
    span.className = 'note-img-pending';
    span.setAttribute('contenteditable', 'false');
    span.textContent = '[上传中…]';
    return span;
  }

  /**
   * 在光标位置插入节点(与 _insertImageBlockAtCursor 类似但更通用)
   */
  _insertNodeAtCursor(editor, node) {
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

  /**
   * 代理编辑器里所有 data-pending-src 的 http 图片 → SW fetch 转 dataURL
   * 优化通道:只是 Mixed Content 兜底。_makeImageBlock 已经预先设了 img.src,
   * 这里只在 SW 成功时用 dataURL 替换(SW 失败/挂起时保留原 src,
   * 避免代理路径失败时图片完全消失 → 用户只看到 × 被误判为 "字母 x")。
   *
   * 命中走 background 的 LRU 池(共享内存缓存),miss 才 fetch。
   */
  _proxyEditorImages(editor) {
    const imgs = editor.querySelectorAll('img[data-pending-src]');
    imgs.forEach((img) => {
      const url = img.getAttribute('data-pending-src');
      if (!url) return;
      chrome.runtime.sendMessage(
        { action: 'fetchImageAsDataUrl', url },
        (res) => {
          if (chrome.runtime.lastError) return;
          if (res?.success && res.dataUrl) {
            img.src = res.dataUrl;
            img.removeAttribute('data-pending-src');
          }
          // 失败分支:不动 img.src,保留 _makeImageBlock 写好的直接 URL。
          // 不再设 alt='图片加载失败',避免误导用户(实际图可能正常显示)。
        }
      );
    });
  }

  /**
   * 防抖保存:序列化 editor → updateNoteContent
   */
  _scheduleEditorSave(editor) {
    this._saveDirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      if (!this.activePageId) return;
      const content = this._serializeEditor(editor);
      await this._doSave(content);
    }, AUTOSAVE_DELAY);
  }

  _updateStatus(len) {
    const status = this.container.querySelector('#noteEditorStatus');
    if (status) status.textContent = `${len} 字符 · ${this._formatTimeShort(new Date().toISOString())}`;
  }

  _scheduleRename(name) {
    if (this._renameTimer) clearTimeout(this._renameTimer);
    this._renameTimer = setTimeout(() => {
      if (!this.activePageId) return;
      this.dataManager.sendMessage('renameNotePage', { id: this.activePageId, name });
    }, 500);
  }

  async _flushSave() {
    if (!this._saveDirty || !this.activePageId) return;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    const editor = this.container.querySelector('#notePageContent');
    const content = editor ? this._serializeEditor(editor) : '';
    await this._doSave(content);
  }

  async _doSave(content) {
    if (!this.activePageId) return;
    this._saveDirty = false;
    await this.dataManager.sendMessage('updateNoteContent', {
      id: this.activePageId,
      content: content || ''
    });
    // 触发 storage change → 其他视图也会刷新
    // 本地不重渲染（避免打断编辑）
  }

  // ========== 动作处理 ==========

  async _handleAction(action, ctx) {
    switch (action) {
      case 'new-page': return this._newPage();
      case 'rename-page': return this._renamePage(ctx.pageId);
      case 'delete-page': return this._deletePage(ctx.pageId);
      case 'unbind-tab': return this._unbindTab(ctx.actionEl);
      case 'select-page':
        // 已由 _wireContainerDelegation 的卡片点击处理
        return;
    }
  }

  async _newPage() {
    const name = await modal.prompt('请输入便签页名称', {
      title: '新建便签页',
      defaultValue: '新便签页',
      placeholder: '便签页名称',
      confirmText: '创建'
    });
    if (!name || !name.trim()) return;
    const r = await this.dataManager.sendMessage('createNotePage', { name: name.trim() });
    if (r?.success) {
      this._flushSave();
      this.activePageId = r.page.id;
      this._rerender();
    }
  }

  async _renamePage(pageId) {
    const page = this.pages.find(p => p.id === pageId);
    if (!page) return;
    const name = await modal.prompt('请输入新的名称', {
      title: '重命名',
      defaultValue: page.name,
      placeholder: '便签页名称',
      confirmText: '保存'
    });
    if (!name || !name.trim() || name === page.name) return;
    await this.dataManager.sendMessage('renameNotePage', { id: pageId, name: name.trim() });
    // storage change 会刷新 UI
  }

  async _deletePage(pageId) {
    const page = this.pages.find(p => p.id === pageId);
    if (!page) return;
    const ok = await modal.confirm(`删除便签页「${page.name}」？文章内容将丢失。`, {
      title: '删除便签页',
      type: 'danger',
      confirmText: '删除'
    });
    if (!ok) return;
    const r = await this.dataManager.sendMessage('deleteNotePage', { id: pageId });
    if (r?.success) {
      if (this.activePageId === pageId) this.activePageId = null;
      this._rerender();
    }
  }

  async _unbindTab(actionEl) {
    const url = actionEl.getAttribute('data-url');
    if (!url || !this.activePageId) return;
    await this.dataManager.sendMessage('unbindTabFromPage', {
      pageId: this.activePageId, url
    });
  }

  _rerender() {
    if (!this.container) return;
    // 切换页面前 flush 待保存
    this._flushSave();
    chrome.storage.local.get(STORAGE_KEYS, (res) => {
      this.pages = Array.isArray(res.notePages) ? res.notePages : [];
      if (!this.activePageId || !this.pages.find(p => p.id === this.activePageId)) {
        this.activePageId = this.pages[0]?.id || null;
      }
      this._updateStats();
      this.container.innerHTML = this._buildHTML();
      this._wireEditor();
    });
  }

  destroy() {
    if (this._onStorageChange) {
      chrome.storage.onChanged.removeListener(this._onStorageChange);
      this._onStorageChange = null;
    }
    if (this._uploadCredListener) {
      chrome.storage.onChanged.removeListener(this._uploadCredListener);
      this._uploadCredListener = null;
    }
    if (this._docSelectionHandler) {
      document.removeEventListener('selectionchange', this._docSelectionHandler);
      this._docSelectionHandler = null;
    }
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._renameTimer) { clearTimeout(this._renameTimer); this._renameTimer = null; }
    this._delegationBound = false;
    this._activeImgBlock = null;
    // 不清 container.innerHTML — 见 module-extension-guide §7#11
  }
}

export default NoteView;
