/**
 * Group 领域模型 — groups / tabs 数据结构的唯一存储入口
 *
 * 规约:
 * - 所有对 groups / tabs 的读写必须经过本模块导出的函数(程序语言接口)。
 * - background 内部模块(focus.js / goto.js / init.js)直接 import 调用;
 *   前端上下文(popup / tabboard view / content script)通过消息
 *   → background/groups.js 适配层 → 本模块。
 * - 除本模块外,任何地方禁止 chrome.storage.local.get/set(['groups'/'tabs'])。
 * - 领域函数失败时 throw Error,由适配层转 { success: false, error }。
 */

import { generateId, getUrlBase, DEFAULT_COLORS } from './utils.js';

const DEFAULT_GROUP_MAX_TABS = 100;

// ===================== 读操作 =====================

async function getGroups() {
  const { groups } = await chrome.storage.local.get(['groups']);
  return groups || [];
}

async function getTabsMap() {
  const { tabs } = await chrome.storage.local.get(['tabs']);
  return tabs || {};
}

async function getDefaultGroupId() {
  const groups = await getGroups();
  const defaultGroup = groups.find(g => g.isDefault);
  return defaultGroup?.id || groups[0]?.id;
}

// goto 圆环数据:所有 goto=true 的 group + 各自前 6 个 tab
async function getGotoMenuData() {
  const [groups, tabsMap] = await Promise.all([getGroups(), getTabsMap()]);
  return groups
    .filter(g => g.goto === true)
    .map(g => ({
      id: g.id,
      name: g.name || '📄 面包',
      tabs: (tabsMap[g.id] || [])
        .filter(t => t && t.url)
        .slice(0, 6)
        .map(t => ({ title: t.title || t.url, url: t.url }))
    }))
    .filter(g => g.tabs.length > 0);
}

// goto 管理圆环数据:所有 goto=true 的 group + 各自完整 tab 列表(不限数量,保留空 group)
async function getGotoGroupsFull() {
  const [groups, tabsMap] = await Promise.all([getGroups(), getTabsMap()]);
  return groups
    .filter(g => g.goto === true)
    .map(g => ({
      id: g.id,
      name: g.name || '📄 面包',
      color: g.color || '#f9ca24',
      tabs: tabsMap[g.id] || []
    }));
}

// ===================== Group CRUD =====================

async function createGroup({ name, color, isDefault = false, goto = false, inFocusSearch = false, visible = true }) {
  const groups = await getGroups();
  const newGroup = { id: generateId(), name, color, isDefault, goto, inFocusSearch, visible };
  groups.push(newGroup);
  await chrome.storage.local.set({ groups });
  return newGroup;
}

async function deleteGroup(groupId) {
  const [groups, tabsMap] = await Promise.all([getGroups(), getTabsMap()]);
  const newGroups = groups.filter(g => g.id !== groupId);
  delete tabsMap[groupId];
  // 标记(goto/inFocusSearch/visible)长在 group 对象上,随分组一起删除,无需清理引用
  await chrome.storage.local.set({ groups: newGroups, tabs: tabsMap });
}

async function renameGroup(groupId, newName) {
  const groups = await getGroups();
  const target = groups.find(g => g.id === groupId);
  if (!target) throw new Error('Group not found');
  target.name = newName;
  await chrome.storage.local.set({ groups });
}

async function setDefaultGroup(groupId) {
  const groups = await getGroups();
  groups.forEach(g => { g.isDefault = (g.id === groupId); });
  await chrome.storage.local.set({ groups });
}

async function updateBoardOrder(boardOrder) {
  if (!Array.isArray(boardOrder) || boardOrder.length === 0) return;
  const groups = await getGroups();
  const groupMap = new Map(groups.map(g => [g.id, g]));
  const ordered = [];
  // 按指定顺序添加
  for (const groupId of boardOrder) {
    if (groupMap.has(groupId)) {
      ordered.push(groupMap.get(groupId));
      groupMap.delete(groupId);
    }
  }
  // 未在 boardOrder 中的分组(新创建的等)追加到末尾
  for (const group of groupMap.values()) {
    ordered.push(group);
  }
  await chrome.storage.local.set({ groups: ordered });
}

