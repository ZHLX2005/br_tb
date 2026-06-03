/**
 * GroupView - 分组视图模块
 * 负责分组看板的渲染和交互
 */

import { escapeHtml, formatTime, getColorClass, exportData, importData } from '../shared/utils.js';
import { modal } from '../../shared/ModalDialog.js';

class GroupView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.groups = [];
    this.tabs = {};
    this.kanban = null;
    this.boardActionsObserver = null;
    this.visibleGroups = new Set(); // 存储可见分组的 ID
  }

  /**
   * 更新数据
   */
  updateData(data) {
    this.groups = data.groups || [];
    this.tabs = data.tabs || {};

    // 初始化可见分组设置
    this._initializeVisibleGroups(data.settings);
  }

  /**
   * 初始化可见分组设置
   */
  _initializeVisibleGroups(settings) {
    const savedVisibleGroups = settings?.visibleGroups;

    if (savedVisibleGroups && Array.isArray(savedVisibleGroups)) {
      this.visibleGroups = new Set(savedVisibleGroups);
    } else {
      // 默认显示所有分组
      this.visibleGroups = new Set(this.groups.map(g => g.id));
    }
  }

  /**
   * 获取可见分组列表
   */
  _getVisibleGroups() {
    return this.groups.filter(group => this.visibleGroups.has(group.id));
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
    const visibleGroups = this._getVisibleGroups();
    stats.textContent = `${totalTabs} 个标签页 · ${visibleGroups.length}/${this.groups.length} 个分组显示`;

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
      <button class="board-action-btn add-group-btn" title="添加新分组">+ 添加分组</button>
      <button class="board-action-btn filter-groups-btn" title="选择要显示的分组">筛选</button>
      <button class="board-action-btn refresh-sort-btn" title="按点击次数刷新排序">刷新排序</button>
      <button class="board-action-btn open-all-groups-btn" title="打开所有分组">打开全部</button>
      <button class="board-action-btn clear-all-groups-btn" title="清空所有分组">清空</button>
      <button class="board-action-btn import-bookmarks-btn" title="从浏览器书签导入">📑 导入书签</button>
      <button class="board-action-btn export-groups-btn" title="导出分组数据">导出</button>
      <button class="board-action-btn import-groups-btn" title="导入分组数据">导入</button>
    `;

    // 清空并添加操作按钮
    tabboard.innerHTML = '';
    tabboard.appendChild(actionsHeader);

    // 如果没有可见分组，显示提示
    if (visibleGroups.length === 0) {
      const noVisibleMsg = document.createElement('div');
      noVisibleMsg.className = 'no-visible-groups-message';
      noVisibleMsg.textContent = '当前没有显示的分组，请点击"筛选"按钮选择要显示的分组';
      noVisibleMsg.style.cssText = 'text-align: center; padding: 40px; color: #888; font-size: 14px;';
      tabboard.appendChild(noVisibleMsg);
      this._setupGroupActionButtons();
      return;
    }

    const boards = this._convertToJKanbanFormat(visibleGroups);

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
      dropBoard: (el, target, source, sibling) => this._handleDropBoard(el, target, source, sibling),
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
  _convertToJKanbanFormat(groupsToConvert = this.groups) {
    return groupsToConvert.map(group => {
      const groupTabs = this.tabs[group.id] || [];

      return {
        id: group.id,
        title: group.name,
        class: `kanban-board-${getColorClass(group.color)}`,
        item: groupTabs.map(tab => {
          const visitCount = tab.visitCount || 0;
          const visitBadge = visitCount > 0 ? `<span class="kanban-item-visits" title="访问次数">${visitCount} views</span>` : '';

          return {
            id: tab.id,
            title: `
              <div class="kanban-item-content">
                <div class="kanban-item-header">
                  <img class="kanban-item-favicon" src="${escapeHtml(tab.favicon || '')}" loading="lazy">
                  <span class="kanban-item-title">${escapeHtml(tab.title)}</span>
                  ${visitBadge}
                </div>
                <div class="kanban-item-url">${escapeHtml(tab.url)}</div>
                <div class="kanban-item-time">${formatTime(tab.timestamp)}</div>
                <button class="kanban-item-delete" data-id="${tab.id}" title="删除">×</button>
              </div>
            `,
            url: tab.url,
            timestamp: tab.timestamp
          };
        })
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
        const isGoto = this.groups.find(g => g.id === boardId)?.goto === true;
        const gotoText = isGoto ? 'Goto✓' : 'Goto';
        const gotoTitle = isGoto ? '已在 goto 圆环展示,点击取消' : '设为 goto 圆环展示源';
        const actions = document.createElement('div');
        actions.className = 'board-actions';
        actions.innerHTML = `
          <button class="board-action-btn open-all" data-board-id="${boardId}" title="打开所有">Open</button>
          <button class="board-action-btn clear-group" data-board-id="${boardId}" title="清空分组">Clear</button>
          <button class="board-action-btn delete-group" data-board-id="${boardId}" title="删除分组">Del</button>
          <button class="board-action-btn push-to-goto ${isGoto ? 'goto-active' : ''}" data-board-id="${boardId}" title="${gotoTitle}">${gotoText}</button>
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

    document.querySelectorAll('.delete-group').forEach(btn => {
      btn.removeEventListener('click', this._handleDeleteGroup);
      btn.addEventListener('click', this._handleDeleteGroup.bind(this));
    });

    document.querySelectorAll('.push-to-goto').forEach(btn => {
      btn.removeEventListener('click', this._handlePushToGotoRing);
      btn.addEventListener('click', this._handlePushToGotoRing.bind(this));
    });
  }

  /**
   * 设置删除按钮事件 - 使用事件委托
   */
  _setupDeleteButtons() {
    const container = document.getElementById('tabboard');
    container.removeEventListener('click', this._handleDeleteButtonClick);
    container.addEventListener('click', this._handleDeleteButtonClick.bind(this), true);

    container.removeEventListener('contextmenu', this._handleItemContextMenu);
    container.addEventListener('contextmenu', this._handleItemContextMenu.bind(this), true);
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
   * 处理项目右键 - 弹出编辑对话框(供 goto 圆环显示用)
   */
  _handleItemContextMenu(e) {
    const itemEl = e.target.closest('.kanban-item');
    if (!itemEl) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const tabId = itemEl.getAttribute('data-eid');
    const boardEl = itemEl.closest('.kanban-board');
    const groupId = boardEl?.getAttribute('data-id');
    if (!tabId || !groupId) return;

    const tab = this._findTab(tabId);
    if (!tab) return;

    this._showEditTabDialog(tab, groupId);
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

    // 获取 sibling 的 ID 来确定插入位置
    const siblingId = sibling?.getAttribute('data-eid') || null;

    // 通过 background 更新存储，包含位置信息
    await this.dataManager.sendMessage('moveTab', {
      tabId: itemId,
      fromGroup: sourceBoardId,
      toGroup: targetBoardId,
      afterTabId: siblingId  // 用于确定插入顺序
    });
  }

  /**
   * 处理拖拽结束
   */
  _handleDragEndEl(el) {
    // 可以在这里添加额外的处理逻辑
  }

  /**
   * 处理看板拖拽 - 保存看板顺序
   */
  async _handleDropBoard(el, target, source, sibling) {
    // 获取所有看板的当前顺序
    const container = document.querySelector('.kanban-container');
    const boardElements = container.querySelectorAll('.kanban-board');

    // 按照当前 DOM 顺序收集看板 ID
    const boardOrder = Array.from(boardElements).map(board => board.getAttribute('data-id'));

    // 更新看板顺序到存储
    await this.dataManager.sendMessage('updateBoardOrder', { boardOrder });
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
    const confirmed = await modal.confirm(`确定要清空 "${groupName}" 分组吗？`, {
      title: '清空分组',
      type: 'warning'
    });
    if (!confirmed) {
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
   * 处理删除分组按钮
   */
  async _handleDeleteGroup(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const groupId = btn.dataset.boardId;
    const groupTabs = this.tabs[groupId] || [];
    const groupName = this.groups.find(g => g.id === groupId)?.name;

    const message = groupTabs.length > 0
      ? `确定要删除 "${groupName}" 分组吗？该分组包含 ${groupTabs.length} 个标签，将被一起删除。`
      : `确定要删除 "${groupName}" 分组吗？`;

    const confirmed = await modal.confirm(message, {
      title: '删除分组',
      type: 'danger'
    });
    if (!confirmed) {
      return;
    }

    await this.dataManager.sendMessage('deleteGroup', { groupId });
    await this.dataManager.loadData();
    this.render();
  }

  /**
   * 处理 goto 按钮 - 切换 group 的 goto 标志
   * 同时只能有一个 group.goto === true
   * - 若当前 group 已经是 goto 源 → 取消(再次点击移除 goto 状态)
   * - 否则 → 设为 goto 源(其他 group 的 goto 自动清除)
   */
  async _handlePushToGotoRing(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const groupId = btn.dataset.boardId;
    const targetGroup = this.groups.find(g => g.id === groupId);
    if (!targetGroup) return;

    const willBeGoto = targetGroup.goto !== true;

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = willBeGoto ? '设置中…' : '移除中…';

    try {
      const result = await this.dataManager.sendMessage('setGroupAsGoto', { groupId });
      if (result && result.success) {
        // 更新本地内存中的 group.goto 状态(允许多个 group 同时 goto)
        targetGroup.goto = result.isGoto;
        // 重新渲染以更新所有 board 按钮的激活态
        this.render();

        if (result.isGoto) {
          const tabCount = Math.min(6, (this.tabs[groupId] || []).length);
          const msg = tabCount > 0
            ? `已将 "${targetGroup.name}" 加入 goto 圆环展示\n(圆环将显示该分组前 ${tabCount} 个标签)`
            : `已将 "${targetGroup.name}" 加入 goto 圆环展示\n(分组为空,圆环暂不显示菜单项)`;
          alert(msg);
        } else {
          alert(`已从 goto 圆环移除 "${targetGroup.name}"`);
        }
      } else {
        alert(`操作失败: ${result?.error || '未知错误'}`);
      }
    } catch (err) {
      alert(`操作失败: ${err.message || err}`);
    } finally {
      btn.disabled = false;
      if (document.body.contains(btn)) {
        btn.textContent = originalText;
      }
    }
  }

  /**
   * 设置分组视图操作按钮
   */
  _setupGroupActionButtons() {
    const addGroupBtn = document.querySelector('.add-group-btn');
    const filterBtn = document.querySelector('.filter-groups-btn');
    const refreshSortBtn = document.querySelector('.refresh-sort-btn');
    const openAllBtn = document.querySelector('.open-all-groups-btn');
    const clearAllBtn = document.querySelector('.clear-all-groups-btn');
    const importBookmarksBtn = document.querySelector('.import-bookmarks-btn');
    const exportBtn = document.querySelector('.export-groups-btn');
    const importBtn = document.querySelector('.import-groups-btn');

    if (addGroupBtn) {
      addGroupBtn.addEventListener('click', () => this._showAddGroupDialog());
    }

    if (filterBtn) {
      filterBtn.addEventListener('click', () => this._showGroupFilterDialog());
    }

    if (refreshSortBtn) {
      refreshSortBtn.addEventListener('click', () => this._refreshAndSort());
    }

    if (openAllBtn) {
      openAllBtn.addEventListener('click', async () => {
        const confirmed = await modal.confirm(`确定要打开所有 ${this.groups.length} 个分组吗？`, {
          title: '打开所有分组',
          type: 'warning'
        });
        if (!confirmed) return;
        for (const group of this.groups) {
          await this.dataManager.sendMessage('openGroup', { groupId: group.id });
        }
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', async () => {
        const confirmed = await modal.confirm('确定要清空所有分组吗？', {
          title: '清空所有分组',
          type: 'danger'
        });
        if (!confirmed) return;
        await this.dataManager.sendMessage('clearAllGroups');
      });
    }

    if (importBookmarksBtn) {
      importBookmarksBtn.addEventListener('click', () => this._showBookmarkImportDialog());
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
      const confirmed = await modal.confirm(`确定要导入 ${groupCount} 个分组和 ${tabCount} 个标签吗？这将替换现有数据。`, {
        title: '导入数据',
        type: 'warning'
      });
      if (!confirmed) {
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
   * 显示书签导入对话框
   * 从浏览器书签树中选择书签，导入到指定分组
   */
  _showBookmarkImportDialog() {
    if (this.groups.length === 0) {
      alert('请先创建一个分组再导入书签');
      return;
    }

    // 移除已存在的对话框
    const existing = document.getElementById('bookmark-import-dialog');
    if (existing) existing.remove();

    // 选中书签的临时存储：{ [bookmarkId]: { title, url } }
    const selectedBookmarks = new Map();

    const overlay = document.createElement('div');
    overlay.id = 'bookmark-import-dialog';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #f8f9fa; border-radius: 8px; padding: 20px;
      width: 720px; max-width: 90vw; height: 560px; max-height: 85vh;
      display: flex; flex-direction: column; gap: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    `;

    // 头部
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    header.innerHTML = `
      <h3 style="margin:0; font-size:18px;">从浏览器书签导入</h3>
      <button class="bm-close-btn" style="background:none; border:none; font-size:20px; cursor:pointer;">×</button>
    `;
    dialog.appendChild(header);

    // 工具栏：全选/全不选 + 目标分组
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; gap:10px; flex-wrap: wrap;';
    toolbar.innerHTML = `
      <button class="bm-select-all-btn" style="padding:6px 12px; cursor:pointer;">全选书签</button>
      <button class="bm-deselect-all-btn" style="padding:6px 12px; cursor:pointer;">全不选</button>
      <span style="margin-left:auto; display:flex; align-items:center; gap:6px;">
        <span style="font-weight:500;">目标分组：</span>
        <select class="bm-target-group" style="padding:6px 10px; min-width:160px;">
          ${this.groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </span>
    `;
    dialog.appendChild(toolbar);

    // 书签树容器
    const treeContainer = document.createElement('div');
    treeContainer.className = 'bm-tree';
    treeContainer.style.cssText = `
      flex: 1; overflow: auto; background: white; border-radius: 4px;
      padding: 10px; border: 1px solid #e0e0e0; min-height: 0;
    `;
    treeContainer.innerHTML = '<div style="text-align:center; color:#888; padding:20px;">加载书签中…</div>';
    dialog.appendChild(treeContainer);

    // 底部状态栏 + 导入按钮
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding-top:10px; border-top:1px solid #ddd;';
    footer.innerHTML = `
      <span class="bm-selected-count" style="color:#666; font-size:13px;">已选 0 个</span>
      <div>
        <button class="bm-cancel-btn" style="margin-right:10px; padding:8px 16px; cursor:pointer; background:#6c757d; color:white; border:none; border-radius:4px;">取消</button>
        <button class="bm-import-btn" style="padding:8px 16px; cursor:pointer; background:#007bff; color:white; border:none; border-radius:4px;">导入</button>
      </div>
    `;
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const closeDialog = () => overlay.remove();
    const updateCount = () => {
      footer.querySelector('.bm-selected-count').textContent = `已选 ${selectedBookmarks.size} 个`;
    };

    // 关闭按钮
    header.querySelector('.bm-close-btn').addEventListener('click', closeDialog);
    footer.querySelector('.bm-cancel-btn').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        closeDialog();
        document.removeEventListener('keydown', onEsc);
      }
    });

    // 全选/全不选
    footer.previousElementSibling; // (treeContainer not used here)
    toolbar.querySelector('.bm-select-all-btn').addEventListener('click', () => {
      treeContainer.querySelectorAll('.bm-bookmark-item').forEach(el => {
        if (!el.classList.contains('selected')) {
          el.classList.add('selected');
          selectedBookmarks.set(el.dataset.id, {
            title: el.dataset.title,
            url: el.dataset.url
          });
        }
      });
      updateCount();
    });
    toolbar.querySelector('.bm-deselect-all-btn').addEventListener('click', () => {
      treeContainer.querySelectorAll('.bm-bookmark-item.selected').forEach(el => el.classList.remove('selected'));
      selectedBookmarks.clear();
      updateCount();
    });

    // 渲染书签节点（递归）
    const renderNode = (node, level = 0) => {
      const wrap = document.createElement('div');
      wrap.className = 'bm-node';

      if (node.url) {
        // 书签
        const item = document.createElement('div');
        item.className = 'bm-bookmark-item';
        item.dataset.id = node.id;
        item.dataset.title = node.title || node.url;
        item.dataset.url = node.url;
        item.style.cssText = `
          display:flex; align-items:center; gap:8px;
          padding:6px 8px 6px ${8 + level * 16}px;
          margin: 2px 0; border-radius: 4px; cursor: pointer;
          transition: background 0.15s;
        `;
        item.innerHTML = `
          <span style="font-size:14px;">🔗</span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(node.title || node.url)}</span>
          <span style="color:#888; font-size:11px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(node.url)}</span>
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (item.classList.toggle('selected')) {
            selectedBookmarks.set(node.id, { title: node.title || node.url, url: node.url });
          } else {
            selectedBookmarks.delete(node.id);
          }
          updateCount();
        });
        item.addEventListener('mouseenter', () => { item.style.background = '#f0f4ff'; });
        item.addEventListener('mouseleave', () => {
          item.style.background = item.classList.contains('selected') ? '#e3f2fd' : '';
        });
        wrap.appendChild(item);
      } else if (node.children) {
        // 文件夹
        const folder = document.createElement('div');
        folder.className = 'bm-folder';
        folder.style.cssText = 'margin: 2px 0;';

        const folderHeader = document.createElement('div');
        folderHeader.className = 'bm-folder-header';
        folderHeader.style.cssText = `
          display:flex; align-items:center; gap:6px;
          padding: 6px 8px 6px ${8 + level * 16}px;
          cursor:pointer; border-radius:4px; user-select:none;
        `;
        folderHeader.innerHTML = `
          <span class="bm-folder-icon" style="font-size:12px; transition: transform 0.15s;">▶</span>
          <span style="font-size:14px;">📁</span>
          <span style="flex:1; font-weight:500;">${escapeHtml(node.title || '未命名文件夹')}</span>
          <span class="bm-folder-count" style="color:#888; font-size:12px;">${node.children.length} 项</span>
        `;
        folderHeader.addEventListener('click', () => folder.classList.toggle('expanded'));
        folderHeader.addEventListener('mouseenter', () => { folderHeader.style.background = '#f0f0f0'; });
        folderHeader.addEventListener('mouseleave', () => { folderHeader.style.background = ''; });
        folder.appendChild(folderHeader);

        const children = document.createElement('div');
        children.className = 'bm-folder-children';
        children.style.cssText = 'display:none;';
        node.children.forEach(child => {
          children.appendChild(renderNode(child, level + 1));
        });
        folder.appendChild(children);

        // 监听 expanded 切换
        const observer = new MutationObserver(() => {
          const expanded = folder.classList.contains('expanded');
          children.style.display = expanded ? 'block' : 'none';
          folderHeader.querySelector('.bm-folder-icon').style.transform = expanded ? 'rotate(90deg)' : '';
        });
        observer.observe(folder, { attributes: true, attributeFilter: ['class'] });

        wrap.appendChild(folder);
      }

      return wrap;
    };

    // 加载书签树
    chrome.bookmarks.getTree((bookmarkTree) => {
      treeContainer.innerHTML = '';
      const rootChildren = [];
      bookmarkTree.forEach(root => {
        if (root.children) rootChildren.push(...root.children);
      });

      if (rootChildren.length === 0) {
        treeContainer.innerHTML = '<div style="text-align:center; color:#888; padding:20px;">暂无书签</div>';
        return;
      }

      rootChildren.forEach(child => treeContainer.appendChild(renderNode(child)));
    });

    // 导入按钮
    footer.querySelector('.bm-import-btn').addEventListener('click', async () => {
      if (selectedBookmarks.size === 0) {
        alert('请至少选择一个书签');
        return;
      }
      const groupId = toolbar.querySelector('.bm-target-group').value;
      if (!groupId) {
        alert('请选择目标分组');
        return;
      }

      const importBtn = footer.querySelector('.bm-import-btn');
      importBtn.disabled = true;
      importBtn.textContent = '导入中…';

      let successCount = 0;
      let failCount = 0;
      for (const [, bm] of selectedBookmarks) {
        try {
          await this.dataManager.sendMessage('addTab', {
            tab: {
              title: bm.title,
              url: bm.url,
              favicon: `https://www.google.com/s2/favicons?domain=${new URL(bm.url).hostname}&sz=32`,
              timestamp: new Date().toISOString()
            },
            groupId
          });
          successCount++;
        } catch (e) {
          failCount++;
        }
      }

      await this.dataManager.loadData();
      this.render();
      closeDialog();

      const groupName = this.groups.find(g => g.id === groupId)?.name || '目标分组';
      alert(`导入完成：成功 ${successCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}\n目标分组：${groupName}`);
    });
  }

  /**
   * 显示分组筛选对话框
   */
  _showGroupFilterDialog() {
    // 移除已存在的对话框
    const existingDialog = document.getElementById('group-filter-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    // 创建对话框遮罩
    const overlay = document.createElement('div');
    overlay.id = 'group-filter-dialog';
    overlay.className = 'group-filter-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    // 创建对话框内容
    const dialog = document.createElement('div');
    dialog.className = 'group-filter-dialog';
    dialog.style.cssText = `
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      min-width: 400px;
      max-width: 600px;
      max-height: 70vh;
      overflow: auto;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    `;

    // 构建分组列表 HTML
    const groupListHtml = this.groups.map(group => {
      const isVisible = this.visibleGroups.has(group.id);
      const tabCount = this.tabs[group.id]?.length || 0;
      return `
        <div class="group-filter-item" data-group-id="${group.id}" style="
          display: flex;
          align-items: center;
          padding: 10px;
          margin: 5px 0;
          background: white;
          border-radius: 4px;
          transition: background 0.2s;
        ">
          <input type="checkbox" value="${group.id}" ${isVisible ? 'checked' : ''} style="margin-right: 10px;">
          <span class="group-color-indicator" style="
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
            background: ${group.color};
          "></span>
          <span class="group-name" style="flex: 1; font-weight: 500;">${escapeHtml(group.name)}</span>
          <span class="group-tab-count" style="color: #888; font-size: 12px; margin-right: 10px;">${tabCount} 个标签</span>
          <button class="edit-group-name-btn" data-group-id="${group.id}" style="
            background: none;
            border: none;
            cursor: pointer;
            font-size: 16px;
            padding: 4px 8px;
            opacity: 0.6;
            transition: opacity 0.2s;
          " title="编辑分组名称">Edit</button>
        </div>
      `;
    }).join('');

    dialog.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 18px;">选择要显示的分组</h3>
        <button class="close-dialog-btn" style="background: none; border: none; font-size: 20px; cursor: pointer;">×</button>
      </div>
      <div style="margin-bottom: 15px;">
        <button class="select-all-groups-btn" style="margin-right: 10px; padding: 6px 12px; cursor: pointer;">全选</button>
        <button class="deselect-all-groups-btn" style="padding: 6px 12px; cursor: pointer;">全不选</button>
      </div>
      <div class="group-filter-list">
        ${groupListHtml}
      </div>
      <div style="margin-top: 15px; text-align: right; padding-top: 15px; border-top: 1px solid #ddd;">
        <button class="cancel-filter-btn" style="margin-right: 10px; padding: 8px 16px; cursor: pointer;">取消</button>
        <button class="apply-filter-btn" style="padding: 8px 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px;">应用</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 添加事件监听
    const closeDialog = () => overlay.remove();

    dialog.querySelector('.close-dialog-btn').addEventListener('click', closeDialog);
    dialog.querySelector('.cancel-filter-btn').addEventListener('click', closeDialog);

    dialog.querySelector('.select-all-groups-btn').addEventListener('click', () => {
      dialog.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });

    dialog.querySelector('.deselect-all-groups-btn').addEventListener('click', () => {
      dialog.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });

    dialog.querySelector('.apply-filter-btn').addEventListener('click', () => {
      const selectedGroups = Array.from(dialog.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value);

      if (selectedGroups.length === 0) {
        alert('请至少选择一个分组');
        return;
      }

      this.visibleGroups = new Set(selectedGroups);
      this._saveVisibleGroups();
      this.render();
      closeDialog();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog();
      }
    });

    // 添加 hover 效果
    dialog.querySelectorAll('.group-filter-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.background = '#f0f0f0';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'white';
      });
    });

    // 添加编辑按钮事件
    dialog.querySelectorAll('.edit-group-name-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        btn.style.opacity = '1';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.opacity = '0.6';
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._startEditingGroupName(btn);
      });
    });
  }

  /**
   * 开始编辑分组名称
   */
  _startEditingGroupName(editBtn) {
    const groupItem = editBtn.closest('.group-filter-item');
    const groupId = editBtn.dataset.groupId;
    const nameSpan = groupItem.querySelector('.group-name');
    const currentName = nameSpan.textContent;

    // 创建编辑界面
    const editContainer = document.createElement('div');
    editContainer.className = 'group-name-edit-container';
    editContainer.style.cssText = 'display: flex; align-items: center; gap: 5px; flex: 1;';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'group-name-input';
    input.style.cssText = `
      flex: 1;
      padding: 4px 8px;
      border: 1px solid #007bff;
      border-radius: 4px;
      font-size: 14px;
      outline: none;
    `;

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'OK';
    saveBtn.className = 'save-group-name-btn';
    saveBtn.style.cssText = `
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      width: 28px;
      height: 28px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    saveBtn.title = '保存';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'cancel-group-name-btn';
    cancelBtn.style.cssText = `
      background: #6c757d;
      color: white;
      border: none;
      border-radius: 4px;
      width: 28px;
      height: 28px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    cancelBtn.title = '取消';

    editContainer.appendChild(input);
    editContainer.appendChild(saveBtn);
    editContainer.appendChild(cancelBtn);

    // 隐藏原始名称和编辑按钮
    nameSpan.style.display = 'none';
    editBtn.style.display = 'none';

    // 插入编辑界面
    nameSpan.parentNode.insertBefore(editContainer, editBtn);

    // 聚焦输入框
    input.focus();
    input.select();

    // 保存处理
    const saveEdit = async () => {
      const newName = input.value.trim();
      if (!newName) {
        alert('分组名称不能为空');
        return;
      }
      if (newName === currentName) {
        cancelEdit();
        return;
      }

      const result = await this.dataManager.sendMessage('updateGroupName', {
        groupId,
        newName
      });

      if (result.success) {
        await this.dataManager.loadData();
        nameSpan.textContent = newName;
        cancelEdit();
      } else {
        alert('更新失败，请重试');
      }
    };

    // 取消处理
    const cancelEdit = () => {
      editContainer.remove();
      nameSpan.style.display = '';
      editBtn.style.display = '';
    };

    // 事件绑定
    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEdit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveEdit();
      } else if (e.key === 'Escape') {
        cancelEdit();
      }
    });
  }

  // 默认颜色选项
  static DEFAULT_COLORS = [
    '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7',
    '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'
  ];

  /**
   * 显示添加分组对话框
   */
  _showAddGroupDialog() {
    // 移除已存在的对话框
    const existingDialog = document.getElementById('add-group-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    // 创建对话框遮罩
    const overlay = document.createElement('div');
    overlay.id = 'add-group-dialog';
    overlay.className = 'add-group-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    // 创建对话框内容
    const dialog = document.createElement('div');
    dialog.className = 'add-group-dialog';
    dialog.style.cssText = `
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      min-width: 400px;
      max-width: 500px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    `;

    // 构建颜色选择器HTML
    const colorPickerHtml = GroupView.DEFAULT_COLORS.map(color => `
      <div class="color-option" style="
        width: 30px;
        height: 30px;
        border-radius: 50%;
        margin-right: 10px;
        background: ${color};
        cursor: pointer;
        border: 2px solid transparent;
        transition: border-color 0.2s;
      " data-color="${color}"></div>
    `).join('');

    dialog.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 18px;">添加新分组</h3>
        <button class="close-dialog-btn" style="background: none; border: none; font-size: 20px; cursor: pointer;">×</button>
      </div>
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-weight: 500;">分组名称</label>
        <input type="text" id="new-group-name" style="
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
        " placeholder="请输入分组名称">
      </div>
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-weight: 500;">分组颜色</label>
        <div id="color-picker" style="display: flex; flex-wrap: wrap;">
          ${colorPickerHtml}
        </div>
      </div>
      <div style="text-align: right; padding-top: 15px; border-top: 1px solid #ddd;">
        <button class="cancel-add-btn" style="
          margin-right: 10px;
          padding: 8px 16px;
          cursor: pointer;
          background: #6c757d;
          color: white;
          border: none;
          border-radius: 4px;
        ">取消</button>
        <button class="confirm-add-btn" style="
          padding: 8px 16px;
          cursor: pointer;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
        ">确定</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 选择默认颜色
    let selectedColor = GroupView.DEFAULT_COLORS[0];
    const colorOptions = dialog.querySelectorAll('.color-option');
    colorOptions.forEach(option => {
      if (option.dataset.color === selectedColor) {
        option.style.borderColor = '#000';
      }
      option.addEventListener('click', () => {
        selectedColor = option.dataset.color;
        colorOptions.forEach(opt => opt.style.borderColor = 'transparent');
        option.style.borderColor = '#000';
      });
    });

    // 事件绑定
    const closeDialog = () => overlay.remove();

    dialog.querySelector('.close-dialog-btn').addEventListener('click', closeDialog);
    dialog.querySelector('.cancel-add-btn').addEventListener('click', closeDialog);

    dialog.querySelector('.confirm-add-btn').addEventListener('click', async () => {
      const groupName = document.getElementById('new-group-name').value.trim();
      if (!groupName) {
        alert('请输入分组名称');
        return;
      }

      await this.dataManager.sendMessage('addGroup', {
        name: groupName,
        color: selectedColor
      });

      await this.dataManager.loadData();
      this.render();
      closeDialog();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog();
      }
    });

    // ESC键关闭对话框
    document.addEventListener('keydown', function handleEsc(e) {
      if (e.key === 'Escape') {
        closeDialog();
        document.removeEventListener('keydown', handleEsc);
      }
    });

    // 聚焦输入框
    document.getElementById('new-group-name').focus();
  }

  /**
   * 显示编辑 tab 对话框(右键触发)
   * 允许修改 title / url,标题过长时用于缩短以适配 goto 圆环显示
   */
  _showEditTabDialog(tab, groupId) {
    const existing = document.getElementById('edit-tab-dialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'edit-tab-dialog';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 10001;
      display: flex; align-items: center; justify-content: center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #f8f9fa; border-radius: 8px; padding: 20px;
      min-width: 460px; max-width: 600px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    `;

    dialog.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 18px;">编辑标签(用于 goto 圆环显示)</h3>
        <button class="et-close-btn" style="background: none; border: none; font-size: 20px; cursor: pointer;">×</button>
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 5px; font-weight: 500;">标题</label>
        <input type="text" class="et-title" style="
          width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;
          font-size: 14px; box-sizing: border-box;
        " value="${escapeHtml(tab.title)}" maxlength="60">
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 5px; font-weight: 500;">链接 URL</label>
        <input type="text" class="et-url" style="
          width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;
          font-size: 14px; box-sizing: border-box;
        " value="${escapeHtml(tab.url)}">
      </div>
      <div style="text-align: right; padding-top: 12px; border-top: 1px solid #ddd;">
        <button class="et-cancel-btn" style="
          margin-right: 10px; padding: 8px 16px; cursor: pointer;
          background: #6c757d; color: white; border: none; border-radius: 4px;
        ">取消</button>
        <button class="et-save-btn" style="
          padding: 8px 16px; cursor: pointer; background: #007bff; color: white;
          border: none; border-radius: 4px;
        ">保存</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const titleInput = dialog.querySelector('.et-title');
    const urlInput = dialog.querySelector('.et-url');
    const closeDialog = () => overlay.remove();

    // 关闭
    dialog.querySelector('.et-close-btn').addEventListener('click', closeDialog);
    dialog.querySelector('.et-cancel-btn').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { closeDialog(); document.removeEventListener('keydown', onEsc); }
    });

    // 自动选中 title
    setTimeout(() => { titleInput.focus(); titleInput.select(); }, 0);

    // 保存
    const saveHandler = async () => {
      const newTitle = titleInput.value.trim();
      const newUrl = urlInput.value.trim();
      if (!newTitle) { alert('标题不能为空'); return; }
      if (!newUrl) { alert('URL 不能为空'); return; }
      try { new URL(newUrl); } catch (e) { alert('URL 格式无效'); return; }

      const saveBtn = dialog.querySelector('.et-save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      try {
        const result = await this.dataManager.sendMessage('updateTab', {
          tabId: tab.id, groupId, updates: { title: newTitle, url: newUrl }
        });
        if (result && result.success) {
          await this.dataManager.loadData();
          this.render();
          closeDialog();
        } else {
          alert(`保存失败: ${result?.error || '未知错误'}`);
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
        }
      } catch (err) {
        alert(`保存失败: ${err.message || err}`);
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
      }
    };

    dialog.querySelector('.et-save-btn').addEventListener('click', saveHandler);
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveHandler();
    });
  }

  /**
   * 刷新并按点击次数排序（持久化到存储）
   */
  async _refreshAndSort() {
    // 调用 background 对数据进行排序并保存
    await this.dataManager.sendMessage('sortTabsByVisitCount');

    // 重新加载数据并渲染
    await this.dataManager.loadData();
    this.render();
  }

  /**
   * 保存可见分组设置
   */
  async _saveVisibleGroups() {
    const visibleGroupsArray = Array.from(this.visibleGroups);
    await this.dataManager.sendMessage('updateSettings', {
      settings: {
        visibleGroups: visibleGroupsArray
      }
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
