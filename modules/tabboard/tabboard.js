/**
 * TabBoard - 标签页看板
 * 使用 jKanban 库实现拖拽分组、标签管理
 */

let kanban = null;
let groups = [];
let tabs = [];
let timelineSnapshots = [];
let currentView = 'timeline'; // 'timeline' or 'group'
let boardActionsObserver = null; // 管理 MutationObserver
let settings = {}; // 保存设置

// 初始化
async function init() {
  await loadData();
  // 使用保存的视图状态，如果没有则默认为 timeline
  currentView = settings.lastView || 'timeline';
  updateViewUI();
  renderCurrentView();
  setupEventListeners();
}

// 加载数据
async function loadData() {
  const [groupsResponse, tabsResponse, timelineResponse, settingsResponse] = await Promise.all([
    chrome.runtime.sendMessage({ action: 'getGroups' }),
    chrome.storage.local.get(['tabs']),
    chrome.runtime.sendMessage({ action: 'getTimelineTabs' }),
    chrome.runtime.sendMessage({ action: 'getSettings' })
  ]);

  if (groupsResponse.success) {
    groups = groupsResponse.groups;
  }

  if (tabsResponse.tabs) {
    tabs = tabsResponse.tabs;
  }

  if (timelineResponse.success) {
    timelineSnapshots = timelineResponse.snapshots;
  }

  if (settingsResponse.success) {
    settings = settingsResponse.settings || {};
  }
}

// 渲染当前视图
function renderCurrentView() {
  if (currentView === 'timeline') {
    renderTimelineView();
  } else {
    renderBoard();
  }
}

// 更新视图UI显示（按钮状态和可见性）
function updateViewUI() {
  if (currentView === 'timeline') {
    document.getElementById('timelineViewBtn').classList.add('active');
    document.getElementById('groupViewBtn').classList.remove('active');
    document.getElementById('timelineView').style.display = 'block';
    document.getElementById('groupView').style.display = 'none';
  } else {
    document.getElementById('timelineViewBtn').classList.remove('active');
    document.getElementById('groupViewBtn').classList.add('active');
    document.getElementById('timelineView').style.display = 'none';
    document.getElementById('groupView').style.display = 'block';
  }
}

// 保存视图状态到存储
async function saveViewState(view) {
  await chrome.runtime.sendMessage({
    action: 'updateSettings',
    settings: { lastView: view }
  });
  settings.lastView = view;
}

// 切换到时序视图
function switchToTimelineView() {
  currentView = 'timeline';
  updateViewUI();
  renderTimelineView();
  saveViewState('timeline');
}

// 切换到分组视图
function switchToGroupView() {
  currentView = 'group';
  updateViewUI();
  renderBoard();
  saveViewState('group');
}