async function importGroupsAndTabs(groups, tabs) {
  await chrome.storage.local.set({ groups, tabs });
}

// ===================== Group 标记(flag) =====================
// goto / inFocusSearch / visible 都是 group 的属性,统一由这里操作

async function toggleGoto(groupId) {
  const groups = await getGroups();
  const target = groups.find(g => g.id === groupId);
  if (!target) throw new Error('Group not found');
  target.goto = !target.goto;
  await chrome.storage.local.set({ groups });
  return target.goto;
}

async function setGroupFocusSearch(groupId, value) {
  const groups = await getGroups();
  const target = groups.find(g => g.id === groupId);
  if (!target) throw new Error('Group not found');
  target.inFocusSearch = value === true;
  await chrome.storage.local.set({ groups });
  return target.inFocusSearch;
}

async function setGroupsVisibility(visibleGroupIds) {
  const groups = await getGroups();
  const visibleSet = new Set(visibleGroupIds || []);
  for (const g of groups) {
    g.visible = visibleSet.has(g.id);
  }
  await chrome.storage.local.set({ groups });
}

// ===================== Tab 操作 =====================

/**
 * 添加标签到分组(已存在同 URL 则跳过)
 * @param {object} opts.maxTabs 上限(默认 100,History 分组用 200)
 * @param {object} opts.initVisitCount 是否初始化 visitCount/lastVisit(History 分组用)
 */
async function addTabToGroup(tab, groupId, { maxTabs = DEFAULT_GROUP_MAX_TABS, initVisitCount = false } = {}) {
  if (!tab.url || tab.url === 'about:blank' || tab.url.trim() === '') return false;
  if (!tab.title || tab.title.trim() === '') return false;

  const tabsMap = await getTabsMap();
  if (!tabsMap[groupId]) tabsMap[groupId] = [];

  const exists = tabsMap[groupId].some(t => t.url === tab.url);
  if (exists) return false;

  const entry = {
    id: generateId(),
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon || '',
    timestamp: new Date().toISOString()
  };
  if (initVisitCount) {
    entry.visitCount = 1;
    entry.lastVisit = new Date().toISOString();
  }
  tabsMap[groupId].unshift(entry);

  if (tabsMap[groupId].length > maxTabs) {
    tabsMap[groupId] = tabsMap[groupId].slice(0, maxTabs);
  }

  await chrome.storage.local.set({ tabs: tabsMap });
  return true;
}

// 从分组移除标签(精确 URL 匹配)
async function removeTabFromGroup(tab, groupId) {
  if (!tab || !tab.url) return false;
  const tabsMap = await getTabsMap();
  const groupTabs = tabsMap[groupId];
  if (!Array.isArray(groupTabs) || groupTabs.length === 0) return false;

  const before = groupTabs.length;
  tabsMap[groupId] = groupTabs.filter(t => t.url !== tab.url);
  if (tabsMap[groupId].length === before) return false;

  await chrome.storage.local.set({ tabs: tabsMap });
  return true;
}

async function toggleTabInGroup(tab, groupId) {
  const added = await addTabToGroup(tab, groupId);
  if (added) return 'added';
  const removed = await removeTabFromGroup(tab, groupId);
  if (removed) return 'removed';
  return 'noop';
}

async function updateTab({ tabId, groupId, updates }) {
  if (!tabId || !groupId || !updates) throw new Error('缺少参数');
  const tabsMap = await getTabsMap();
  const groupTabs = tabsMap[groupId];
  if (!Array.isArray(groupTabs)) throw new Error('分组不存在');
  const tab = groupTabs.find(t => t.id === tabId);
  if (!tab) throw new Error('标签不存在');

  // 仅允许更新 title/url/favicon 字段
  if (typeof updates.title === 'string' && updates.title.trim()) {
    tab.title = updates.title.trim();
  }
  if (typeof updates.url === 'string' && updates.url.trim()) {
    try {
      new URL(updates.url.trim());
      tab.url = updates.url.trim();
    } catch (e) {
      throw new Error('URL 格式无效');
    }
  }
  if (typeof updates.favicon === 'string') {
    tab.favicon = updates.favicon;
  }
  await chrome.storage.local.set({ tabs: tabsMap });
}

