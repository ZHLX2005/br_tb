/**
 * TimelineView - 时序视图模块
 * 负责时序快照的渲染和交互
 */

import { escapeHtml, formatSnapshotTime, exportData, importData } from './Utils.js';
import { modal } from '../../../shared/ModalDialog.js';
import SearchHelper from './SearchHelper.js';

class TimelineView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.snapshots = [];
    this.filterMarkedOnly = false; // 筛选状态：是否只显示红色标记
    this.searchQuery = ''; // 搜索关键词
    this.searchInput = null;
    this.initSearch();
  }

  /**
   * 初始化搜索功能
   */
  initSearch() {
    this.searchInput = document.getElementById('timelineSearch');
    this.selectedIndex = -1;
    this.currentResults = [];

    if (this.searchInput) {
      let debounceTimer;
      this.searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.searchQuery = e.target.value.trim();
          this.selectedIndex = -1;
          this._performSearch();
        }, 150);
      });

      this.searchInput.addEventListener('keydown', (e) => {
        if (!this.currentResults.length) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex + 1) % this.currentResults.length;
          this._updateSelection();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.selectedIndex = this.selectedIndex <= 0 ? this.currentResults.length - 1 : this.selectedIndex - 1;
          this._updateSelection();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (this.selectedIndex >= 0 && this.currentResults[this.selectedIndex]) {
            this._openSelected();
          }
        } else if (e.key === 'Escape') {
          this._hideSearchDropdown();
        }
      });

      // 点击其他地方关闭搜索结果
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.timeline-search-container')) {
          this._hideSearchDropdown();
        }
      });
    }
  }

  /**
   * 更新选中状态
   */
  _updateSelection() {
    const items = document.querySelectorAll('.search-dropdown-item');
    items.forEach((item, idx) => {
      item.classList.toggle('selected', idx === this.selectedIndex);
    });
  }

  /**
   * 打开选中的项
   */
  _openSelected() {
    if (this.selectedIndex >= 0 && this.currentResults[this.selectedIndex]) {
      const item = this.currentResults[this.selectedIndex];
      this.dataManager.sendMessage('openTab', { url: item.url });
      this._hideSearchDropdown();
      this.searchInput.value = '';
    }
  }

  /**
   * 隐藏搜索下拉框
   */
  _hideSearchDropdown() {
    const dropdown = document.querySelector('.timeline-search-dropdown');
    if (dropdown) dropdown.remove();
  }

  /**
   * 显示搜索下拉框
   */
  _showSearchDropdown(results) {
    this._hideSearchDropdown();
    this.currentResults = results;
    this.selectedIndex = -1;

    const container = document.querySelector('.timeline-search-container');
    if (!container) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'timeline-search-dropdown';
    dropdown.innerHTML = results.map((item, idx) => `
      <div class="search-dropdown-item" data-url="${this._escapeHtmlAttribute(item.url)}" data-idx="${idx}">
        <img class="search-dropdown-favicon" src="${this._escapeHtmlAttribute(item.favicon || '')}" onerror="this.style.display='none'">
        <div class="search-dropdown-content">
          <div class="search-dropdown-title">${SearchHelper.highlightExact(item.title || '', this.searchQuery)}</div>
          <div class="search-dropdown-url">${SearchHelper.highlightExact(item.url || '', this.searchQuery)}</div>
        </div>
        <span class="search-dropdown-time">${formatSnapshotTime(item.timestamp)}</span>
      </div>
    `).join('');

    container.appendChild(dropdown);

    // 绑定点击事件
    dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.dataset.url;
        if (url) {
          this.dataManager.sendMessage('openTab', { url });
          this._hideSearchDropdown();
          this.searchInput.value = '';
        }
      });
    });
  }

  /**
   * 执行搜索
   */
  async _performSearch() {
    this._hideSearchDropdown();

    if (!this.searchQuery) {
      return;
    }

    const matchedItems = [];
    for (const snapshot of this.snapshots) {
      for (const tab of snapshot.tabs) {
        if (SearchHelper.containsMatch(tab.title || '', this.searchQuery) ||
            SearchHelper.fuzzyMatch(tab.title || '', this.searchQuery) ||
            SearchHelper.containsMatch(tab.url || '', this.searchQuery)) {
          matchedItems.push({ ...tab, timestamp: snapshot.timestamp });
          if (matchedItems.length >= 5) break;
        }
      }
      if (matchedItems.length >= 5) break;
    }

    if (matchedItems.length > 0) {
      this._showSearchDropdown(matchedItems);
    }
  }

  /**
   * 更新快照数据
   */
  updateData(data) {
    this.snapshots = data.timelineSnapshots || [];
  }

  /**
   * 切换筛选状态
   */
  toggleMarkedFilter() {
    this.filterMarkedOnly = !this.filterMarkedOnly;
    this.render();
  }

  /**
   * 渲染时序视图
   */
  render() {
    const emptyState = document.getElementById('emptyState');
    const stats = document.getElementById('stats');
    const timelineList = document.getElementById('timelineList');

    // 根据筛选状态过滤快照
    const filteredSnapshots = this._getFilteredSnapshots();

    // 计算总快照数和标签数
    const totalSnapshots = filteredSnapshots.length;
    const totalTabs = filteredSnapshots.reduce((sum, s) => sum + s.tabs.length, 0);
    const filterLabel = this.filterMarkedOnly ? ' (已标记)' : '';
    stats.textContent = `${totalSnapshots} 个快照${filterLabel} · ${totalTabs} 个标签页`;

    if (filteredSnapshots.length === 0) {
      timelineList.innerHTML = '';
      if (this.snapshots.length === 0) {
        emptyState.style.display = 'flex';
      } else {
        // 有数据但筛选后为空
        timelineList.innerHTML = `
          <div class="timeline-empty-filter">
            <div class="empty-icon"></div>
            <p>没有标记的标签</p>
          </div>
        `;
        emptyState.style.display = 'none';
      }
      return;
    }

    emptyState.style.display = 'none';

    // 渲染快照列表
    timelineList.innerHTML = `
      <div class="timeline-actions-header">
        <button class="timeline-action-btn restore-all-btn" title="恢复所有快照">打开全部</button>
        <button class="timeline-action-btn clear-all-btn" title="清空所有快照">清空</button>
        <button class="timeline-action-btn extract-marked-btn" title="将所有标记为重要的标签提取为新分组，并删除非重要快照">提取为分组</button>
        <button class="timeline-action-btn export-timeline-btn" title="导出快照数据">导出</button>
        <button class="timeline-action-btn import-timeline-btn" title="导入快照数据">导入</button>
        <button class="timeline-action-btn filter-marked-btn ${this.filterMarkedOnly ? 'active' : ''}" title="只显示红色标记">
          ${this.filterMarkedOnly ? '显示全部' : '只显示标记'}
        </button>
      </div>
      <div class="timeline-snapshots-list">
        ${filteredSnapshots.map(snapshot => this._renderSnapshot(snapshot)).join('')}
      </div>
    `;

    this._setupEventListeners();
  }

  /**
   * 获取过滤后的快照列表
   */
  _getFilteredSnapshots() {
    if (!this.filterMarkedOnly) {
      return this.snapshots;
    }

    // 只返回包含已标记标签的快照
    return this.snapshots
      .map(snapshot => ({
        ...snapshot,
        tabs: snapshot.tabs.filter(tab => tab.marked)
      }))
      .filter(snapshot => snapshot.tabs.length > 0);
  }

  /**
   * 渲染单个快照
   */
  _renderSnapshot(snapshot) {
    const displayTabs = snapshot.tabs.slice(0, 3);
    const hasMore = snapshot.tabs.length > 3;
    const moreCount = snapshot.tabs.length - 3;

    return `
      <div class="timeline-snapshot" data-snapshot-id="${snapshot.id}">
        <div class="snapshot-header">
          <div class="snapshot-info">
            <span class="snapshot-time">${formatSnapshotTime(snapshot.timestamp)}</span>
            <span class="snapshot-count">${snapshot.tabs.length} 个标签</span>
          </div>
          <div class="snapshot-actions">
            <button class="snapshot-action-btn restore-snapshot" data-id="${snapshot.id}" title="恢复此快照">恢复</button>
            <button class="snapshot-action-btn delete-snapshot" data-id="${snapshot.id}" title="删除快照">Del</button>
          </div>
        </div>
        <div class="snapshot-tabs">
          ${displayTabs.map(tab => this._renderTabRow(tab, snapshot.id)).join('')}
          ${hasMore ? `
            <button class="snapshot-more-btn" data-snapshot-id="${snapshot.id}">
              还有 ${moreCount} 个标签... ▼
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * 渲染单个标签行
   */
  _renderTabRow(tab, snapshotId) {
    const markedClass = tab.marked ? 'marked' : '';
    const markIcon = tab.marked ? '●' : '';

    // 对 data 属性不使用 escapeHtml，避免 URL 转义导致匹配失败
    return `
      <div class="snapshot-tab-row ${markedClass}"
           data-url="${this._escapeHtmlAttribute(tab.url)}"
           data-snapshot-id="${snapshotId}"
           data-tab-url="${this._escapeHtmlAttribute(tab.url)}">
        <span class="tab-mark-indicator">${markIcon}</span>
        <img class="snapshot-tab-favicon" src="${this._escapeHtmlAttribute(tab.favicon || '')}" loading="lazy">
        <span class="snapshot-tab-title">${escapeHtml(tab.title)}</span>
      </div>
    `;
  }

  /**
   * 转义 HTML 属性值（只转义必要的字符，避免 URL 被破坏）
   */
  _escapeHtmlAttribute(str) {
    return str
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * 设置时序视图事件监听器
   */
  _setupEventListeners() {
    // 点击快照中的标签行打开标签页
    document.querySelectorAll('.snapshot-tab-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // 如果是右键点击，不处理打开逻辑
        if (e.button === 2) return;

        const url = row.dataset.url;
        if (url) {
          this.dataManager.sendMessage('openTab', { url });
        }
      });

      // 右键菜单
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(e, row);
      });
    });

    // 点击其他地方关闭右键菜单
    document.addEventListener('click', () => {
      this._hideContextMenu();
    });

    // "更多"按钮 - 展开显示所有标签
    document.querySelectorAll('.snapshot-more-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._expandSnapshot(btn);
      });
    });

    // 恢复单个快照
    document.querySelectorAll('.restore-snapshot').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this._restoreSnapshot(btn.dataset.id);
      });
    });

    // 删除单个快照
    document.querySelectorAll('.delete-snapshot').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this._deleteSnapshot(btn.dataset.id);
      });
    });

    // 恢复所有快照按钮
    const restoreAllBtn = document.querySelector('.restore-all-btn');
    if (restoreAllBtn) {
      restoreAllBtn.addEventListener('click', () => this._restoreAllSnapshots());
    }

    // 清空所有快照按钮
    const clearAllBtn = document.querySelector('.clear-all-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => this._clearAllSnapshots());
    }

    // 提取标记为分组按钮
    const extractBtn = document.querySelector('.extract-marked-btn');
    if (extractBtn) {
      extractBtn.addEventListener('click', () => this._extractMarkedAsGroup());
    }

    // 导出快照数据按钮
    const exportBtn = document.querySelector('.export-timeline-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this._exportData());
    }

    // 导入快照数据按钮
    const importBtn = document.querySelector('.import-timeline-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this._importData());
    }

    // 筛选标记按钮
    const filterBtn = document.querySelector('.filter-marked-btn');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => this.toggleMarkedFilter());
    }
  }

  /**
   * 显示右键菜单
   */
  _showContextMenu(event, row) {
    // 移除已存在的菜单
    this._hideContextMenu();

    const isMarked = row.classList.contains('marked');
    const snapshotId = row.dataset.snapshotId;
    const tabUrl = row.dataset.tabUrl;

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="${isMarked ? 'unmark' : 'mark'}">
        <span class="menu-icon">${isMarked ? '○' : '●'}</span>
        <span>${isMarked ? '取消标记' : '标记为重要'}</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="open">
        <span class="menu-icon">[Link]</span>
        <span>打开链接</span>
      </div>
      <div class="context-menu-item" data-action="copy">
        <span class="menu-icon">[Copy]</span>
        <span>复制链接</span>
      </div>
    `;

    // 定位菜单
    const x = event.clientX;
    const y = event.clientY;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    document.body.appendChild(menu);

    // 添加菜单项点击事件
    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = item.dataset.action;

        switch (action) {
          case 'mark':
            await this._toggleMark(snapshotId, tabUrl, true);
            break;
          case 'unmark':
            await this._toggleMark(snapshotId, tabUrl, false);
            break;
          case 'open':
            this.dataManager.sendMessage('openTab', { url: tabUrl });
            break;
          case 'copy':
            await navigator.clipboard.writeText(tabUrl);
            this._showToast('链接已复制', 'success');
            break;
        }

        this._hideContextMenu();
      });
    });

    // 阻止菜单的点击事件冒泡
    menu.addEventListener('click', (e) => e.stopPropagation());
  }

  /**
   * 隐藏右键菜单
   */
  _hideContextMenu() {
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }
  }

  /**
   * 切换标记状态
   */
  async _toggleMark(snapshotId, tabUrl, marked) {
    console.log('[TimelineView] Toggling mark:', { snapshotId, tabUrl, marked });

    const result = await this.dataManager.sendMessage('toggleTabMark', {
      snapshotId,
      tabUrl,
      marked
    });

    console.log('[TimelineView] Toggle result:', result);

    if (result && result.success) {
      // 重新加载数据并渲染
      await this.dataManager.loadData();
      this.render();
      this._showToast(marked ? '已标记为重要' : '已取消标记', 'success');
    } else {
      console.error('[TimelineView] Failed to toggle mark:', result);
      this._showToast('操作失败，请重试', 'error');
    }
  }

  /**
   * 显示提示消息
   */
  _showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // 根据类型选择颜色
    let bgColor = '#42a5f5'; // info
    if (type === 'success') bgColor = '#66bb6a';
    if (type === 'error') bgColor = '#ef5350';

    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${bgColor};
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  /**
   * 展开显示快照的所有标签
   */
  _expandSnapshot(btn) {
    const snapshotId = btn.dataset.snapshotId;
    const snapshot = this.snapshots.find(s => s.id === snapshotId);
    if (!snapshot) return;

    const tabsContainer = btn.parentElement;
    const expandBtn = btn;
    // 找到快照容器
    const snapshotEl = tabsContainer.closest('.timeline-snapshot');

    // 创建收起按钮
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'snapshot-collapse-btn';
    collapseBtn.textContent = '收起 ▲';
    collapseBtn.dataset.snapshotId = snapshotId;
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._collapseSnapshot(snapshotId);
    });

    // 替换展开按钮
    tabsContainer.insertBefore(collapseBtn, expandBtn);
    expandBtn.remove();

    // 显示所有标签
    const remainingTabs = snapshot.tabs.slice(3);
    remainingTabs.forEach(tab => {
      const tabRow = document.createElement('div');
      const markedClass = tab.marked ? 'marked' : '';
      const markIcon = tab.marked ? '●' : '';

      tabRow.className = `snapshot-tab-row ${markedClass}`;
      tabRow.dataset.url = tab.url;
      tabRow.dataset.snapshotId = snapshotId;
      tabRow.dataset.tabUrl = tab.url;

      tabRow.innerHTML = `
        <span class="tab-mark-indicator">${markIcon}</span>
        <img class="snapshot-tab-favicon" src="${this._escapeHtmlAttribute(tab.favicon || '')}" loading="lazy">
        <span class="snapshot-tab-title">${escapeHtml(tab.title)}</span>
      `;

      tabRow.addEventListener('click', (e) => {
        if (e.button === 2) return;
        this.dataManager.sendMessage('openTab', { url: tab.url });
      });

      tabRow.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(e, tabRow);
      });

      tabsContainer.appendChild(tabRow);
    });
  }

  /**
   * 收起快照的展开标签
   */
  _collapseSnapshot(snapshotId) {
    const snapshot = this.snapshots.find(s => s.id === snapshotId);
    if (!snapshot) return;

    const snapshotEl = document.querySelector(`.timeline-snapshot[data-snapshot-id="${snapshotId}"]`);
    if (!snapshotEl) return;

    const tabsContainer = snapshotEl.querySelector('.snapshot-tabs');
    const collapseBtn = tabsContainer.querySelector('.snapshot-collapse-btn');

    // 恢复原始的"还有xx个标签"按钮
    if (snapshot.tabs.length > 3) {
      const moreCount = snapshot.tabs.length - 3;
      const expandBtn = document.createElement('button');
      expandBtn.className = 'snapshot-more-btn';
      expandBtn.textContent = `还有 ${moreCount} 个标签... ▼`;
      expandBtn.dataset.snapshotId = snapshotId;
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._expandSnapshot(expandBtn);
      });
      tabsContainer.insertBefore(expandBtn, collapseBtn);
    }

    collapseBtn.remove();

    // 移除展开的标签行（保留前3个）
    const allRows = tabsContainer.querySelectorAll('.snapshot-tab-row');
    allRows.forEach((row, index) => {
      if (index >= 3) row.remove();
    });
  }

  /**
   * 恢复单个快照
   */
  async _restoreSnapshot(snapshotId) {
    const result = await this.dataManager.sendMessage('restoreSnapshot', { snapshotId });
    if (result.success) {
      await this.dataManager.loadData();
      this.render();
    }
  }

  /**
   * 删除单个快照
   */
  async _deleteSnapshot(snapshotId) {
    const confirmed = await modal.confirm('确定要删除这个快照吗？', {
      title: '删除快照',
      type: 'danger'
    });
    if (!confirmed) return;

    await this.dataManager.sendMessage('deleteTimelineSnapshot', { snapshotId });
    await this.dataManager.loadData();
    this.render();
  }

  /**
   * 恢复所有快照
   */
  async _restoreAllSnapshots() {
    const snapshotsToRestore = this.filterMarkedOnly ?
      this._getFilteredSnapshots() : this.snapshots;

    const totalTabs = snapshotsToRestore.reduce((sum, s) => sum + s.tabs.length, 0);
    const confirmed = await modal.confirm(`确定要恢复所有 ${snapshotsToRestore.length} 个快照吗？这将打开 ${totalTabs} 个标签页。`, {
      title: '恢复快照',
      type: 'warning'
    });
    if (!confirmed) {
      return;
    }

    for (const snapshot of snapshotsToRestore) {
      for (const tab of snapshot.tabs) {
        await this.dataManager.sendMessage('openTab', { url: tab.url });
      }
    }
  }

  /**
   * 清空所有快照
   */
  async _clearAllSnapshots() {
    const confirmed = await modal.confirm(`确定要清空所有 ${this.snapshots.length} 个快照吗？`, {
      title: '清空所有快照',
      type: 'danger'
    });
    if (!confirmed) return;

    for (const snapshot of this.snapshots) {
      await this.dataManager.sendMessage('deleteTimelineSnapshot', { snapshotId: snapshot.id });
    }
    await this.dataManager.loadData();
    this.render();
  }

  /**
   * 导出快照数据
   */
  _exportData() {
    const data = {
      version: '1.0',
      exportTime: new Date().toISOString(),
      snapshots: this.snapshots
    };
    const filename = `tabboard-timeline-${new Date().toISOString().slice(0, 10)}.json`;
    exportData(data, filename);
  }

  /**
   * 导入快照数据
   */
  _importData() {
    importData(async (data) => {
      if (!data.snapshots || !Array.isArray(data.snapshots)) {
        alert('无效的数据格式');
        return;
      }

      const importCount = data.snapshots.length;
      const confirmed = await modal.confirm(`确定要导入 ${importCount} 个快照吗？这将添加到现有快照中。`, {
        title: '导入快照',
        type: 'info'
      });
      if (!confirmed) {
        return;
      }

      const importResult = await this.dataManager.sendMessage('importTimelineSnapshots', {
        snapshots: data.snapshots
      });

      if (importResult.success) {
        const totalImported = importResult.imported || 0;
        const totalSnapshots = importResult.total || 0;
        alert(`成功导入 ${totalImported} 个快照，当前共有 ${totalSnapshots} 个快照。`);
      } else {
        alert('导入失败，请重试。');
        return;
      }

      await this.dataManager.loadData();
      this.render();
    });
  }

  /**
   * 提取标记为重要的标签为新分组
   */
  async _extractMarkedAsGroup() {
    // 收集所有标记为重要的标签
    const markedTabs = [];
    for (const snapshot of this.snapshots) {
      for (const tab of snapshot.tabs) {
        if (tab.marked) {
          // 避免重复添加相同 URL
          if (!markedTabs.some(t => t.url === tab.url)) {
            markedTabs.push({
              title: tab.title,
              url: tab.url,
              favicon: tab.favicon || ''
            });
          }
        }
      }
    }

    if (markedTabs.length === 0) {
      this._showToast('没有找到标记为重要的标签', 'info');
      return;
    }

    const confirmed = await modal.confirm(`找到 ${markedTabs.length} 个标记为重要的标签，确定要将它们提取为新分组并清空所有快照吗？`, {
      title: '提取重要标签',
      type: 'warning'
    });
    if (!confirmed) {
      return;
    }

    const result = await this.dataManager.sendMessage('extractMarkedAsGroup', {
      markedTabs
    });

    if (result.success) {
      await this.dataManager.loadData();
      this.render();
      this._showToast(`已将 ${markedTabs.length} 个标签提取到分组「${result.groupName}」`, 'success');
    } else {
      this._showToast('操作失败，请重试', 'error');
    }
  }
}

export default TimelineView;
