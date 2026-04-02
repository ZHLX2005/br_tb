/**
 * TabBoard Side Panel - Pin Panel
 * 简化版：移除 JSON 检测，专注于快速 Pin 内容
 */

// ==================== GroupsController ====================
class GroupsController {
  constructor() {
    this.groups = [];
    this.tabs = {};
    this.currentGroupId = null;
  }

  async loadData() {
    try {
      const data = await this.sendMessage({ action: 'getAllData' });
      this.groups = data.groups || [];
      this.tabs = data.tabs || {};
      this.renderGroupSelect();
      this.bindEvents();
    } catch (error) {
      console.error('加载数据失败:', error);
    }
  }

  sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
    });
  }

  bindEvents() {
    document.getElementById('refreshGroupsBtn')?.addEventListener('click', () => this.loadData());
    document.getElementById('groupSelect')?.addEventListener('change', (e) => {
      this.currentGroupId = e.target.value || null;
      this.renderCurrentGroup();
    });
    document.getElementById('openAllBtn')?.addEventListener('click', () => this.openAllTabs());
    document.getElementById('clearGroupBtn')?.addEventListener('click', () => this.clearGroup());
    document.getElementById('tabList')?.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.tab-delete');
      if (deleteBtn) { e.stopPropagation(); this.deleteTab(deleteBtn.dataset.tabId); return; }
      const tabItem = e.target.closest('.tab-item');
      if (tabItem) this.openTab(tabItem.dataset.url);
    });
  }

  onShow() { this.loadData(); }

  renderGroupSelect() {
    const select = document.getElementById('groupSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- 选择分组 --</option>' +
      this.groups.map(g => `<option value="${g.id}">${g.name} (${this.tabs[g.id]?.length || 0})</option>`).join('');
  }

  renderCurrentGroup() {
    const groupInfo = document.getElementById('currentGroupInfo');
    const tabList = document.getElementById('tabList');
    if (!this.currentGroupId) {
      groupInfo.style.display = 'none';
      tabList.innerHTML = '<div class="empty-hint">请选择一个分组查看标签</div>';
      // 通知 PickedItemsController 清除标签
      const pic = window.sidebarApp?.controllers?.pickedItems;
      if (pic && this.currentGroupId === null) {
        // 保持当前标签不变，只有在看全部时且用户没有手动选择标签时才受影响
      }
      return;
    }
    const group = this.groups.find(g => g.id === this.currentGroupId);
    const tabs = this.tabs[this.currentGroupId] || [];
    if (!group) { groupInfo.style.display = 'none'; tabList.innerHTML = '<div class="empty-hint">分组不存在</div>'; return; }
    groupInfo.style.display = 'block';
    document.getElementById('groupColor').style.background = group.color;
    document.getElementById('groupName').textContent = group.name;
    document.getElementById('tabCount').textContent = `${tabs.length} 个标签`;
    tabList.innerHTML = tabs.length === 0 ? '<div class="empty-hint">该分组暂无标签</div>' :
      tabs.map(t => `<div class="tab-item" data-url="${this.esc(t.url)}"><img class="tab-favicon" src="${this.esc(t.favicon||'')}" onerror="this.style.display='none'"><div class="tab-content"><div class="tab-title">${this.esc(t.title)}</div><div class="tab-url">${this.esc(t.url)}</div></div><button class="tab-delete" data-tab-id="${t.id}">×</button></div>`).join('');

    // 自动设置 PickedItemsController 的标签
    const pic = window.sidebarApp?.controllers?.pickedItems;
    if (pic) {
      pic.setCurrentTag(group.name);
    }
  }

  openTab(url) { this.sendMessage({ action: 'openTab', url }); }
  openAllTabs() { if (this.currentGroupId) this.sendMessage({ action: 'openGroup', groupId: this.currentGroupId }); }
  clearGroup() { if (this.currentGroupId) { this.sendMessage({ action: 'clearGroup', groupId: this.currentGroupId }); this.loadData(); } }
  deleteTab(tabId) { if (this.currentGroupId && tabId) { this.sendMessage({ action: 'deleteTab', tabId, groupId: this.currentGroupId }); this.loadData(); } }
  esc(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}

// ==================== PickedItemsController ====================
class PickedItemsController {
  constructor() {
    this.items = [];
    this.currentFilter = '';
    this.currentTag = '';  // 当前筛选的标签
    this.selectedTag = '';  // 当前选中的标签（用于添加）
    this.collapsedTags = new Set();
  }

  init() {
    this.bindEvents();
    this.loadData();
  }

  async loadData() {
    const result = await chrome.storage.local.get(['pickedItems']);
    this.items = result.pickedItems || [];
    this.render();
  }

  onShow() {
    this.loadData();
    // 切换到 Pin 页面时，如果 GroupsController 有选中的分组，自动设置标签
    const gc = window.sidebarApp?.controllers?.groups;
    if (gc?.currentGroupId) {
      const group = gc.groups.find(g => g.id === gc.currentGroupId);
      if (group) {
        this.selectedTag = group.name;
        this.updateTagButton();
      }
    } else if (!this.selectedTag) {
      // 如果没有选中分组且没有已选标签，显示"选择分组"
      this.updateTagButton();
    }
  }

  // 设置当前标签（供外部调用，如 GroupsController）
  setCurrentTag(tag) {
    this.selectedTag = tag;
    this.updateTagButton();
  }

  updateTagButton() {
    const label = document.getElementById('tagSelectLabel');
    if (label) {
      label.textContent = this.selectedTag || '选择分组';
    }
  }

  bindEvents() {
    // 添加按钮
    document.getElementById('quickAddBtn')?.addEventListener('click', () => this.addItem());
    document.getElementById('quickPickBtn')?.addEventListener('click', () => this.pickWithCurrentTag());

    // 拾取
    document.getElementById('startPickerBtn')?.addEventListener('click', () => this.startPicker());

    // 标签选择按钮 - 切换下拉
    document.getElementById('tagSelectBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTagDropdown();
    });

    // 点击其他地方关闭下拉
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tag-selector-row')) {
        this.hideTagDropdown();
      }
    });

    // 搜索
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
      this.currentFilter = e.target.value.toLowerCase();
      this.render();
    });

    // 导入导出清空
    document.getElementById('importFormsBtn')?.addEventListener('click', () => this.showImport());
    document.getElementById('exportFormsBtn')?.addEventListener('click', () => this.export());
    document.getElementById('clearFormsBtn')?.addEventListener('click', () => this.clearAll());

    // 监听拾取结果
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'PICK_RESULT') this.handlePickResult(message.data);
      else if (message.type === 'PICK_CANCEL') this.hidePickerStatus();
    });
  }

  toggleTagDropdown() {
    const dropdown = document.getElementById('tagDropdown');
    if (dropdown.style.display === 'none') {
      this.renderTagDropdown();
      dropdown.style.display = 'block';
    } else {
      this.hideTagDropdown();
    }
  }

  hideTagDropdown() {
    const dropdown = document.getElementById('tagDropdown');
    if (dropdown) dropdown.style.display = 'none';
  }

  getAllTags() {
    const tags = new Set();
    this.items.forEach(i => tags.add(i.tag || ''));
    return Array.from(tags).sort();
  }

  renderTagDropdown() {
    const list = document.getElementById('tagDropdownList');
    const tags = this.getAllTags();

    // 包括已有标签 + "无标签" 选项
    let html = `<div class="tag-dropdown-item${!this.selectedTag ? ' selected' : ''}" data-tag="">
        <span>选择分组</span>
      </div>`;

    if (tags.filter(t => t).length > 0) {
      html += tags.filter(t => t).map(t => `
        <div class="tag-dropdown-item${this.selectedTag === t ? ' selected' : ''}" data-tag="${this.esc(t)}">
          <span>${this.esc(t)}</span>
        </div>`).join('');
    }

    html += `<div class="tag-dropdown-item empty-tag-item${this.selectedTag === '__empty__' ? ' selected' : ''}" data-tag="__empty__">
        <span>无标签</span>
      </div>`;

    list.innerHTML = html;

    list.querySelectorAll('.tag-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const tag = item.dataset.tag;
        this.selectedTag = tag === '__empty__' ? '' : tag;
        this.updateTagButton();
        this.hideTagDropdown();
        this.render(); // 重新渲染以更新筛选
      });
    });
  }

  startPicker() {
    chrome.runtime.sendMessage({ action: 'startPicker', tag: this.selectedTag }, (r) => {
      if (r?.success) this.showPickerStatus();
    });
  }

  pickWithCurrentTag() {
    chrome.runtime.sendMessage({ action: 'startPicker', tag: this.selectedTag }, (r) => {
      if (r?.success) this.showPickerStatus();
    });
  }

  showPickerStatus() { document.getElementById('pickerStatus').style.display = 'block'; }
  hidePickerStatus() { document.getElementById('pickerStatus').style.display = 'none'; }

  handlePickResult(data) {
    this.hidePickerStatus();
    const tag = this.selectedTag || '';
    const content = data.text || data.value || '';

    const item = {
      id: 'p-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      tag,
      content,
      sourceUrl: data.sourceUrl || '',
      sourceTitle: data.sourceTitle || '',
      timestamp: new Date().toISOString()
    };

    this.items.unshift(item);
    this.save();
    this.render();
    this.toast('已添加', 'success');
  }

  async addItem() {
    const tag = this.selectedTag || '';
    const content = document.getElementById('quickContent').value.trim();

    if (!content) {
      this.toast('请输入内容', 'error');
      return;
    }

    // 手动输入不携带 sourceUrl 和 sourceTitle
    const item = {
      id: 'p-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      tag,
      content,
      sourceUrl: '',
      sourceTitle: '',
      timestamp: new Date().toISOString()
    };

    this.items.unshift(item);
    this.save();
    this.render();

    // 清空表单
    document.getElementById('quickContent').value = '';

    this.toast('已添加', 'success');
  }

  getAllTags() {
    const tags = new Set();
    this.items.forEach(i => tags.add(i.tag || ''));
    return Array.from(tags).sort();
  }

  getFilteredItems() {
    return this.items.filter(item => {
      const itemTag = item.tag || '';
      let matchTag = false;
      if (this.currentTag === '__all__' || this.currentTag === '') {
        matchTag = true;
      } else if (this.currentTag === '__empty__') {
        matchTag = itemTag === '';
      } else {
        matchTag = itemTag === this.currentTag;
      }
      const matchFilter = !this.currentFilter ||
        item.content.toLowerCase().includes(this.currentFilter) ||
        itemTag.toLowerCase().includes(this.currentFilter);
      return matchTag && matchFilter;
    });
  }

  getGroupedItems(items) {
    const groups = {};
    items.forEach(i => { const t = i.tag || ''; (groups[t] = groups[t] || []).push(i); });
    return groups;
  }

  render() {
    this.renderTagFilters();
    document.getElementById('tagCount').textContent = this.getAllTags().filter(t => t).length;
    document.getElementById('itemCount').textContent = this.items.length;
    this.renderItems();
  }

  renderTagFilters() {
    const container = document.getElementById('tagFilterList');
    const tags = this.getAllTags();
    const allActive = this.currentTag === '__all__' || this.currentTag === '' ? 'active' : '';
    const emptyActive = this.currentTag === '__empty__' ? 'active' : '';
    container.innerHTML = `<span class="tag-filter ${allActive}" data-tag="__all__">全部</span>` +
      `<span class="tag-filter ${emptyActive}" data-tag="__empty__">无标签</span>` +
      tags.filter(t => t).map(t => `<span class="tag-filter ${this.currentTag === t ? 'active' : ''}" data-tag="${this.esc(t)}">${this.esc(t)}</span>`).join('');
    container.querySelectorAll('.tag-filter').forEach(el => el.addEventListener('click', () => {
      this.currentTag = el.dataset.tag;
      this.render();
    }));
  }

  renderTagSelect() {
    const select = document.getElementById('tagSelect');
    const tags = this.getAllTags();
    select.innerHTML = '<option value="">选择已有标签</option>' +
      tags.filter(t => t).map(t => `<option value="${this.esc(t)}">${this.esc(t)}</option>`).join('');
  }

  renderItems() {
    const formList = document.getElementById('formList');
    const filtered = this.getFilteredItems();
    const grouped = this.getGroupedItems(filtered);
    const tagNames = Object.keys(grouped).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));

    if (!tagNames.length) {
      formList.innerHTML = '<div class="empty-hint">🎯 拾取或输入内容添加</div>';
      return;
    }

    formList.innerHTML = tagNames.map(tag => {
      const items = grouped[tag];
      const isCollapsed = this.collapsedTags.has(tag);
      return `<div class="form-group">
        <div class="form-group-header" data-tag="${this.esc(tag)}">
          <span class="collapse-icon">${isCollapsed ? '▶' : '▼'}</span>
          <div class="form-group-title">
            <span class="form-group-tag${tag ? '' : ' empty-tag'}">${this.esc(tag) || '（无标签）'}</span>
            <span class="form-group-count">${items.length}</span>
          </div>
          <div class="form-group-actions">
            <button class="group-edit-btn" data-tag="${this.esc(tag)}" title="编辑标签">✏️</button>
            <button class="group-delete-btn" data-tag="${this.esc(tag)}" title="删除">🗑️</button>
          </div>
        </div>
        <div class="form-group-items" style="display: ${isCollapsed ? 'none' : 'block'}">${items.map(i => this.renderItem(i)).join('')}</div>
      </div>`;
    }).join('');

    this.bindItemEvents();
  }

  renderItem(item) {
    const display = this.esc(item.content).slice(0, 200);
    const sourceInfo = item.sourceTitle ? `<span class="form-field-label">${this.esc(item.sourceTitle).slice(0, 30)}</span>` : '';
    return `<div class="form-field" data-id="${item.id}">
      <div class="form-field-header">
        ${sourceInfo}
        <div class="form-field-actions">
          <button class="field-btn copy-btn" data-content="${this.esc(item.content)}" title="复制">📋</button>
          <button class="field-btn edit-btn" data-id="${item.id}" title="编辑">✏️</button>
          <button class="field-btn delete-btn" data-id="${item.id}" title="删除">🗑️</button>
        </div>
      </div>
      <div class="form-field-value" data-id="${item.id}">${display}</div>
    </div>`;
  }

  bindItemEvents() {
    const formList = document.getElementById('formList');

    // 分组折叠
    formList.querySelectorAll('.form-group-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const btn = e.target.closest('.group-edit-btn, .group-delete-btn');
        if (btn) return;
        const tag = header.dataset.tag;
        if (this.collapsedTags.has(tag)) {
          this.collapsedTags.delete(tag);
        } else {
          this.collapsedTags.add(tag);
        }
        const items = header.nextElementSibling;
        if (items) items.style.display = this.collapsedTags.has(tag) ? 'none' : 'block';
        const icon = header.querySelector('.collapse-icon');
        if (icon) icon.textContent = this.collapsedTags.has(tag) ? '▶' : '▼';
      });
    });

    // 复制
    formList.querySelectorAll('.copy-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(btn.dataset.content);
      this.toast('已复制', 'success');
    }));

    // 编辑
    formList.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = this.items.find(i => i.id === btn.dataset.id);
      if (item) this.showEditDialog(item);
    }));

    // 删除
    formList.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.items = this.items.filter(i => i.id !== btn.dataset.id);
      this.save();
      this.render();
      this.toast('已删除', 'success');
    }));

    // 值点击复制
    formList.querySelectorAll('.form-field-value').forEach(el => el.addEventListener('click', async () => {
      const item = this.items.find(i => i.id === el.dataset.id);
      if (item) { await navigator.clipboard.writeText(item.content); this.toast('已复制', 'success'); }
    }));

    // 编辑标签
    formList.querySelectorAll('.group-edit-btn').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const oldTag = btn.dataset.tag;
      const newTag = prompt('输入新标签名:', oldTag);
      if (newTag !== null && newTag !== oldTag) {
        this.items.forEach(i => { if ((i.tag || '') === oldTag) i.tag = newTag; });
        if (this.collapsedTags.has(oldTag)) { this.collapsedTags.delete(oldTag); this.collapsedTags.add(newTag); }
        this.save();
        this.render();
        this.toast('已更新', 'success');
      }
    }));

    // 删除标签组
    formList.querySelectorAll('.group-delete-btn').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('确定删除该标签下所有项?')) {
        const tag = btn.dataset.tag;
        this.items = this.items.filter(i => (i.tag || '') !== tag);
        this.collapsedTags.delete(tag);
        this.save();
        this.render();
        this.toast('已删除', 'success');
      }
    }));
  }

  showEditDialog(item) {
    const existing = document.getElementById('editDialog');
    if (existing) existing.remove();
    const dialog = document.createElement('div');
    dialog.id = 'editDialog';
    dialog.className = 'edit-dialog-overlay';
    dialog.innerHTML = `<div class="edit-dialog">
      <div class="edit-dialog-header"><h3>编辑</h3><button class="edit-dialog-close">&times;</button></div>
      <div class="edit-dialog-body">
        <div class="edit-field"><label>标签</label><input type="text" id="editTag" value="${this.esc(item.tag || '')}"></div>
        <div class="edit-field"><label>内容</label><textarea id="editContent" style="min-height:100px">${this.esc(item.content)}</textarea></div>
      </div>
      <div class="edit-dialog-footer"><button class="btn-cancel">取消</button><button class="btn-save">保存</button></div>
    </div>`;
    document.body.appendChild(dialog);
    const close = () => dialog.remove();
    dialog.querySelector('.edit-dialog-close').addEventListener('click', close);
    dialog.querySelector('.btn-cancel').addEventListener('click', close);
    dialog.querySelector('.btn-save').addEventListener('click', () => {
      item.tag = document.getElementById('editTag').value.trim();
      item.content = document.getElementById('editContent').value;
      this.save();
      this.render();
      close();
      this.toast('已更新', 'success');
    });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  }

  export() {
    const blob = new Blob([JSON.stringify({ version: '1.0', items: this.items }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pins-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  }

  showImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const items = data.items || data;
        if (Array.isArray(items)) {
          items.forEach(item => { item.id = 'p-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9); this.items.push(item); });
          this.save();
          this.render();
          this.toast(`导入了 ${items.length} 项`, 'success');
        }
      } catch { this.toast('导入失败', 'error'); }
    };
    input.click();
  }

  async clearAll() {
    if (!this.items.length) return;
    if (confirm('确定清空所有数据?')) { this.items = []; this.save(); this.render(); this.toast('已清空', 'success'); }
  }

  save() { chrome.storage.local.set({ pickedItems: this.items }); }

  toast(message, type = 'info') {
    const existing = document.querySelector('.sidebar-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `sidebar-toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2000);
  }

  esc(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}

// ==================== TabSearchController ====================
class TabSearchController {
  constructor() {
    this.allTabs = [];
    this.filteredTabs = [];
    this.selectedIndex = -1;
    this.searchTimeout = null;
  }

  init() {
    this.bindEvents();
    this.loadAllTabs();
  }

  onShow() { this.loadAllTabs(); }

  async loadAllTabs() {
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      this.allTabs = windows.flatMap(w => w.tabs.map(t => ({
        id: t.id, title: t.title || '无标题', url: t.url || '', favicon: t.favIconUrl || '', windowId: w.id, active: t.active
      }))).filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('about:'));
      document.getElementById('totalTabCount').textContent = this.allTabs.length;
      this.filteredTabs = [...this.allTabs];
      this.render();
    } catch (error) { console.error('加载标签页失败:', error); }
  }

  bindEvents() {
    document.getElementById('tabsearchInput')?.addEventListener('input', () => { clearTimeout(this.searchTimeout); this.searchTimeout = setTimeout(() => this.search(), 150); });
    document.getElementById('refreshTabsBtn')?.addEventListener('click', () => this.loadAllTabs());
    document.getElementById('tabsearchList')?.addEventListener('click', (e) => {
      const item = e.target.closest('.tabsearch-item');
      if (item) { this.selectedIndex = parseInt(item.dataset.index); this.render(); this.openSelected(); return; }
      const closeBtn = e.target.closest('.tabsearch-close');
      if (closeBtn) { e.stopPropagation(); this.closeTab(parseInt(closeBtn.dataset.tabId)); }
    });
    document.addEventListener('keydown', (e) => {
      if (!this.isActive()) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.selectNext(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.selectNext(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.openSelected(); }
      else if (e.key === 'Delete') { e.preventDefault(); this.closeSelected(); }
    });
  }

  isActive() { return window.sidebarApp?.currentPage === 'tabsearch'; }

  search() {
    const query = document.getElementById('tabsearchInput').value.trim().toLowerCase();
    this.filteredTabs = query ? this.allTabs.filter(t => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query)) : [...this.allTabs];
    this.selectedIndex = this.filteredTabs.length > 0 ? 0 : -1;
    this.render();
  }

  selectNext(delta) {
    if (!this.filteredTabs.length) return;
    this.selectedIndex = (this.selectedIndex + delta + this.filteredTabs.length) % this.filteredTabs.length;
    this.render();
    const list = document.getElementById('tabsearchList');
    const selected = list?.querySelector('.tabsearch-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  openSelected() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.filteredTabs.length) return;
    const tab = this.filteredTabs[this.selectedIndex];
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  }

  async closeSelected() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.filteredTabs.length) return;
    const tab = this.filteredTabs[this.selectedIndex];
    await chrome.tabs.remove(tab.id);
    this.allTabs = this.allTabs.filter(t => t.id !== tab.id);
    this.filteredTabs = this.filteredTabs.filter(t => t.id !== tab.id);
    if (this.selectedIndex >= this.filteredTabs.length) this.selectedIndex = Math.max(0, this.filteredTabs.length - 1);
    document.getElementById('totalTabCount').textContent = this.allTabs.length;
    this.render();
  }

  async closeTab(tabId) {
    await chrome.tabs.remove(tabId);
    this.allTabs = this.allTabs.filter(t => t.id !== tabId);
    this.filteredTabs = this.filteredTabs.filter(t => t.id !== tabId);
    document.getElementById('totalTabCount').textContent = this.allTabs.length;
    this.render();
  }

  clearSelection() {
    this.selectedIndex = -1;
    const input = document.getElementById('tabsearchInput');
    if (input) input.value = '';
    this.filteredTabs = [...this.allTabs];
    this.render();
  }

  highlightMatch(text, query) {
    if (!query) return this.esc(text);
    const escaped = this.esc(text);
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }

  render() {
    const list = document.getElementById('tabsearchList');
    if (!list) return;
    const query = document.getElementById('tabsearchInput')?.value.trim().toLowerCase() || '';
    if (!this.filteredTabs.length) { list.innerHTML = '<div class="empty-hint">没有打开的标签页</div>'; return; }
    list.innerHTML = this.filteredTabs.map((tab, idx) => `<div class="tabsearch-item ${idx === this.selectedIndex ? 'selected' : ''}" data-index="${idx}"><img class="tabsearch-favicon" src="${tab.favicon}" onerror="this.style.display='none'"><div class="tabsearch-content"><div class="tabsearch-title">${this.highlightMatch(tab.title, query)}</div><div class="tabsearch-url">${this.highlightMatch(tab.url, query)}</div></div><span class="tabsearch-window">窗口 ${tab.windowId}</span><button class="tabsearch-close" data-tab-id="${tab.id}" title="关闭">×</button></div>`).join('');
  }

  esc(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}

// ==================== SidebarApp ====================
class SidebarApp {
  constructor() {
    this.controllers = {};
    this.currentPage = 'groups';
  }

  async init() {
    this.controllers.groups = new GroupsController();
    this.controllers.pickedItems = new PickedItemsController();
    this.controllers.tabSearch = new TabSearchController();
    await this.controllers.groups.loadData();
    this.controllers.pickedItems.init();
    this.controllers.tabSearch.init();
    this.bindNavigation();
    this.bindGlobalEvents();
    this.updateStats();
  }

  bindNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => this.switchPage(btn.dataset.page)));
  }

  switchPage(pageName) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.page === pageName));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${pageName}`));
    this.currentPage = pageName;
    const controller = this.controllers[pageName];
    if (controller?.onShow) controller.onShow();
  }

  bindGlobalEvents() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const editDialog = document.getElementById('editDialog');
        if (editDialog) editDialog.remove();
        if (this.currentPage === 'tabsearch') this.controllers.tabSearch.clearSelection();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (this.currentPage === 'forms') document.getElementById('searchInput')?.focus();
        else if (this.currentPage === 'tabsearch') document.getElementById('tabsearchInput')?.focus();
      }
    });
  }

  updateStats() {
    const gc = this.controllers.groups;
    const totalTabs = Object.values(gc.tabs || {}).flat().length;
    document.getElementById('stats').textContent = `${gc.groups?.length || 0} 个分组 · ${totalTabs} 个标签`;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.sidebarApp = new SidebarApp();
  window.sidebarApp.init();
});