// 渲染时序视图 - 按快照分组显示
function renderTimelineView() {
  const emptyState = document.getElementById('emptyState');
  const stats = document.getElementById('stats');
  const timelineList = document.getElementById('timelineList');

  // 计算总快照数和标签数
  const totalSnapshots = timelineSnapshots.length;
  const totalTabs = timelineSnapshots.reduce((sum, s) => sum + s.tabs.length, 0);
  stats.textContent = `${totalSnapshots} 个快照 · ${totalTabs} 个标签页`;

  if (timelineSnapshots.length === 0) {
    timelineList.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  // 渲染快照列表
  timelineList.innerHTML = `
    <div class="timeline-actions-header">
      <button class="timeline-action-btn restore-all-btn" title="恢复所有快照">打开全部</button>
      <button class="timeline-action-btn clear-all-btn" title="清空所有快照">清空</button>
      <button class="timeline-action-btn export-timeline-btn" title="导出快照数据">导出</button>
      <button class="timeline-action-btn import-timeline-btn" title="导入快照数据">导入</button>
    </div>
    <div class="timeline-snapshots-list">
      ${timelineSnapshots.map(snapshot => renderSnapshot(snapshot)).join('')}
    </div>
  `;

  // 绑定时序视图事件
  setupTimelineEventListeners();
}

// 渲染单个快照
function renderSnapshot(snapshot) {
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
          <button class="snapshot-action-btn restore-snapshot" data-id="${snapshot.id}" title="恢复此快照">📂 恢复</button>
          <button class="snapshot-action-btn delete-snapshot" data-id="${snapshot.id}" title="删除快照">🗑️</button>
        </div>
      </div>
      <div class="snapshot-tabs">
        ${displayTabs.map(tab => `
          <div class="snapshot-tab-row" data-url="${escapeHtml(tab.url)}">
            <img class="snapshot-tab-favicon" src="${escapeHtml(tab.favicon || '')}" loading="lazy">
            <span class="snapshot-tab-title">${escapeHtml(tab.title)}</span>
          </div>
        `).join('')}
        ${hasMore ? `
          <button class="snapshot-more-btn" data-snapshot-id="${snapshot.id}">
            还有 ${moreCount} 个标签... ▼
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

// 设置时序视图事件监听器
function setupTimelineEventListeners() {
  // 点击快照中的标签行打开标签页
  document.querySelectorAll('.snapshot-tab-row').forEach(row => {
    row.addEventListener('click', () => {
      const url = row.dataset.url;
      if (url) {
        chrome.runtime.sendMessage({ action: 'openTab', url });
      }
    });
  });

  // "更多"按钮 - 展开显示所有标签
  document.querySelectorAll('.snapshot-more-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const snapshotId = btn.dataset.snapshotId;
      const snapshot = timelineSnapshots.find(s => s.id === snapshotId);
      if (snapshot) {
        const tabsContainer = btn.parentElement;
        // 移除"更多"按钮
        btn.remove();
        // 添加所有标签
        const remainingTabs = snapshot.tabs.slice(3);
        remainingTabs.forEach(tab => {
          const tabRow = document.createElement('div');
          tabRow.className = 'snapshot-tab-row';
          tabRow.dataset.url = tab.url;
          tabRow.innerHTML = `
            <img class="snapshot-tab-favicon" src="${escapeHtml(tab.favicon || '')}" loading="lazy">
            <span class="snapshot-tab-title">${escapeHtml(tab.title)}</span>
          `;
          tabRow.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'openTab', url: tab.url });
          });
          tabsContainer.appendChild(tabRow);
        });
      }
    });
  });

  // 恢复单个快照
  document.querySelectorAll('.restore-snapshot').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const snapshotId = btn.dataset.id;
      const result = await chrome.runtime.sendMessage({
        action: 'restoreSnapshot',
        snapshotId
      });
      if (result.success) {
        // 恢复成功后刷新视图，确保数据同步
        await loadData();
        renderTimelineView();
      }
    });
  });

  // 删除单个快照
  document.querySelectorAll('.delete-snapshot').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const snapshotId = btn.dataset.id;
      if (confirm('确定要删除这个快照吗？')) {
        await chrome.runtime.sendMessage({
          action: 'deleteTimelineSnapshot',
          snapshotId
        });
        await loadData();
        renderTimelineView();
      }
    });
  });

  // 恢复所有快照按钮
  const restoreAllBtn = document.querySelector('.restore-all-btn');
  if (restoreAllBtn) {
    restoreAllBtn.addEventListener('click', async () => {
      if (confirm(`确定要恢复所有 ${timelineSnapshots.length} 个快照吗？这将打开 ${timelineSnapshots.reduce((sum, s) => sum + s.tabs.length, 0)} 个标签页。`)) {
        for (const snapshot of timelineSnapshots) {
          for (const tab of snapshot.tabs) {
            await chrome.runtime.sendMessage({ action: 'openTab', url: tab.url });
          }
        }
      }
    });
  }

  // 清空所有快照按钮
  const clearAllBtn = document.querySelector('.clear-all-btn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (confirm(`确定要清空所有 ${timelineSnapshots.length} 个快照吗？`)) {
        for (const snapshot of timelineSnapshots) {
          await chrome.runtime.sendMessage({
            action: 'deleteTimelineSnapshot',
            snapshotId: snapshot.id
          });
        }
        await loadData();
        renderTimelineView();
      }
    });
  }

  // 导出快照数据按钮
  const exportBtn = document.querySelector('.export-timeline-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportTimelineData();
    });
  }

  // 导入快照数据按钮
  const importBtn = document.querySelector('.import-timeline-btn');
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      importTimelineData();
    });
  }
}

// 导出时序快照数据
function exportTimelineData() {
  const data = {
    version: '1.0',
    exportTime: new Date().toISOString(),
    snapshots: timelineSnapshots
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tabboard-timeline-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 导入时序快照数据
function importTimelineData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.snapshots || !Array.isArray(data.snapshots)) {
        alert('无效的数据格式');
        return;
      }

      const importCount = data.snapshots.length;
      if (!confirm(`确定要导入 ${importCount} 个快照吗？这将添加到现有快照中。`)) {
        return;
      }

      // 合并快照数据
      const importResult = await chrome.runtime.sendMessage({
        action: 'importTimelineSnapshots',
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

      await loadData();
      renderTimelineView();
    } catch (error) {
      alert('导入失败：' + error.message);
    }
  };

  input.click();
}

// 导出分组和标签数据
function exportGroupsData() {
  const data = {
    version: '1.0',
    exportTime: new Date().toISOString(),
    groups: groups,
    tabs: tabs
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tabboard-groups-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 导入分组和标签数据
function importGroupsData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.groups || !Array.isArray(data.groups) || !data.tabs) {
        alert('无效的数据格式');
        return;
      }

      const groupCount = data.groups.length;
      const tabCount = Object.values(data.tabs).flat().length;
      if (!confirm(`确定要导入 ${groupCount} 个分组和 ${tabCount} 个标签吗？这将替换现有数据。`)) {
        return;
      }

      // 导入数据
      await chrome.runtime.sendMessage({
        action: 'importGroupsAndTabs',
        groups: data.groups,
        tabs: data.tabs
      });

      await loadData();
      renderCurrentView();
    } catch (error) {
      alert('导入失败：' + error.message);
    }
  };

  input.click();
}

// 转换数据为 jKanban 格式
function convertToJKanbanFormat() {
  return groups.map(group => {
    const groupTabs = tabs[group.id] || [];
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

// 根据颜色获取 CSS 类名
function getColorClass(color) {
  const colorMap = {
    '#ff6b6b': 'red',
    '#4ecdc4': 'teal',
    '#45b7d1': 'blue',
    '#f9ca24': 'yellow',
    '#6c5ce7': 'purple',
    '#a29bfe': 'purple-light',
    '#fd79a8': 'pink',
    '#00b894': 'green',
    '#e17055': 'orange',
    '#74b9ff': 'sky'
  };
  return colorMap[color] || 'blue';
}

// 渲染看板
function renderBoard() {
  const emptyState = document.getElementById('emptyState');
  const stats = document.getElementById('stats');
  const tabboard = document.getElementById('tabboard');

  // 计算总标签数
  const totalTabs = Object.values(tabs).flat().length;
  stats.textContent = `${totalTabs} 个标签页 · ${groups.length} 个分组`;

  // 只有没有任何分组时才显示空状态
  if (groups.length === 0) {
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

  const boards = convertToJKanbanFormat();

  // 销毁旧的 kanban 实例
  if (kanban) {
    const container = document.getElementById('tabboard');
    const boardsToRemove = container.querySelectorAll('.kanban-board');
    boardsToRemove.forEach(board => board.remove());
    kanban = null;
  }

  // 创建新的 kanban 实例
  kanban = new jKanban({
    element: '#tabboard',
    gutter: '12px',
    widthBoard: '280px',
    responsivePercentage: false,
    dragItems: true,
    dragBoards: true,
    boards: boards,
    click: handleItemClick,
    dropEl: handleDropEl,
    dragendEl: handleDragEndEl,
    buttonClick: handleBoardButtonClick,
    itemAddOptions: {
      enabled: false
    }
  });

  // 每次渲染后重新设置看板操作按钮和删除按钮
  setupBoardActions();
}

// 处理项目点击
function handleItemClick(el) {
  // 删除按钮的点击由事件委托处理，这里不需要检查
  // 因为 stopImmediatePropagation 会阻止事件到达这里

  const itemEl = el.querySelector('.kanban-item-content');
  if (!itemEl) return;

  // 找到原始数据中的 URL
  const itemId = el.getAttribute('data-eid');
  const tab = findTab(itemId);
  if (tab) {
    chrome.runtime.sendMessage({
      action: 'openTab',
      url: tab.url
    });
  }
}

// 处理拖拽结束 - 保存更改到存储
async function handleDropEl(el, target, source, sibling) {
  const itemId = el.getAttribute('data-eid');
  const targetBoardId = target.parentElement.getAttribute('data-id');
  const sourceBoardId = source.parentElement.getAttribute('data-id');

  if (targetBoardId === sourceBoardId) {
    return;
  }

  // 更新存储
  await moveTabToGroup(itemId, sourceBoardId, targetBoardId);

  // 重新加载数据
  await loadData();
}

// 处理拖拽结束
function handleDragEndEl(el) {
  // 可以在这里添加额外的处理逻辑
}

// 处理看板按钮点击
function handleBoardButtonClick(el, boardId) {
  // 可以在这里添加处理逻辑
}

// 移动标签到分组
async function moveTabToGroup(tabId, fromGroup, toGroup) {
  const tab = findTabInGroup(tabId, fromGroup);
  if (!tab) return;

  // 从原分组移除
  tabs[fromGroup] = tabs[fromGroup].filter(t => t.id !== tabId);

  // 添加到新分组
  if (!tabs[toGroup]) {
    tabs[toGroup] = [];
  }
  tabs[toGroup].push(tab);

  // 保存到存储
  await chrome.storage.local.set({ tabs });
}

// 查找标签页
function findTab(tabId) {
  for (const groupId in tabs) {
    const tab = tabs[groupId].find(t => t.id === tabId);
    if (tab) return tab;
  }
  return null;
}

// 在指定分组中查找标签页
function findTabInGroup(tabId, groupId) {
  return tabs[groupId]?.find(t => t.id === tabId);
}

// 设置删除按钮事件 - 使用事件委托
function setupDeleteButtons() {
  const container = document.getElementById('tabboard');
  // 移除旧的监听器（如果存在）
  container.removeEventListener('click', handleDeleteButtonClick, true);
  container.removeEventListener('click', handleDeleteButtonClick, false);
  // 在捕获阶段添加监听器，确保在 jKanban 之前执行
  container.addEventListener('click', handleDeleteButtonClick, true);
}

// 处理删除按钮点击
async function handleDeleteButtonClick(e) {
  // 检查是否点击了删除按钮或其子元素
  const deleteBtn = e.target.closest('.kanban-item-delete');
  if (deleteBtn) {
    e.stopPropagation();
    e.preventDefault();
    e.stopImmediatePropagation();

    const btn = deleteBtn;
    const tabId = btn.dataset.id;
    const itemEl = btn.closest('.kanban-item');
    const boardEl = itemEl?.closest('.kanban-board');
    const groupId = boardEl?.getAttribute('data-id');

    if (tabId && groupId) {
      await chrome.runtime.sendMessage({
        action: 'deleteTab',
        tabId,
        groupId
      });

      await loadData();
      renderCurrentView();
    }
    return false;
  }
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;

  return date.toLocaleDateString('zh-CN');
}

// 格式化快照时间
function formatSnapshotTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;

  // 超过7天显示完整日期时间
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute}`;
}

// 设置事件监听器
function setupEventListeners() {
  // 辅助函数：安全添加事件监听器
  const addListener = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(event, handler);
    }
  };

  // 视图切换按钮
  addListener('timelineViewBtn', 'click', switchToTimelineView);
  addListener('groupViewBtn', 'click', switchToGroupView);

  // 刷新按钮
  addListener('refreshBtn', 'click', async () => {
    await loadData();
    renderCurrentView();
  });

  // 图片加载错误处理 - 使用事件委托
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') {
      e.target.style.display = 'none';
    }
  }, true);

  // 为看板标题添加操作按钮
  setupBoardActions();
}

