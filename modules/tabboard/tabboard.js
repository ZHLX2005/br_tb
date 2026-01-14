/**
 * TabBoard - 标签页看板
 * 使用 jKanban 库实现拖拽分组、标签管理
 */

let kanban = null;
let groups = [];
let tabs = [];
let currentView = 'timeline'; // 'timeline' or 'group'

// 初始化
async function init() {
  await loadData();
  renderCurrentView();
  setupEventListeners();
}

// 加载数据
async function loadData() {
  const [groupsResponse, tabsResponse] = await Promise.all([
    chrome.runtime.sendMessage({ action: 'getGroups' }),
    chrome.storage.local.get(['tabs'])
  ]);

  if (groupsResponse.success) {
    groups = groupsResponse.groups;
  }

  if (tabsResponse.tabs) {
    tabs = tabsResponse.tabs;
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

// 切换到时序视图
function switchToTimelineView() {
  currentView = 'timeline';
  document.getElementById('timelineViewBtn').classList.add('active');
  document.getElementById('groupViewBtn').classList.remove('active');
  document.getElementById('timelineView').style.display = 'block';
  document.getElementById('groupView').style.display = 'none';
  renderTimelineView();
}

// 切换到分组视图
function switchToGroupView() {
  currentView = 'group';
  document.getElementById('timelineViewBtn').classList.remove('active');
  document.getElementById('groupViewBtn').classList.add('active');
  document.getElementById('timelineView').style.display = 'none';
  document.getElementById('groupView').style.display = 'block';
  renderBoard();
}

// 渲染时序视图
function renderTimelineView() {
  const emptyState = document.getElementById('emptyState');
  const stats = document.getElementById('stats');
  const timelineList = document.getElementById('timelineList');

  // 计算总标签数
  const totalTabs = Object.values(tabs).flat().length;
  stats.textContent = `${totalTabs} 个标签页 · ${groups.length} 个分组`;

  // 收集所有标签页并按时间排序
  const allTabs = [];
  for (const groupId in tabs) {
    const group = groups.find(g => g.id === groupId);
    if (group) {
      tabs[groupId].forEach(tab => {
        allTabs.push({
          ...tab,
          groupId,
          groupName: group.name,
          groupColor: group.color
        });
      });
    }
  }

  // 按时间戳降序排序
  allTabs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (allTabs.length === 0) {
    timelineList.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  // 按日期分组
  const groupedByDate = groupTabsByDate(allTabs);

  // 渲染时序列表
  timelineList.innerHTML = Object.entries(groupedByDate).map(([dateLabel, dateTabs]) => `
    <div class="timeline-date-group">
      <div class="timeline-date-header">${dateLabel}</div>
      <div class="timeline-items">
        ${dateTabs.map(tab => `
          <div class="timeline-item" data-tab-id="${tab.id}" data-group-id="${tab.groupId}">
            <div class="timeline-item-favicon">
              <img src="${escapeHtml(tab.favicon || '')}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23999%22><rect width=%2224%22 height=%2224%22 rx=%224%22/></svg>'">
            </div>
            <div class="timeline-item-content">
              <div class="timeline-item-title">${escapeHtml(tab.title)}</div>
              <div class="timeline-item-url">${escapeHtml(tab.url)}</div>
              <div class="timeline-item-meta">
                <span class="timeline-item-group" style="background: ${tab.groupColor}">${escapeHtml(tab.groupName)}</span>
                <span class="timeline-item-time">${formatTime(tab.timestamp)}</span>
              </div>
            </div>
            <button class="timeline-item-delete" data-id="${tab.id}" data-group-id="${tab.groupId}" title="删除">×</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  // 绑定时序视图事件
  setupTimelineEventListeners();
}

// 按日期分组标签页
function groupTabsByDate(allTabs) {
  const grouped = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  allTabs.forEach(tab => {
    const tabDate = new Date(tab.timestamp);
    const tabDay = new Date(tabDate.getFullYear(), tabDate.getMonth(), tabDate.getDate());

    let dateLabel;
    if (tabDay.getTime() === today.getTime()) {
      dateLabel = '今天';
    } else if (tabDay.getTime() === yesterday.getTime()) {
      dateLabel = '昨天';
    } else if (now - tabDate < 7 * 24 * 60 * 60 * 1000) {
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      dateLabel = days[tabDate.getDay()];
    } else {
      dateLabel = tabDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    }

    if (!grouped[dateLabel]) {
      grouped[dateLabel] = [];
    }
    grouped[dateLabel].push(tab);
  });

  return grouped;
}

// 设置时序视图事件监听器
function setupTimelineEventListeners() {
  // 点击打开标签页
  document.querySelectorAll('.timeline-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('timeline-item-delete')) return;
      const tabId = item.dataset.tabId;
      const tab = findTab(tabId);
      if (tab) {
        chrome.runtime.sendMessage({ action: 'openTab', url: tab.url });
      }
    });
  });

  // 删除按钮
  document.querySelectorAll('.timeline-item-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = btn.dataset.id;
      const groupId = btn.dataset.groupId;

      await chrome.runtime.sendMessage({
        action: 'deleteTab',
        tabId,
        groupId
      });

      await loadData();
      renderTimelineView();
    });
  });
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
              <img class="kanban-item-favicon" src="${escapeHtml(tab.favicon || '')}" onerror="this.style.display='none'">
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

  // 计算总标签数
  const totalTabs = Object.values(tabs).flat().length;
  stats.textContent = `${totalTabs} 个标签页 · ${groups.length} 个分组`;

  if (groups.length === 0 || totalTabs === 0) {
    document.getElementById('tabboard').innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  const boards = convertToJKanbanFormat();

  if (kanban) {
    kanban.removeAll();
    kanban.addBoards(boards);
  } else {
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
  }
}

// 处理项目点击
function handleItemClick(el) {
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
  container.removeEventListener('click', handleDeleteButtonClick, true);
  container.addEventListener('click', handleDeleteButtonClick, true);
}

// 处理删除按钮点击
async function handleDeleteButtonClick(e) {
  if (e.target.classList.contains('kanban-item-delete')) {
    e.stopPropagation();
    e.preventDefault();

    const btn = e.target;
    const tabId = btn.dataset.id;
    const itemEl = btn.closest('.kanban-item');
    const boardEl = itemEl.closest('.kanban-board');
    const groupId = boardEl.getAttribute('data-id');

    await chrome.runtime.sendMessage({
      action: 'deleteTab',
      tabId,
      groupId
    });

    await loadData();
    renderCurrentView();
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

// 设置事件监听器
function setupEventListeners() {
  // 视图切换按钮
  document.getElementById('timelineViewBtn').addEventListener('click', switchToTimelineView);
  document.getElementById('groupViewBtn').addEventListener('click', switchToGroupView);

  // 刷新按钮
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    await loadData();
    renderCurrentView();
  });

  // 设置按钮
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 为看板标题添加操作按钮
  setupBoardActions();
}

// 设置看板操作按钮
function setupBoardActions() {
  const observer = new MutationObserver(() => {
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
  });

  observer.observe(document.getElementById('tabboard'), {
    childList: true,
    subtree: true
  });

  // 设置删除按钮的事件委托（只需设置一次）
  setupDeleteButtons();
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

// 监听存储变化
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local') {
    await loadData();
    renderCurrentView();
  }
});

// 初始化
document.addEventListener('DOMContentLoaded', init);
