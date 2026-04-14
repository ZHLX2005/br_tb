/**
 * TabBoard Popup
 * 分组管理和设置页面
 */

// 默认颜色
const DEFAULT_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7',
  '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'
];

let selectedColor = DEFAULT_COLORS[0];

// 加载分组列表
async function loadGroups() {
  const response = await chrome.runtime.sendMessage({ action: 'getGroups' });
  if (!response.success) return;

  // 获取设置以获取可见分组列表和专注搜索分组
  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse.settings || {};
  const visibleGroups = new Set(settings.visibleGroups || []);
  const focusSearchGroups = settings.focusSearchGroups || [];

  const groupsList = document.getElementById('groupsList');

  // 只显示可见的分组
  const visibleGroupsList = response.groups.filter(group => visibleGroups.has(group.id));

  if (visibleGroupsList.length === 0) {
    groupsList.innerHTML = '<div class="empty-state">暂无可显示的分组（请在看板中筛选）</div>';
    return;
  }

  groupsList.innerHTML = visibleGroupsList.map(group => {
    const isInFocusSearch = focusSearchGroups.includes(group.id);
    return `<div class="group-item" style="border-left-color: ${group.color}">
      <div class="group-color" style="background: ${group.color}"></div>
      <div class="group-name">${escapeHtml(group.name)}</div>
      ${group.isDefault ? '<span class="group-default-badge">目标</span>' : ''}
      ${isInFocusSearch ? '<span class="focus-search-badge">🔍</span>' : `<button class="add-to-focus" data-id="${group.id}">+搜索</button>`}
      <div class="group-actions-buttons">
        ${!group.isDefault ? `<button class="set-default" data-id="${group.id}">设为目标</button>` : ''}
        <button class="delete" data-id="${group.id}">删除</button>
      </div>
    </div>`;
  }).join('');

  // 绑定事件
  document.querySelectorAll('.set-default').forEach(btn => {
    btn.addEventListener('click', () => setDefaultGroup(btn.dataset.id));
  });

  document.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', () => deleteGroup(btn.dataset.id));
  });

  document.querySelectorAll('.add-to-focus').forEach(btn => {
    btn.addEventListener('click', () => addToFocusSearch(btn.dataset.id));
  });
}

// 添加分组到专注搜索
async function addToFocusSearch(groupId) {
  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse.settings || {};
  const focusSearchGroups = settings.focusSearchGroups || [];

  if (!focusSearchGroups.includes(groupId)) {
    focusSearchGroups.push(groupId);
    await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { focusSearchGroups }
    });
  }

  loadGroups();
  loadFocusSearchGroups();
}

// 加载设置
async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
  if (!response.success) return;

  const settings = response.settings;
  document.getElementById('closeAfterCollect').checked = settings.closeAfterCollect || false;
  document.getElementById('closeAfterRestore').checked = settings.closeAfterRestore || false;
  document.getElementById('excludeEdgeUrls').checked = settings.excludeEdgeUrls || false;
}

// 设置目标分组（快捷键添加标签时的默认目标）
async function setDefaultGroup(groupId) {
  await chrome.runtime.sendMessage({ action: 'setDefaultGroup', groupId });
  await loadGroups();
}

// 删除分组
async function deleteGroup(groupId) {
  const confirmed = await window.modal.confirm('确定要删除这个分组吗？分组内的标签页也会被删除。', {
    title: '删除分组',
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消'
  });
  if (!confirmed) return;

  await chrome.runtime.sendMessage({ action: 'deleteGroup', groupId });
  await loadGroups();
}

// 添加分组
async function addGroup() {
  const name = document.getElementById('newGroupName').value.trim();
  if (!name) {
    alert('请输入分组名称');
    return;
  }

  await chrome.runtime.sendMessage({
    action: 'addGroup',
    name,
    color: selectedColor
  });

  closeAddGroupDialog();
  await loadGroups();
}

// 打开添加分组对话框
function openAddGroupDialog() {
  document.getElementById('addGroupDialog').classList.add('active');
  document.getElementById('newGroupName').value = '';
  selectedColor = DEFAULT_COLORS[0];
  renderColorPicker();
}

// 关闭添加分组对话框
function closeAddGroupDialog() {
  document.getElementById('addGroupDialog').classList.remove('active');
}

// 渲染颜色选择器
function renderColorPicker() {
  const colorPicker = document.getElementById('colorPicker');
  colorPicker.innerHTML = DEFAULT_COLORS.map(color => `
    <div class="color-option ${color === selectedColor ? 'selected' : ''}"
         style="background: ${color}"
         data-color="${color}"></div>
  `).join('');

  colorPicker.querySelectorAll('.color-option').forEach(option => {
    option.addEventListener('click', () => {
      selectedColor = option.dataset.color;
      renderColorPicker();
    });
  });
}