// 设置看板操作按钮
function setupBoardActions() {
  // 断开旧的 observer
  if (boardActionsObserver) {
    boardActionsObserver.disconnect();
  }

  // 立即添加一次按钮
  addBoardActionButtons();

  // 创建新的 observer 监听 DOM 变化
  boardActionsObserver = new MutationObserver((mutations) => {
    // 检查是否有新的 kanban-board 元素添加
    const hasNewBoards = mutations.some(mutation =>
      Array.from(mutation.addedNodes).some(node =>
        node.nodeType === 1 && (
          node.classList?.contains('kanban-board') ||
          node.querySelector?.('.kanban-board')
        )
      )
    );

    if (hasNewBoards) {
      addBoardActionButtons();
    }
  });

  boardActionsObserver.observe(document.getElementById('tabboard'), {
    childList: true,
    subtree: true
  });

  // 设置删除按钮的事件委托
  setupDeleteButtons();

  // 绑定分组视图操作按钮
  setupGroupActionButtons();
}

// 设置分组视图操作按钮
function setupGroupActionButtons() {
  const openAllBtn = document.querySelector('.open-all-groups-btn');
  const clearAllBtn = document.querySelector('.clear-all-groups-btn');
  const exportBtn = document.querySelector('.export-groups-btn');
  const importBtn = document.querySelector('.import-groups-btn');

  if (openAllBtn) {
    openAllBtn.addEventListener('click', async () => {
      if (confirm(`确定要打开所有 ${groups.length} 个分组吗？`)) {
        for (const group of groups) {
          await chrome.runtime.sendMessage({ action: 'openGroup', groupId: group.id });
        }
      }
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (confirm(`确定要清空所有分组吗？`)) {
        await chrome.runtime.sendMessage({ action: 'clearAllGroups' });
        await loadData();
        renderCurrentView();
      }
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportGroupsData();
    });
  }

  if (importBtn) {
    importBtn.addEventListener('click', () => {
      importGroupsData();
    });
  }
}