async function moveTab({ fromGroup, toGroup, tabId, afterTabId }) {
  const tabsMap = await getTabsMap();

  let tabToMove = tabsMap[fromGroup]?.find(t => t.id === tabId);
  if (tabsMap[fromGroup]) {
    tabsMap[fromGroup] = tabsMap[fromGroup].filter(t => t.id !== tabId);
  }

  // 如果原分组没找到,从所有分组中查找
  if (!tabToMove) {
    for (const gid in tabsMap) {
      const found = tabsMap[gid].find(t => t.id === tabId);
      if (found) {
        tabToMove = found;
        tabsMap[gid] = tabsMap[gid].filter(t => t.id !== tabId);
        break;
      }
    }
  }

  if (tabToMove) {
    if (!tabsMap[toGroup]) tabsMap[toGroup] = [];
    if (afterTabId) {
      const afterIndex = tabsMap[toGroup].findIndex(t => t.id === afterTabId);
      if (afterIndex !== -1) {
        tabsMap[toGroup].splice(afterIndex + 1, 0, tabToMove);
      } else {
        tabsMap[toGroup].push(tabToMove);
      }
    } else {
      tabsMap[toGroup].unshift(tabToMove);
    }
    await chrome.storage.local.set({ tabs: tabsMap });
  }
}

async function deleteTab({ groupId, tabId }) {
  const tabsMap = await getTabsMap();
  if (tabsMap[groupId]) {
    tabsMap[groupId] = tabsMap[groupId].filter(t => t.id !== tabId);
    await chrome.storage.local.set({ tabs: tabsMap });
  }
}

async function clearGroupTabs(groupId) {
  const tabsMap = await getTabsMap();
  if (tabsMap[groupId]) {
    tabsMap[groupId] = [];
    await chrome.storage.local.set({ tabs: tabsMap });
  }
}

async function clearAllGroupTabs() {
  const tabsMap = await getTabsMap();
  for (const groupId in tabsMap) {
    tabsMap[groupId] = [];
  }
  await chrome.storage.local.set({ tabs: tabsMap });
}

/**
 * 批量写入一组 tab 到指定分组(不做去重、不做上限检查)
 * 适用场景:timeline 快照提取为新分组(数据源已是用户标记的 tab)
 */
async function seedGroupTabs(groupId, tabs) {
  const tabsMap = await getTabsMap();
  if (!tabsMap[groupId]) tabsMap[groupId] = [];
  for (const t of tabs) {
    tabsMap[groupId].push({
      id: generateId(),
      title: t.title,
      url: t.url,
      favicon: t.favicon || '',
      timestamp: t.timestamp || new Date().toISOString()
    });
  }
  await chrome.storage.local.set({ tabs: tabsMap });
}

