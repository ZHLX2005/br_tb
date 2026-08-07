/**
 * NoteView - 便签页视图（每页 = 一篇可编辑文章）
 *
 * UI 结构：
 *   ┌─────────────────────────────────────────────┐
 *   │  头部: 标题 + 统计                            │
 *   ├──────────────┬──────────────────────────────┤
 *   │  页面列表     │  当前页面文章编辑器          │
 *   │  + 新建       │   - 页面名 + 绑定 tab 列表   │
 *   │  □ page 1     │   - 大文本编辑器            │
 *   │  □ page 2     │   - 自动保存                 │
 *   └──────────────┴──────────────────────────────┘
 */

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
          <button class="note-btn note-btn-secondary" data-note-action="bind-current-tab" title="把当前标签页绑定到选中的页面">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
            </svg>
            绑定当前标签页
          </button>
        </div>
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
          <textarea
            class="note-editor-content"
            id="notePageContent"
            placeholder="开始写…"
            spellcheck="false">${this._escapeHtml(page.content || '')}</textarea>
        </div>
      </section>
    `;
  }

  _buildBoundTabs(page) {
    const tabs = page.boundTabs || [];
    if (tabs.length === 0) {
      return `<div class="note-bound-empty">未绑定任何标签页 — 点击顶部「绑定当前标签页」</div>`;
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
        const prevActive = this.activePageId;
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
            // 正文:远端改了且用户没在编辑时同步
            const contentArea = this.container.querySelector('#notePageContent');
            if (contentArea && document.activeElement !== contentArea && contentArea.value !== (page.content || '')) {
              contentArea.value = page.content || '';
            }
          }
        }
      };
      chrome.storage.onChanged.addListener(this._onStorageChange);
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
    // 内容输入 → 自动保存
    const contentArea = this.container.querySelector('#notePageContent');
    if (contentArea && !contentArea._bound) {
      contentArea._bound = true;
      contentArea.addEventListener('input', () => {
        this._updateStatus(contentArea.value.length);
        this._scheduleSave(contentArea.value);
      });
      contentArea.addEventListener('keydown', (e) => {
        // Tab 缩进支持
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = contentArea.selectionStart, end = contentArea.selectionEnd;
          contentArea.value = contentArea.value.slice(0, start) + '  ' + contentArea.value.slice(end);
          contentArea.selectionStart = contentArea.selectionEnd = start + 2;
          this._scheduleSave(contentArea.value);
        }
        e.stopPropagation();
      });
    }
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

  _scheduleSave(content) {
    this._saveDirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._doSave(content), AUTOSAVE_DELAY);
  }

  async _flushSave() {
    if (!this._saveDirty || !this.activePageId) return;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    const contentArea = this.container.querySelector('#notePageContent');
    const text = contentArea ? contentArea.value : '';
    await this._doSave(text);
  }

  async _doSave(content) {
    if (!this.activePageId) return;
    this._saveDirty = false;
    await this.dataManager.sendMessage('updateNoteContent', {
      id: this.activePageId,
      content: content || ''
    });
    // 触发 storage change → 其他视图也会刷新
    // 本本地不重渲染（避免打断编辑）
  }

  // ========== 动作处理 ==========

  async _handleAction(action, ctx) {
    switch (action) {
      case 'new-page': return this._newPage();
      case 'rename-page': return this._renamePage(ctx.pageId);
      case 'delete-page': return this._deletePage(ctx.pageId);
      case 'bind-current-tab': return this._bindCurrentTab();
      case 'unbind-tab': return this._unbindTab(ctx.actionEl);
      case 'select-page':
        // 已由 _wireContainerDelegation 的卡片点击处理
        return;
    }
  }

  async _newPage() {
    const name = prompt('便签页名称', '新便签页');
    if (!name) return;
    const r = await this.dataManager.sendMessage('createNotePage', { name });
    if (r?.success) {
      this._flushSave();
      this.activePageId = r.page.id;
      this._rerender();
    }
  }

  async _renamePage(pageId) {
    const page = this.pages.find(p => p.id === pageId);
    if (!page) return;
    const name = prompt('重命名', page.name);
    if (!name || name === page.name) return;
    await this.dataManager.sendMessage('renameNotePage', { id: pageId, name });
    // storage change 会刷新 UI
  }

  async _deletePage(pageId) {
    const page = this.pages.find(p => p.id === pageId);
    if (!page) return;
    if (!confirm(`删除便签页「${page.name}」？文章内容将丢失。`)) return;
    const r = await this.dataManager.sendMessage('deleteNotePage', { id: pageId });
    if (r?.success) {
      if (this.activePageId === pageId) this.activePageId = null;
      this._rerender();
    }
  }

  async _bindCurrentTab() {
    if (!this.activePageId) {
      alert('请先在左侧选中一个便签页');
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) { alert('无法获取当前标签页 URL'); return; }
      if (!/^https?:\/\//.test(tab.url)) { alert('当前页面 URL 不支持绑定（仅 http/https）'); return; }
      await this.dataManager.sendMessage('bindTabToPage', {
        pageId: this.activePageId,
        url: tab.url,
        title: tab.title || tab.url,
        favicon: tab.favIconUrl || ''
      });
    } catch (e) {
      console.error('[note] bind tab failed', e);
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
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._renameTimer) { clearTimeout(this._renameTimer); this._renameTimer = null; }
    this._delegationBound = false;
    // 不清 container.innerHTML — 见 module-extension-guide §7#11
  }
}

export default NoteView;