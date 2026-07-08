/**
 * TabBoard Popup
 * 模块化入口文件
 * 协调各功能模块
 */

import { loadGroups, setDefaultGroup, deleteGroup, addGroup, toggleFocusSearchGroup, getSelectedColor } from './modules/groups.js';
import { loadSettings, bindSettingsListeners } from './modules/settings.js';
import { bindQuickActionsListeners } from './modules/quickActions.js';
import { loadVideoProgress, bindVideoProgressEvents, refreshCurrentVideo } from './modules/videoProgress.js';
import { loadLcSidebarSetting, bindLcSidebarEvents } from './modules/lcSettings.js';
import { loadGotoRingSetting, bindGotoRingEvents } from './modules/gotoSettings.js';
import { loadRingSidebarSetting, bindRingSidebarEvents } from './modules/ringSettings.js';
import { loadVpSidebarSetting, bindVpSidebarEvents } from './modules/vpSettings.js';
import { loadTimerSidebarSetting, bindTimerSidebarEvents } from './modules/timerSettings.js';
import { renderColorPicker, resetColorPicker } from './modules/colorPicker.js';
import { showToast } from './modules/utils.js';

// ==================== 主题切换 ====================

async function loadTheme() {
  const result = await chrome.storage.local.get(['settings']);
  const theme = result.settings?.theme || 'neo-brutalism';
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === theme);
  });
}

async function saveTheme(theme) {
  const result = await chrome.storage.local.get(['settings']);
  const settings = { ...result.settings, theme };
  await chrome.storage.local.set({ settings });
}

function initTheme() {
  const themeBtn = document.getElementById('themeBtn');
  const themePanel = document.getElementById('themePanel');
  if (!themeBtn || !themePanel) return;

  // Toggle panel
  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    themePanel.classList.toggle('open');
  });

  // Select theme
  themePanel.addEventListener('click', async (e) => {
    const option = e.target.closest('.theme-option');
    if (!option) return;
    const theme = option.dataset.theme;
    applyTheme(theme);
    themePanel.classList.remove('open');
    await saveTheme(theme);
    showToast(document.querySelector('.app'), `主题已切换到「${option.textContent}」`, 'success');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.theme-panel') && !e.target.closest('#themeBtn')) {
      themePanel.classList.remove('open');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') themePanel.classList.remove('open');
  });
}

// ==================== 分组对话框控制 ====================

/**
 * 打开添加分组对话框
 */
export function openAddGroupDialog() {
  document.getElementById('addGroupDialog').classList.add('active');
  document.getElementById('newGroupName').value = '';
  resetColorPicker();
}

/**
 * 关闭添加分组对话框
 */
export function closeAddGroupDialog() {
  document.getElementById('addGroupDialog').classList.remove('active');
}

/**
 * 添加分组处理
 */
async function handleAddGroup() {
  const name = document.getElementById('newGroupName').value.trim();
  if (!name) {
    showToast(document.querySelector('.app'), '请输入分组名称', 'error');
    return;
  }

  try {
    await addGroup(name, getSelectedColor());
    closeAddGroupDialog();
    await loadGroups({
      onDelete: handleDeleteGroup,
      onSetDefault: handleSetDefaultGroup,
      onToggleFocus: handleToggleFocus
    });
    showToast(document.querySelector('.app'), '分组已创建', 'success');
  } catch (e) {
    showToast(document.querySelector('.app'), e.message, 'error');
  }
}

/**
 * 设置默认分组处理
 */
async function handleSetDefaultGroup(groupId) {
  await setDefaultGroup(groupId);
  await loadGroups({
    onDelete: handleDeleteGroup,
    onSetDefault: handleSetDefaultGroup,
    onToggleFocus: handleToggleFocus
  });
}

/**
 * 删除分组处理
 */
async function handleDeleteGroup(groupId) {
  const success = await deleteGroup(groupId);
  if (success) {
    await loadGroups({
      onDelete: handleDeleteGroup,
      onSetDefault: handleSetDefaultGroup,
      onToggleFocus: handleToggleFocus
    });
    showToast(document.querySelector('.app'), '分组已删除', 'success');
  }
}

/**
 * 切换专注搜索分组（行内 checkbox）
 */
async function handleToggleFocus(groupId, enabled, prevChecked) {
  try {
    await toggleFocusSearchGroup(groupId, enabled);
  } catch (e) {
    const box = document.getElementById('groupsList')?.querySelector(`.focus-checkbox[data-id="${groupId}"]`);
    if (box) box.checked = prevChecked;
    showToast(document.querySelector('.app'), `专注搜索更新失败: ${e.message}`, 'error');
  }
}

// ==================== Tab导航 ====================

/**
 * 初始化Tab导航（悬浮触发）
 */
function initTabNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('mouseenter', () => {
      const pageId = tab.dataset.page;
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('page-' + pageId)?.classList.add('active');
    });
  });
}

// ==================== 初始化 ====================

/**
 * 初始化对话框事件
 */
function initDialogEvents() {
  const dialog = document.getElementById('addGroupDialog');

  // 对话框外部点击关闭
  dialog.addEventListener('click', (e) => {
    if (e.target.id === 'addGroupDialog') {
      closeAddGroupDialog();
    }
  });

  // ESC键关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.classList.contains('active')) {
      closeAddGroupDialog();
    }
  });
}

/**
 * 绑定UI交互事件
 */
function bindUIEvents() {
  // 添加分组按钮
  document.getElementById('addGroupBtn')?.addEventListener('click', openAddGroupDialog);
  document.getElementById('cancelAddGroup')?.addEventListener('click', closeAddGroupDialog);
  document.getElementById('confirmAddGroup')?.addEventListener('click', handleAddGroup);

  // 颜色选择器回调
  renderColorPicker('colorPicker');
}

/**
 * 主初始化函数
 */
async function init() {
  // 加载主题
  await loadTheme();

  // 加载各模块数据
  await Promise.all([
    loadSettings(),
    loadGroups({
      onDelete: handleDeleteGroup,
      onSetDefault: handleSetDefaultGroup,
      onToggleFocus: handleToggleFocus
    })
  ]);

  // 绑定设置事件
  bindSettingsListeners();

  // 绑定快捷操作
  bindQuickActionsListeners();

  // 绑定视频进度模块
  await loadVideoProgress();
  bindVideoProgressEvents();
  await refreshCurrentVideo();

  // 绑定圆环总开关（先于子开关，控制 LC/VP 等 ring-sidebar）
  await loadRingSidebarSetting();
  bindRingSidebarEvents();

  // 绑定刷题侧边栏设置
  await loadLcSidebarSetting();
  bindLcSidebarEvents();

  // 绑定视频进度圆环设置
  await loadVpSidebarSetting();
  bindVpSidebarEvents();

  // 绑定计时圆环设置
  await loadTimerSidebarSetting();
  bindTimerSidebarEvents();

  // 绑定 goto 圆环设置
  await loadGotoRingSetting();
  bindGotoRingEvents();

  // 绑定UI事件
  bindUIEvents();

  // 初始化Tab导航
  initTabNavigation();

  // 初始化对话框事件
  initDialogEvents();

  // 初始化主题切换
  initTheme();
}

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
