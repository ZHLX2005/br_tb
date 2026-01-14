/**
 * TabBoard - 标签页看板
 * 使用 jKanban 库实现拖拽分组、标签管理
 */

let kanban = null;
let groups = [];
let tabs = [];
let timelineTabs = [];
let currentView = 'timeline'; // 'timeline' or 'group'

// 初始化
async function init() {
  await loadData();
  renderCurrentView();
  setupEventListeners();
}

// 加载数据
async function loadData() {
  const [groupsResponse, tabsResponse, timelineResponse] = await Promise.all([
    chrome.runtime.sendMessage({ action: 'getGroups' }),
    chrome.storage.local.get(['tabs']),
    chrome.runtime.sendMessage({ action: 'getTimelineTabs' })
  ]);

  if (groupsResponse.success) {
    groups = groupsResponse.groups;
  }

  if (tabsResponse.tabs) {
    tabs = tabsResponse.tabs;
  }

  if (timelineResponse.success) {
    timelineTabs = timelineResponse.tabs;
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

// 渲染时序视图 - OneTab 风格，按域名分组
function renderTimelineView() {
  const emptyState = document.getElementById('emptyState');
  const stats = document.getElementById('stats');
  const timelineList = document.getElementById('timelineList');

  // 计算总标签数
  const totalTabs = timelineTabs.length;
  stats.textContent = `${totalTabs} 个标签页 · 时序视图`;

  if (timelineTabs.length === 0) {
    timelineList.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  // 按域名分组
  const groupedByDomain = groupTabsByDomain(timelineTabs);

  // 渲染时序列表 - OneTab 风格
  timelineList.innerHTML = Object.entries(groupedByDomain).map(([domain, domainTabs]) => `
    <div class="timeline-domain-group" data-domain="${escapeHtml(domain)}">
      <div class="timeline-domain-header">
        <span class="timeline-domain-title">${escapeHtml(domain)}</span>
        <span class="timeline-domain-count">${domainTabs.length} 标签</span>
      </div>
      <div class="timeline-domain-actions">
        <button class="timeline-action-btn" data-action="restore-all" title="恢复所有">恢复所有</button>
        <button class="timeline-action-btn" data-action="delete-all" title="删除所有">删除所有</button>
      </div>
      <div class="timeline-tabs-list">
        ${domainTabs.map(tab => `
          <div class="timeline-tab-row" data-tab-id="${tab.id}">
            <img class="timeline-tab-favicon" src="${escapeHtml(tab.favicon || '')}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22%23999%22><rect width=%2216%22 height=%2216%22 rx=%223%22/></svg>'">
            <div class="timeline-tab-info">
              <div class="timeline-tab-title">${escapeHtml(tab.title)}</div>
              <div class="timeline-tab-url">${escapeHtml(tab.url)}</div>
            </div>
            <button class="timeline-tab-delete" data-id="${tab.id}" title="删除">×</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  // 绑定时序视图事件
  setupTimelineEventListeners();
}

// 按域名分组标签页
function groupTabsByDomain(allTabs) {
  const grouped = {};

  allTabs.forEach(tab => {
    let domain = '其他';
    try {
      const url = new URL(tab.url);
      domain = url.hostname || '其他';
    } catch {
      // URL 解析失败，使用默认分组
    }

    if (!grouped[domain]) {
      grouped[domain] = [];
    }
    grouped[domain].push(tab);
  });

  // 按每个分组内的标签数量排序（多的在前）
  const sorted = {};
  Object.keys(grouped)
    .sort((a, b) => grouped[b].length - grouped[a].length)
    .forEach(domain => {
      sorted[domain] = grouped[domain];
    });

  return sorted;
}

// 设置时序视图事件监听器
function setupTimelineEventListeners() {
  // 点击标签行打开标签页
  document.querySelectorAll('.timeline-tab-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('timeline-tab-delete')) return;
      const tabId = row.dataset.tabId;
      const tab = timelineTabs.find(t => t.id === tabId);
      if (tab) {
        chrome.runtime.sendMessage({ action: 'openTab', url: tab.url });
      }
    });
  });

  // 删除单个标签
  document.querySelectorAll('.timeline-tab-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = btn.dataset.id;

      await chrome.runtime.sendMessage({
        action: 'deleteTimelineTab',
        tabId
      });

      await loadData();
      renderTimelineView();
    });
  });

  // 域名组操作按钮
  document.querySelectorAll('.timeline-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const group = btn.closest('.timeline-domain-group');
      const domain = group.dataset.domain;

      // 获取该域名下的所有标签
      const tabIds = Array.from(group.querySelectorAll('.timeline-tab-row'))
        .map(row => row.dataset.tabId);

      if (action === 'restore-all') {
        // 恢复该域名下的所有标签
        for (const tabId of tabIds) {
          const tab = timelineTabs.find(t => t.id === tabId);
          if (tab) {
            await chrome.runtime.sendMessage({ action: 'openTab', url: tab.url });
          }
        }
      } else if (action === 'delete-all') {
        // 删除该域名下的所有标签
        if (confirm(`确定要删除 ${domain} 下的所有标签吗？`)) {
          for (const tabId of tabIds) {
            await chrome.runtime.sendMessage({
              action: 'deleteTimelineTab',
              tabId
            });
          }
          await loadData();
          renderTimelineView();
        }
      }
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
  // 如果点击的是删除按钮，不处理
  const deleteBtn = el.querySelector('.kanban-item-delete');
  if (deleteBtn && (window.event.target === deleteBtn || deleteBtn.contains(window.event.target))) {
    return;
  }

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
  // 在捕获阶段添加监听器，确保在 jKanban 之前执行
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

    // 每次DOM变化时重新绑定删除按钮
    setupDeleteButtons();
  });

  observer.observe(document.getElementById('tabboard'), {
    childList: true,
    subtree: true
  });

  // 初始设置删除按钮的事件委托
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