// 添加看板操作按钮
function addBoardActionButtons() {
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
  });

  // 绑定按钮事件
  document.querySelectorAll('.open-all').forEach(btn => {
    btn.removeEventListener('click', handleOpenAll);
    btn.addEventListener('click', handleOpenAll);
  });

  document.querySelectorAll('.clear-group').forEach(btn => {
    btn.removeEventListener('click', handleClearGroup);
    btn.addEventListener('click', handleClearGroup);
  });
}

// 处理打开所有按钮
async function handleOpenAll(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const groupId = btn.dataset.boardId;
  await chrome.runtime.sendMessage({ action: 'openGroup', groupId });
  await loadData();
  renderBoard();
}

// 处理清空分组按钮
async function handleClearGroup(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const groupId = btn.dataset.boardId;
  const groupTabs = tabs[groupId] || [];

  if (groupTabs.length === 0) return;

  const groupName = groups.find(g => g.id === groupId)?.name;
  if (!confirm(`确定要清空 "${groupName}" 分组吗？`)) {
    return;
  }

  for (const tab of groupTabs) {
    await chrome.runtime.sendMessage({
      action: 'deleteTab',
      tabId: tab.id,
      groupId
    });
  }

  await loadData();
  renderCurrentView();
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 监听存储变化（带防抖，避免与手动刷新冲突）
let storageChangeTimer = null;
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;

  // 清除之前的定时器
  if (storageChangeTimer) {
    clearTimeout(storageChangeTimer);
  }

  // 防抖延迟 100ms，避免短时间内多次变化导致重复渲染
  storageChangeTimer = setTimeout(async () => {
    await loadData();
    renderCurrentView();
  }, 100);
});

// 初始化
document.addEventListener('DOMContentLoaded', init);