// 打开看板
async function openTabboard() {
  await chrome.runtime.sendMessage({ action: 'openTabboard' });
  window.close();
}

// 打开侧边栏
async function openSidebar() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
}

// 收集并打开看板
async function collectAndOpen() {
  await chrome.runtime.sendMessage({ action: 'collectAndOpenTabboard' });
  window.close();
}

// 收集其他标签页（除了当前页面）
async function collectOtherTabs() {
  await chrome.runtime.sendMessage({ action: 'collectOtherTabs' });
  window.close();
}

// 保存设置
async function saveSettings() {
  const settings = {
    closeAfterCollect: document.getElementById('closeAfterCollect').checked,
    closeAfterRestore: document.getElementById('closeAfterRestore').checked,
    excludeEdgeUrls: document.getElementById('excludeEdgeUrls').checked
  };

  await chrome.runtime.sendMessage({ action: 'updateSettings', settings });
}

// 加载专注搜索分组
async function loadFocusSearchGroups() {
  const groupsResponse = await chrome.runtime.sendMessage({ action: 'getGroups' });
  if (!groupsResponse.success) return;

  const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResponse.settings || {};
  const enabledGroupIds = settings.focusSearchGroups || [];

  const tabsResponse = await chrome.runtime.sendMessage({ action: 'getAllData' });
  const tabs = tabsResponse.tabs || {};

  const container = document.getElementById('focusSearchGroupsList');

  // 只显示已在 focusSearchGroups 中勾选的分组
  const enabledGroups = groupsResponse.groups.filter(group => {
    return enabledGroupIds.includes(group.id);
  });

  if (enabledGroups.length === 0) {
    container.innerHTML = '<div class="empty-state">暂未选择任何分组<br><small>请到分组管理中添加</small></div>';
    return;
  }

  container.innerHTML = enabledGroups.map(group => {
    const tabCount = tabs[group.id] ? tabs[group.id].length : 0;
    return `<div class="focus-group-item">
      <span class="focus-color-dot" style="background:${group.color}"></span>
      <span class="focus-group-name">${escapeHtml(group.name)}</span>
      <span class="focus-group-count">${tabCount}个</span>
      <button class="focus-group-remove" data-id="${group.id}">×</button>
    </div>`;
  }).join('');

  // 移除按钮事件
  container.querySelectorAll('.focus-group-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.dataset.id;
      const newEnabled = enabledGroupIds.filter(id => id !== groupId);
      chrome.runtime.sendMessage({
        action: 'updateSettings',
        settings: { focusSearchGroups: newEnabled }
      });
      loadFocusSearchGroups();
    });
  });
}

// 保存专注搜索分组选择
async function saveFocusSearchGroups() {
  const checkboxes = document.querySelectorAll('#focusSearchGroupsList input[type="checkbox"]:checked');
  const enabledGroupIds = Array.from(checkboxes).map(cb => cb.value);

  await chrome.runtime.sendMessage({
    action: 'updateSettings',
    settings: { focusSearchGroups: enabledGroupIds }
  });
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadGroups();
  loadSettings();
  renderColorPicker();

  // 绑定事件
  document.getElementById('addGroupBtn').addEventListener('click', openAddGroupDialog);
  document.getElementById('cancelAddGroup').addEventListener('click', closeAddGroupDialog);
  document.getElementById('confirmAddGroup').addEventListener('click', addGroup);
  document.getElementById('openTabboardBtn').addEventListener('click', openTabboard);
  document.getElementById('openSidebarBtn').addEventListener('click', openSidebar);
  document.getElementById('collectAndOpenBtn').addEventListener('click', collectAndOpen);
  document.getElementById('collectOtherTabsBtn').addEventListener('click', collectOtherTabs);

  // 设置复选框事件
  document.getElementById('closeAfterCollect').addEventListener('change', saveSettings);
  document.getElementById('closeAfterRestore').addEventListener('change', saveSettings);
  document.getElementById('excludeEdgeUrls').addEventListener('change', saveSettings);

  loadFocusSearchGroups();

  // Tab导航切换（悬浮触发）
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('mouseenter', () => {
      const pageId = tab.dataset.page;
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('page-' + pageId).classList.add('active');
    });
  });

  // 点击对话框外部关闭
  document.getElementById('addGroupDialog').addEventListener('click', (e) => {
    if (e.target.id === 'addGroupDialog') {
      closeAddGroupDialog();
    }
  });

  // ESC键关闭对话框
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAddGroupDialog();
    }
  });
});
