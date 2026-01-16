/**
 * GroupView - 分组视图模块
 * 负责分组看板的渲染和交互
 */

import { escapeHtml, formatTime, getColorClass, exportData, importData } from './Utils.js';

class GroupView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.groups = [];
    this.tabs = {};
    this.kanban = null;
    this.boardActionsObserver = null;
  }

  /**
   * 更新数据
   */
  updateData(data) {
    this.groups = data.groups || [];
    this.tabs = data.tabs || {};
  }

  /**
   * 渲染看板
   */
  render() {
    const emptyState = document.getElementById('emptyState');
    const stats = document.getElementById('stats');
    const tabboard = document.getElementById('tabboard');

    // 计算总标签数
    const totalTabs = Object.values(this.tabs).flat().length;
    stats.textContent = `${totalTabs} 个标签页 · ${this.groups.length} 个分组`;

    // 只有没有任何分组时才显示空状态
    if (this.groups.length === 0) {
      tabboard.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    // 添加操作按钮区域
    const actionsHeader = document.createElement('div');
    actionsHeader.className = 'board-actions-header';
    actionsHeader.innerHTML = `
      <button class="board-action-btn open-all-groups-btn" title="打开所有分组">打开全部</button>
      <button class="board-action-btn clear-all-groups-btn" title="清空所有分组">清空</button>
      <button class="board-action-btn export-groups-btn" title="导出分组数据">导出</button>
      <button class="board-action-btn import-groups-btn" title="导入分组数据">导入</button>
    `;

    // 清空并添加操作按钮
    tabboard.innerHTML = '';
    tabboard.appendChild(actionsHeader);

    const boards = this._convertToJKanbanFormat();

    // 销毁旧的 kanban 实例
    if (this.kanban) {
      const container = document.getElementById('tabboard');
      const boardsToRemove = container.querySelectorAll('.kanban-board');
      boardsToRemove.forEach(board => board.remove());
      this.kanban = null;
    }

    // 创建新的 kanban 实例
    this.kanban = new jKanban({
      element: '#tabboard',
      gutter: '12px',
      widthBoard: '280px',
      responsivePercentage: false,
      dragItems: true,
      dragBoards: true,
      boards: boards,
      click: (el) => this._handleItemClick(el),
      dropEl: (el, target, source, sibling) => this._handleDropEl(el, target, source, sibling),
      dragendEl: (el) => this._handleDragEndEl(el),
      buttonClick: (el, boardId) => this._handleBoardButtonClick(el, boardId),
      itemAddOptions: {
        enabled: false
      }
    });

    // 设置看板操作按钮
    this._setupBoardActions();
  }

  /**
   * 转换数据为 jKanban 格式
   */
  _convertToJKanbanFormat() {
    return this.groups.map(group => {
      const groupTabs = this.tabs[group.id] || [];
      return {
        id: group.id,
        title: group.name,
        class: `kanban-board-${getColorClass(group.color)}`,
        item: groupTabs.map(tab => ({
          id: tab.id,
          title: `
            <div class="kanban-item-content">
              <div class="kanban-item-header">
                <img class="kanban-item-favicon" src="${escapeHtml(tab.favicon || '')}" loading="lazy">
                <span class="kanban-item-title">${escapeHtml(tab.title)}</span>
              </div>
              <div class="kanban-item-url">${escapeHtml(tab.url)}</div>
              <div class="kanban-item-time">${formatTime(tab.timestamp)}</div>
              <button class="kanban-item-delete" data-id="${tab.id}" title="删除">×</button>
            </div>
          `,
          url: tab.url,
          timestamp: tab.timestamp
        }))
      };
    });
  }

  /**
   * 设置看板操作按钮
   */
  _setupBoardActions() {
    // 断开旧的 observer
    if (this.boardActionsObserver) {
      this.boardActionsObserver.disconnect();
    }

    // 立即添加一次按钮
    this._addBoardActionButtons();

    // 创建新的 observer 监听 DOM 变化
    this.boardActionsObserver = new MutationObserver((mutations) => {
      const hasNewBoards = mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(node =>
          node.nodeType === 1 && (
            node.classList?.contains('kanban-board') ||
            node.querySelector?.('.kanban-board')
          )
        )
      );

      if (hasNewBoards) {
        this._addBoardActionButtons();
      }
    });

    this.boardActionsObserver.observe(document.getElementById('tabboard'), {
      childList: true,
      subtree: true
    });

    // 设置删除按钮的事件委托
    this._setupDeleteButtons();

    // 绑定分组视图操作按钮
    this._setupGroupActionButtons();
  }

  /**
   * 添加看板操作按钮
   */
  _addBoardActionButtons() {
    const groupView = document.getElementById('groupView');
    const actionsHeader = document.querySelector('.board-actions-header');

    // 使用 groupView 的完整高度作为基准
    const viewHeight = groupView.clientHeight;

    // 计算看板可用高度
    let boardMaxHeight = viewHeight - 24; // 减去 tabboard 的 padding (12px * 2)
    if (actionsHeader) {
      boardMaxHeight -= actionsHeader.offsetHeight + 8; // 减去按钮高度和 margin-bottom
    }

    document.querySelectorAll('.kanban-board').forEach(board => {
      const header = board.querySelector('.kanban-title-board');
      if (header && !header.querySelector('.board-actions')) {
        const boardId = board.getAttribute('data-id');
        const actions = document.createElement('div');
        actions.className = 'board-actions';
        actions.innerHTML = `
          <button class="board-action-btn open-all" data-board-id="${boardId}" title="打开所有">📂</button>
          <button class="board-action-btn clear-group" data-board-id="${boardId}" title="清空分组">🗑️</button>
        `;
        header.appendChild(actions);
      }

      // 设置看板高度，使内容区域可以滚动
      board.style.height = `${Math.max(200, boardMaxHeight)}px`; // 最小高度 200px
    });

    // 绑定按钮事件
    document.querySelectorAll('.open-all').forEach(btn => {
      btn.removeEventListener('click', this._handleOpenAll);
      btn.addEventListener('click', this._handleOpenAll.bind(this));
    });

    document.querySelectorAll('.clear-group').forEach(btn => {
      btn.removeEventListener('click', this._handleClearGroup);
      btn.addEventListener('click', this._handleClearGroup.bind(this));
    });
  }

  /**
   * 设置删除按钮事件 - 使用事件委托
   */
  _setupDeleteButtons() {
    const container = document.getElementById('tabboard');
    container.removeEventListener('click', this._handleDeleteButtonClick);
    container.addEventListener('click', this._handleDeleteButtonClick.bind(this), true);
  }

  /**
   * 处理删除按钮点击
   */
  async _handleDeleteButtonClick(e) {
    const deleteBtn = e.target.closest('.kanban-item-delete');
    if (!deleteBtn) return;

    e.stopPropagation();
    e.preventDefault();
    e.stopImmediatePropagation();

    const tabId = deleteBtn.dataset.id;
    const itemEl = deleteBtn.closest('.kanban-item');
    const boardEl = itemEl?.closest('.kanban-board');
    const groupId = boardEl?.getAttribute('data-id');

    if (tabId && groupId) {
      await this.dataManager.sendMessage('deleteTab', { tabId, groupId });
    }
  }

  /**
   * 处理项目点击
   */
  _handleItemClick(el) {
    const itemId = el.getAttribute('data-eid');
    const tab = this._findTab(itemId);
    if (tab) {
      this.dataManager.sendMessage('openTab', { url: tab.url });
    }
  }

  /**
   * 处理拖拽结束 - 保存更改到存储
   */
  async _handleDropEl(el, target, source, sibling) {
    const itemId = el.getAttribute('data-eid');
    const targetBoardId = target.parentElement.getAttribute('data-id');
    const sourceBoardId = source.parentElement.getAttribute('data-id');

    if (targetBoardId === sourceBoardId) {
      return;
    }

    // 通过 background 更新存储，避免直接修改全局变量
    await this.dataManager.sendMessage('moveTab', {
      tabId: itemId,
      fromGroup: sourceBoardId,
      toGroup: targetBoardId
    });
  }

  /**
   * 处理拖拽结束
   */
  _handleDragEndEl(el) {
    // 可以在这里添加额外的处理逻辑
  }

  /**
   * 处理看板按钮点击
   */
  _handleBoardButtonClick(el, boardId) {
    // 可以在这里添加处理逻辑
  }

  /**
   * 处理打开所有按钮
   */
  async _handleOpenAll(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const groupId = btn.dataset.boardId;
    await this.dataManager.sendMessage('openGroup', { groupId });
  }

  /**
   * 处理清空分组按钮
   */
  async _handleClearGroup(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const groupId = btn.dataset.boardId;
    const groupTabs = this.tabs[groupId] || [];

    if (groupTabs.length === 0) return;

    const groupName = this.groups.find(g => g.id === groupId)?.name;
    if (!confirm(`确定要清空 "${groupName}" 分组吗？`)) {
      return;
    }

    for (const tab of groupTabs) {
      await this.dataManager.sendMessage('deleteTab', {
        tabId: tab.id,
        groupId
      });
    }
  }

  /**
   * 设置分组视图操作按钮
   */
  _setupGroupActionButtons() {
    const openAllBtn = document.querySelector('.open-all-groups-btn');
    const clearAllBtn = document.querySelector('.clear-all-groups-btn');
    const exportBtn = document.querySelector('.export-groups-btn');
    const importBtn = document.querySelector('.import-groups-btn');

    if (openAllBtn) {
      openAllBtn.addEventListener('click', async () => {
        if (!confirm(`确定要打开所有 ${this.groups.length} 个分组吗？`)) return;
        for (const group of this.groups) {
          await this.dataManager.sendMessage('openGroup', { groupId: group.id });
        }
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', async () => {
        if (!confirm(`确定要清空所有分组吗？`)) return;
        await this.dataManager.sendMessage('clearAllGroups');
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', () => this._exportData());
    }

    if (importBtn) {
      importBtn.addEventListener('click', () => this._importData());
    }
  }

  /**
   * 导出分组和标签数据
   */
  _exportData() {
    const data = {
      version: '1.0',
      exportTime: new Date().toISOString(),
      groups: this.groups,
      tabs: this.tabs
    };
    const filename = `tabboard-groups-${new Date().toISOString().slice(0, 10)}.json`;
    exportData(data, filename);
  }

  /**
   * 导入分组和标签数据
   */
  _importData() {
    importData(async (data) => {
      if (!data.groups || !Array.isArray(data.groups) || !data.tabs) {
        alert('无效的数据格式');
        return;
      }

      const groupCount = data.groups.length;
      const tabCount = Object.values(data.tabs).flat().length;
      if (!confirm(`确定要导入 ${groupCount} 个分组和 ${tabCount} 个标签吗？这将替换现有数据。`)) {
        return;
      }

      await this.dataManager.sendMessage('importGroupsAndTabs', {
        groups: data.groups,
        tabs: data.tabs
      });

      await this.dataManager.loadData();
      this.render();
    });
  }

  /**
   * 查找标签页
   */
  _findTab(tabId) {
    for (const groupId in this.tabs) {
      const tab = this.tabs[groupId].find(t => t.id === tabId);
      if (tab) return tab;
    }
    return null;
  }
}

export default GroupView;