async function incrementVisitCount(url) {
  const tabsMap = await getTabsMap();
  let found = false;

  for (const groupId in tabsMap) {
    for (const tab of tabsMap[groupId]) {
      // 使用 URL 基础部分匹配(忽略查询参数和 hash)
      if (getUrlBase(tab.url) === getUrlBase(url)) {
        tab.visitCount = (tab.visitCount || 0) + 1;
        tab.lastVisit = new Date().toISOString();
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (found) {
    await chrome.storage.local.set({ tabs: tabsMap });
  }
  return found;
}

async function sortAllTabsByVisitCount() {
  const tabsMap = await getTabsMap();
  for (const groupId in tabsMap) {
    tabsMap[groupId] = tabsMap[groupId].sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
  }
  await chrome.storage.local.set({ tabs: tabsMap });
}

// ===================== 初始化与迁移(供 init.js 调用) =====================

/**
 * group 域的默认数据初始化 + 老数据标记迁移。
 * - 首装:建 3 个默认分组;若无 goto 分组,建"📄 面包"并 seed 6 个 tab
 * - 迁移:settings.focusSearchGroups / settings.visibleGroups → group.inFocusSearch / group.visible,
 *   迁移完成后删除 settings 中的遗留 key
 */
async function ensureGroupDefaults() {
  const result = await chrome.storage.local.get(['groups', 'tabs', 'settings']);
  const settings = result.settings || {};

  // ── 首装:默认分组 ──
  let groups = result.groups;
  if (!groups) {
    groups = [
      { id: generateId(), name: '工作', color: DEFAULT_COLORS[0], isDefault: true, goto: false, inFocusSearch: false, visible: true },
      { id: generateId(), name: '学习', color: DEFAULT_COLORS[1], isDefault: false, goto: false, inFocusSearch: false, visible: true },
      { id: generateId(), name: '娱乐', color: DEFAULT_COLORS[2], isDefault: false, goto: false, inFocusSearch: false, visible: true }
    ];
    await chrome.storage.local.set({ groups });
  }
  if (!result.tabs) {
    await chrome.storage.local.set({ tabs: {} });
  }

  // ── goto 圆环:若无 goto=true 分组,建"📄 面包"并 seed ──
  // (visible: false — 保持历史行为:seed 分组不在看板显示)
  if (!groups.some(g => g.goto === true)) {
    const breadGroup = await createGroup({
      name: '📄 面包',
      color: '#f9ca24',
      goto: true,
      visible: false
    });
    const tabsMap = await getTabsMap();
    tabsMap[breadGroup.id] = [
      { id: generateId(), title: '上海演唱会', url: 'https://www.bilibili.com/video/BV1L48qzsESK?spm_id_from=333.788.videopod.sections', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '宁波演唱会', url: 'https://www.bilibili.com/video/BV1pca3zPECZ/?spm_id_from=333.337.search-card.all.click&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '北京演唱会', url: 'https://www.bilibili.com/video/BV13hSzYfEfD?spm_id_from=333.788.videopod.sections&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '广州演唱会', url: 'https://www.bilibili.com/video/BV1g2oiYqEiM?spm_id_from=333.788.videopod.sections&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '成都演唱会', url: 'https://www.bilibili.com/video/BV1dUjkzqEUj/?spm_id_from=333.788.videopod.sections&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '天津演唱会', url: 'https://www.bilibili.com/video/BV1hNq1BTEG8/?spm_id_from=333.337.search-card.all.click', favicon: '', timestamp: new Date().toISOString() }
    ];
    await chrome.storage.local.set({ tabs: tabsMap });
  }

  // ── 标记迁移:settings 遗留数组 → group 属性 ──
  const legacyFocusIds = new Set(Array.isArray(settings.focusSearchGroups) ? settings.focusSearchGroups : []);
  // null = 从未设置过可见性 → 默认全部可见(与旧 view.js fallback 一致)
  const legacyVisibleIds = Array.isArray(settings.visibleGroups) ? new Set(settings.visibleGroups) : null;

  let groupsUpdated = false;
  for (const g of groups) {
    if (g.goto === undefined) { g.goto = false; groupsUpdated = true; }
    if (g.inFocusSearch === undefined) { g.inFocusSearch = legacyFocusIds.has(g.id); groupsUpdated = true; }
    if (g.visible === undefined) { g.visible = legacyVisibleIds ? legacyVisibleIds.has(g.id) : true; groupsUpdated = true; }
  }
  if (groupsUpdated) {
    await chrome.storage.local.set({ groups });
  }

  // 迁移完成后清理 settings 遗留 key
  if ('focusSearchGroups' in settings || 'visibleGroups' in settings) {
    const cleaned = { ...settings };
    delete cleaned.focusSearchGroups;
    delete cleaned.visibleGroups;
    await chrome.storage.local.set({ settings: cleaned });
  }
}

export {
  // 读
  getGroups,
  getTabsMap,
  getDefaultGroupId,
  getGotoMenuData,
  getGotoGroupsFull,
  // group CRUD
  createGroup,
  deleteGroup,
  renameGroup,
  setDefaultGroup,
  updateBoardOrder,
  importGroupsAndTabs,
  // 标记
  toggleGoto,
  setGroupFocusSearch,
  setGroupsVisibility,
  // tab
  addTabToGroup,
  removeTabFromGroup,
  toggleTabInGroup,
  updateTab,
  moveTab,
  deleteTab,
  clearGroupTabs,
  clearAllGroupTabs,
  incrementVisitCount,
  sortAllTabsByVisitCount,
  seedGroupTabs,
  // 初始化/迁移
  ensureGroupDefaults
};
