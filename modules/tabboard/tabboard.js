/**
 * TabBoard - 标签页看板
 * 支持拖拽分组、标签管理
 */

let groups = [];
let tabs = {};
let draggedTab = null;
let draggedFromGroup = null;

// 初始化
async function init() {
  await loadData();
  renderBoard();
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

// 渲染看板
function renderBoard() {
  const board = document.getElementById('board');
  const emptyState = document.getElementById('emptyState');
  const stats = document.getElementById('stats');

  // 计算总标签数
  const totalTabs = Object.values(tabs).flat().length;
  stats.textContent = `${totalTabs} 个标签页 · ${groups.length} 个分组`;

  if (groups.length === 0 || totalTabs === 0) {
    board.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }

  board.style.display = 'flex';
  emptyState.style.display = 'none';

  board.innerHTML = groups.map(group => {
    const groupTabs = tabs[group.id] || [];
    return `
      <div class="group-column" data-group-id="${group.id}">
        <div class="group-header" style="border-bottom-color: ${group.color}; background: ${group.color}15;">
          <div class="group-header-color" style="background: ${group.color}"></div>
          <div class="group-header-info">
            <div class="group-header-name" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</div>
            <div class="group-header-count">${groupTabs.length} 个标签</div>
          </div>
          <div class="group-header-actions">
            <button class="open-all" data-group-id="${group.id}" title="打开所有">📂</button>
            <button class="clear-group" data-group-id="${group.id}" title="清空分组">🗑️</button>
          </div>
        </div>
        <div class="group-content" data-group-id="${group.id}">
          ${groupTabs.length === 0 ? '<div class="group-empty">暂无标签页</div>' : ''}
          ${groupTabs.map(tab => renderTabCard(tab, group.id)).join('')}
        </div>
      </div>
    `;
  }).join('');

  setupDragAndDrop();
  setupCardEvents();
}

// 渲染标签卡片
function renderTabCard(tab, groupId) {
  const favicon = tab.favicon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📄</text></svg>';
  const time = formatTime(tab.timestamp);

  return `
    <div class="tab-card" draggable="true" data-tab-id="${tab.id}" data-group-id="${groupId}">
      <div class="tab-header">
        <img class="tab-favicon" src="${escapeHtml(favicon)}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><text y=\".9em\" font-size=\"90\">📄</text></svg>'">
        <span class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</span>
        <button class="tab-delete" data-tab-id="${tab.id}" data-group-id="${groupId}" title="删除">×</button>
      </div>
      <div class="tab-url" title="${escapeHtml(tab.url)}">${escapeHtml(tab.url)}</div>
      <div class="tab-time">${time}</div>
    </div>
  `;
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

// 设置拖拽功能
function setupDragAndDrop() {
  const cards = document.querySelectorAll('.tab-card');
  const dropZones = document.querySelectorAll('.group-content');

  cards.forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', handleDragOver);
    zone.addEventListener('dragleave', handleDragLeave);
    zone.addEventListener('drop', handleDrop);
  });
}

// 拖拽开始
function handleDragStart(e) {
  draggedTab = e.target.dataset.tabId;
  draggedFromGroup = e.target.dataset.groupId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

// 拖拽结束
function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.group-content').forEach(zone => {
    zone.classList.remove('drag-over');
  });
  draggedTab = null;
  draggedFromGroup = null;
}

// 拖拽经过
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

// 拖拽离开
function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

// 放置
async function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');

  const toGroup = e.currentTarget.dataset.groupId;

  if (!draggedTab || !draggedFromGroup || draggedFromGroup === toGroup) {
    return;
  }

  await chrome.runtime.sendMessage({
    action: 'moveTab',
    fromGroup: draggedFromGroup,
    toGroup: toGroup,
    tabId: draggedTab
  });

  await loadData();
  renderBoard();
}

// 设置卡片事件
function setupCardEvents() {
  // 点击打开标签页
  document.querySelectorAll('.tab-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-delete')) return;

      const tabId = card.dataset.tabId;
      const tab = findTab(tabId);
      if (tab) {
        chrome.runtime.sendMessage({
          action: 'openTab',
          url: tab.url
        });
      }
    });
  });

  // 删除标签页
  document.querySelectorAll('.tab-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();

      const tabId = btn.dataset.tabId;
      const groupId = btn.dataset.groupId;

      await chrome.runtime.sendMessage({
        action: 'deleteTab',
        tabId,
        groupId
      });

      await loadData();
      renderBoard();
    });
  });

  // 打开分组的所有标签
  document.querySelectorAll('.open-all').forEach(btn => {
    btn.addEventListener('click', async () => {
      const groupId = btn.dataset.groupId;
      await chrome.runtime.sendMessage({ action: 'openGroup', groupId });
      await loadData();
      renderBoard();
    });
  });

  // 清空分组
  document.querySelectorAll('.clear-group').forEach(btn => {
    btn.addEventListener('click', async () => {
      const groupId = btn.dataset.groupId;
      const groupTabs = tabs[groupId] || [];

      if (groupTabs.length === 0) return;

      if (!confirm(`确定要清空 "${groups.find(g => g.id === groupId)?.name}" 分组吗？`)) {
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
      renderBoard();
    });
  });
}

// 查找标签页
function findTab(tabId) {
  for (const groupId in tabs) {
    const tab = tabs[groupId].find(t => t.id === tabId);
    if (tab) return tab;
  }
  return null;
}

// 设置事件监听器
function setupEventListeners() {
  // 刷新按钮
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    await loadData();
    renderBoard();
  });

  // 设置按钮
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
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
    renderBoard();
  }
});

// 初始化
document.addEventListener('DOMContentLoaded', init);
