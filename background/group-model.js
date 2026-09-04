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
 *
 * 命名空间(ns)规约:
 * - 每个 group 拥有 ns:string 字段,标识其归属命名空间。
 * - 所有「读」函数内部按 settings.activeNamespace 过滤;跨 ns 操作显式 throw。
 * - 跨 ns 写入抛 CROSS_NAMESPACE_WRITE / CROSS_NAMESPACE_MOVE;
 *   跨 ns move 额外要求 from/to 必须同 ns。
 * - ensureGroupDefaults 把缺 ns 的老 group 补为 DEFAULT_NAMESPACE;
 *   首装时所有 seed group / default group 自动写入 ns: DEFAULT_NAMESPACE。
 */

import { generateId, getUrlBase, DEFAULT_COLORS } from './utils.js';

const DEFAULT_GROUP_MAX_TABS = 100;
const DEFAULT_NAMESPACE = 'default';
const NAMESPACE_NAME_MAX = 64;

// ns 字符串校验:Unicode 字母 / 数字 / 下划线 / 横线 / 半角空格,长度 1..NAMESPACE_NAME_MAX
// 长度上限统一走 NAMESPACE_NAME_MAX 常量,避免与 regex 字面量 {1,64} 漂移
const NAMESPACE_NAME_PATTERN = new RegExp(`^[\\p{L}\\p{N}_\\- ]{1,${NAMESPACE_NAME_MAX}}$`, 'u');
function validateNamespace(ns) {
  return typeof ns === 'string' && NAMESPACE_NAME_PATTERN.test(ns);
}

// ===================== 读操作 =====================

/**
 * 读取当前 active ns。缺 settings / 缺 activeNamespace / 非字符串 / 空串 一律回退到 "default"。
 * 这是 model 内部允许 chrome.storage.local.get(['settings']) 的特例(spec §附录 B 不变量 3 例外)。
 * @returns {Promise<string>}
 */
async function getActiveNamespace() {
  const { settings } = await chrome.storage.local.get(['settings']);
  const ns = settings?.activeNamespace;
  if (typeof ns === 'string' && ns.length > 0) return ns;
  if (settings && 'activeNamespace' in settings && typeof ns !== 'string') {
    console.warn('[group-model] settings.activeNamespace 不是合法字符串,回退到 default', ns);
  }
  return DEFAULT_NAMESPACE;
}

/**
 * 设置 active ns。非法字符串(非字符串 / 空串 / 超长 / 非法字符)抛 INVALID_NAMESPACE。
 * 写 settings 时仅覆盖 activeNamespace 一个 key,不影响 settings 中其他字段。
 * 这是 settings.activeNamespace 唯一的合法写入点(CLAUDE.md §3.2 规约)。
 * @param {string} ns
 * @returns {Promise<void>}
 */
async function setActiveNamespace(ns) {
  if (!validateNamespace(ns)) {
    throw new Error('INVALID_NAMESPACE');
  }
  const { settings } = await chrome.storage.local.get(['settings']);
  const newSettings = { ...(settings || {}), activeNamespace: ns };
  await chrome.storage.local.set({ settings: newSettings });
}

/**
 * 返回所有 ns 下的 group(忽略 active 过滤)。仅供 export / 跨 ns 操作使用。
 * @returns {Promise<Group[]>}
 */
async function getAllGroupsAcrossNamespaces() {
  const { groups } = await chrome.storage.local.get(['groups']);
  return groups || [];
}

/**
 * 返回所有 ns 下的 tabs(忽略 active 过滤)。仅供 export / 跨 ns 操作使用。
 * @returns {Promise<{[groupId: string]: Tab[]}>}
 */
async function getAllTabsMapAcrossNamespaces() {
  const { tabs } = await chrome.storage.local.get(['tabs']);
  return tabs || {};
}

/**
 * 返回 active ns 下的 group。缺 ns 的老 group 视为 DEFAULT_NAMESPACE。
 */
async function getGroups() {
  const [allGroups, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getActiveNamespace()
  ]);
  return allGroups.filter(g => (g.ns || DEFAULT_NAMESPACE) === activeNs);
}

/**
 * 返回 active ns 下的 tabs(按 parent group 的 ns 过滤,而非按 tab id)。
 * 写函数内部请使用 getAllTabsMapAcrossNamespaces + getActiveNamespace,
 * 避免把 filtered view 写回导致其他 ns 的 tabs 被擦除。
 */
async function getTabsMap() {
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const activeGroupIds = new Set(
    allGroups.filter(g => (g.ns || DEFAULT_NAMESPACE) === activeNs).map(g => g.id)
  );
  const filtered = {};
  for (const gid of Object.keys(allTabs)) {
    if (activeGroupIds.has(gid)) {
      filtered[gid] = allTabs[gid];
    }
  }
  return filtered;
}

/**
 * 返回 active ns 的默认分组 id(若有 isDefault 则用之,否则 fallback 到该 ns 内第一个 group)。
 * active ns 内无 group 时返回 null(spec §4.1.14a)。
 */
async function getDefaultGroupId() {
  const groups = await getGroups();
  const defaultGroup = groups.find(g => g.isDefault);
  if (defaultGroup?.id) return defaultGroup.id;
  if (groups[0]?.id) return groups[0].id;
  return null;
}

// goto 圆环数据:active ns 下所有 goto=true 的 group + 各自前 6 个 tab
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

// goto 管理圆环数据:active ns 下所有 goto=true 的 group + 各自完整 tab 列表(不限数量,保留空 group)
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

/**
 * 创建新 group,默认写到 active ns(可显式传 ns 覆盖 — 仅供内部初始化使用)。
 * 若 active ns 内没有 isDefault=true 的 group,新 group 自动成为 default。
 */
async function createGroup({ name, color, isDefault = false, goto = false, inFocusSearch = false, visible = true, ns = null }) {
  const targetNs = ns || await getActiveNamespace();
  const groups = await getAllGroupsAcrossNamespaces();

  // Auto-default: active ns 内若无 isDefault=true 的 group,新建者自动成为 default
  const hasDefault = groups.some(g => (g.ns || DEFAULT_NAMESPACE) === targetNs && g.isDefault === true);
  if (!hasDefault) isDefault = true;

  const newGroup = { id: generateId(), name, color, isDefault, goto, inFocusSearch, visible, ns: targetNs };
  groups.push(newGroup);
  await chrome.storage.local.set({ groups });
  return newGroup;
}

async function deleteGroup(groupId) {
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const target = allGroups.find(g => g.id === groupId);
  if (target && (target.ns || DEFAULT_NAMESPACE) !== activeNs) {
    throw new Error('CROSS_NAMESPACE_DELETE');
  }
  const newGroups = allGroups.filter(g => g.id !== groupId);
  delete allTabs[groupId];
  // 标记(goto/inFocusSearch/visible)长在 group 对象上,随分组一起删除,无需清理引用
  await chrome.storage.local.set({ groups: newGroups, tabs: allTabs });
}

async function renameGroup(groupId, newName) {
  const [allGroups, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const target = allGroups.find(g => g.id === groupId);
  if (!target) throw new Error('Group not found');
  if ((target.ns || DEFAULT_NAMESPACE) !== activeNs) throw new Error('CROSS_NAMESPACE_RENAME');
  target.name = newName;
  await chrome.storage.local.set({ groups: allGroups });
}

async function setDefaultGroup(groupId) {
  const [allGroups, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const target = allGroups.find(g => g.id === groupId);
  if (!target) throw new Error('Group not found');
  if ((target.ns || DEFAULT_NAMESPACE) !== activeNs) throw new Error('CROSS_NAMESPACE_DEFAULT');
  for (const g of allGroups) {
    if ((g.ns || DEFAULT_NAMESPACE) === activeNs) {
      g.isDefault = (g.id === groupId);
    }
  }
  await chrome.storage.local.set({ groups: allGroups });
}

async function updateBoardOrder(boardOrder) {
  if (!Array.isArray(boardOrder) || boardOrder.length === 0) return;
  const [allGroups, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getActiveNamespace()
  ]);

  // 仅重排 active ns 的 group;其他 ns 的 group 追加到末尾(避免原代码在 filtered view 上写回导致丢数据)
  const activeGroupMap = new Map(
    allGroups
      .filter(g => (g.ns || DEFAULT_NAMESPACE) === activeNs)
      .map(g => [g.id, g])
  );
  const orderedActive = [];
  for (const groupId of boardOrder) {
    const g = activeGroupMap.get(groupId);
    if (g) {
      orderedActive.push(g);
      activeGroupMap.delete(groupId);
    }
  }
  for (const g of activeGroupMap.values()) {
    orderedActive.push(g);
  }

  const otherGroups = allGroups.filter(g => (g.ns || DEFAULT_NAMESPACE) !== activeNs);
  await chrome.storage.local.set({ groups: [...orderedActive, ...otherGroups] });
}

/**
 * 全量导入分组 + 标签(替换式)。
 * 安全兜底:每个 group 缺 ns 时补 DEFAULT_NAMESPACE,避免把跨 ns 数据误删后留下无主 group。
 * 调用方仍须自己承担「导入覆盖当前所有数据」的语义(spec §4.1.19 / review item 8)。
 */
async function importGroupsAndTabs(groups, tabs) {
  if (Array.isArray(groups)) {
    // 兜底:旧版导出文件里的 group 可能缺 ns;统一补 DEFAULT_NAMESPACE,
    // 避免导入后留下"无主"group(在 board / popup / goto 圆环都看不见)。
    for (const g of groups) {
      if (!g || typeof g.ns !== 'string' || g.ns.length === 0) {
        if (g) g.ns = DEFAULT_NAMESPACE;
      }
    }
  }
  await chrome.storage.local.set({ groups, tabs });
}

// ===================== Group 标记(flag) =====================
// goto / inFocusSearch / visible 都是 group 的属性,统一由这里操作

async function toggleGoto(groupId) {
  const [allGroups, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const target = allGroups.find(g => g.id === groupId);
  if (!target) throw new Error('Group not found');
  if ((target.ns || DEFAULT_NAMESPACE) !== activeNs) throw new Error('CROSS_NAMESPACE_GOTO');
  target.goto = !target.goto;
  await chrome.storage.local.set({ groups: allGroups });
  return target.goto;
}

async function setGroupFocusSearch(groupId, value) {
  const [allGroups, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const target = allGroups.find(g => g.id === groupId);
  if (!target) throw new Error('Group not found');
  if ((target.ns || DEFAULT_NAMESPACE) !== activeNs) throw new Error('CROSS_NAMESPACE_FOCUS');
  target.inFocusSearch = value === true;
  await chrome.storage.local.set({ groups: allGroups });
  return target.inFocusSearch;
}

async function setGroupsVisibility(visibleGroupIds) {
  const [allGroups, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const visibleSet = new Set(visibleGroupIds || []);
  // 任一 id 不在 active ns 时整批拒绝(spec §4.1.12 整批拒绝语义)
  for (const gid of visibleSet) {
    const target = allGroups.find(g => g.id === gid);
    if (target && (target.ns || DEFAULT_NAMESPACE) !== activeNs) {
      throw new Error('CROSS_NAMESPACE_VISIBILITY');
    }
  }
  for (const g of allGroups) {
    if ((g.ns || DEFAULT_NAMESPACE) === activeNs) {
      g.visible = visibleSet.has(g.id);
    }
  }
  await chrome.storage.local.set({ groups: allGroups });
}

// ===================== Tab 操作 =====================

/**
 * 添加标签到分组(已存在同 URL 则跳过)
 * @param {object} opts.maxTabs 上限(默认 100,History 分组用 200)
 * @param {object} opts.initVisitCount 是否初始化 visitCount/lastVisit(History 分组用)
 * @throws {Error('GROUP_NOT_FOUND')} 当 groupId 不存在
 * @throws {Error('CROSS_NAMESPACE_WRITE')} 当目标 group 不在 active ns
 */
async function addTabToGroup(tab, groupId, { maxTabs = DEFAULT_GROUP_MAX_TABS, initVisitCount = false } = {}) {
  if (!tab.url || tab.url === 'about:blank' || tab.url.trim() === '') return false;
  if (!tab.title || tab.title.trim() === '') return false;

  // ns 校验:目标 group 必须在 active ns(避免跨 ns 写入)
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const targetGroup = allGroups.find(g => g.id === groupId);
  if (!targetGroup) throw new Error('GROUP_NOT_FOUND');
  if ((targetGroup.ns || DEFAULT_NAMESPACE) !== activeNs) throw new Error('CROSS_NAMESPACE_WRITE');

  const tabsMap = allTabs;
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

// 从分组移除标签(精确 URL 匹配);跨 ns 抛 CROSS_NAMESPACE_WRITE
async function removeTabFromGroup(tab, groupId) {
  if (!tab || !tab.url) return false;

  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const targetGroup = allGroups.find(g => g.id === groupId);
  if (!targetGroup) return false; // group 不存在视为无操作
  if ((targetGroup.ns || DEFAULT_NAMESPACE) !== activeNs) throw new Error('CROSS_NAMESPACE_WRITE');

  const tabsMap = allTabs;
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

/**
 * 更新 tab 字段;跨 ns 抛 CROSS_NAMESPACE_WRITE。
 */
async function updateTab({ tabId, groupId, updates }) {
  if (!tabId || !groupId || !updates) throw new Error('缺少参数');

  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const targetGroup = allGroups.find(g => g.id === groupId);
  if (!targetGroup) throw new Error('GROUP_NOT_FOUND');
  if ((targetGroup.ns || DEFAULT_NAMESPACE) !== activeNs) throw new Error('CROSS_NAMESPACE_WRITE');

  const tabsMap = allTabs;
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

/**
 * 移动 tab。fromGroup 和 toGroup 必须属于同一 ns,且该 ns === active ns。
 * 跨 ns 移动抛 CROSS_NAMESPACE_MOVE(spec §4.1.8)。
 * 原 group 没找到时,在 active ns 内的其他 group 中查找(兜底,但限制在 active ns 内)。
 */
async function moveTab({ fromGroup, toGroup, tabId, afterTabId }) {
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);

  // 显式给出的 fromGroup / toGroup 都必须在 active ns
  if (fromGroup) {
    const fromG = allGroups.find(g => g.id === fromGroup);
    if (fromG && (fromG.ns || DEFAULT_NAMESPACE) !== activeNs) {
      throw new Error('CROSS_NAMESPACE_MOVE');
    }
  }
  const toG = allGroups.find(g => g.id === toGroup);
  if (toG && (toG.ns || DEFAULT_NAMESPACE) !== activeNs) {
    throw new Error('CROSS_NAMESPACE_MOVE');
  }

  const tabsMap = allTabs;

  let tabToMove = tabsMap[fromGroup]?.find(t => t.id === tabId);
  if (tabsMap[fromGroup]) {
    tabsMap[fromGroup] = tabsMap[fromGroup].filter(t => t.id !== tabId);
  }

  // 如果原分组没找到,在 active ns 内的其他 group 中查找(限制在 active ns)
  if (!tabToMove) {
    const activeGroupIds = new Set(
      allGroups.filter(g => (g.ns || DEFAULT_NAMESPACE) === activeNs).map(g => g.id)
    );
    for (const gid of Object.keys(tabsMap)) {
      if (!activeGroupIds.has(gid)) continue;
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

/**
 * 删除 tab;跨 ns 抛 CROSS_NAMESPACE_WRITE。
 */
async function deleteTab({ groupId, tabId }) {
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const targetGroup = allGroups.find(g => g.id === groupId);
  if (targetGroup && (targetGroup.ns || DEFAULT_NAMESPACE) !== activeNs) {
    throw new Error('CROSS_NAMESPACE_WRITE');
  }
  const tabsMap = allTabs;
  if (tabsMap[groupId]) {
    tabsMap[groupId] = tabsMap[groupId].filter(t => t.id !== tabId);
    await chrome.storage.local.set({ tabs: tabsMap });
  }
}

/**
 * 清空指定 group 的 tabs;跨 ns 抛 CROSS_NAMESPACE_WRITE。
 */
async function clearGroupTabs(groupId) {
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const targetGroup = allGroups.find(g => g.id === groupId);
  if (targetGroup && (targetGroup.ns || DEFAULT_NAMESPACE) !== activeNs) {
    throw new Error('CROSS_NAMESPACE_WRITE');
  }
  const tabsMap = allTabs;
  if (tabsMap[groupId]) {
    tabsMap[groupId] = [];
    await chrome.storage.local.set({ tabs: tabsMap });
  }
}

/**
 * 仅清空当前 active ns 内所有 group 的 tabs,其他 ns 的 tabs 不受影响。
 */
async function clearAllGroupTabs() {
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const activeGroupIds = new Set(
    allGroups.filter(g => (g.ns || DEFAULT_NAMESPACE) === activeNs).map(g => g.id)
  );
  const tabsMap = allTabs;
  for (const gid of Object.keys(tabsMap)) {
    if (activeGroupIds.has(gid)) {
      tabsMap[gid] = [];
    }
  }
  await chrome.storage.local.set({ tabs: tabsMap });
}

/**
 * 批量写入一组 tab 到指定分组(不做去重、不做上限检查)
 * 适用场景:timeline 快照提取为新分组(数据源已是用户标记的 tab)
 * 跨 ns 抛 CROSS_NAMESPACE_WRITE。
 */
async function seedGroupTabs(groupId, tabs) {
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const targetGroup = allGroups.find(g => g.id === groupId);
  if (targetGroup && (targetGroup.ns || DEFAULT_NAMESPACE) !== activeNs) {
    throw new Error('CROSS_NAMESPACE_WRITE');
  }
  const tabsMap = allTabs;
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

/**
 * 在 active ns 内的 group 中查找 url,命中的 tab 计数 +1。
 * 不同 ns 各自独立计数(同 URL 在 ns A 增 1,不影响 ns B 的 visitCount)。
 */
async function incrementVisitCount(url) {
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const activeGroupIds = new Set(
    allGroups.filter(g => (g.ns || DEFAULT_NAMESPACE) === activeNs).map(g => g.id)
  );
  const tabsMap = allTabs;
  const targetBase = getUrlBase(url);
  let found = false;

  for (const gid of Object.keys(tabsMap)) {
    if (!activeGroupIds.has(gid)) continue;
    for (const tab of tabsMap[gid]) {
      if (getUrlBase(tab.url) === targetBase) {
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

/**
 * 按 visitCount 倒序排 active ns 内所有 group 的 tabs,其他 ns 不动。
 */
async function sortAllTabsByVisitCount() {
  const [allGroups, allTabs, activeNs] = await Promise.all([
    getAllGroupsAcrossNamespaces(),
    getAllTabsMapAcrossNamespaces(),
    getActiveNamespace()
  ]);
  const activeGroupIds = new Set(
    allGroups.filter(g => (g.ns || DEFAULT_NAMESPACE) === activeNs).map(g => g.id)
  );
  const tabsMap = allTabs;
  for (const gid of Object.keys(tabsMap)) {
    if (activeGroupIds.has(gid)) {
      tabsMap[gid] = tabsMap[gid].sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
    }
  }
  await chrome.storage.local.set({ tabs: tabsMap });
}

// ===================== 初始化与迁移(供 init.js 调用) =====================

/**
 * group 域的默认数据初始化 + 老数据标记迁移 + ns 字段补全。
 * - 首装:建 3 个默认分组(全部 ns: 'default');若无 goto 分组,建"📄 面包"并 seed 6 个 tab
 *   (面包分组通过 createGroup 自动写入 ns: DEFAULT_NAMESPACE)。
 * - 迁移:settings.focusSearchGroups / settings.visibleGroups → group.inFocusSearch / group.visible,
 *   迁移完成后删除 settings 中的遗留 key;并把 group 缺 ns 的字段补为 'default'。
 */
async function ensureGroupDefaults() {
  const result = await chrome.storage.local.get(['groups', 'tabs', 'settings']);
  const settings = result.settings || {};

  // ── 首装:默认分组(全部 ns: 'default') ──
  let groups = result.groups;
  if (!groups) {
    groups = [
      { id: generateId(), name: '工作', color: DEFAULT_COLORS[0], isDefault: true, goto: false, inFocusSearch: false, visible: true, ns: DEFAULT_NAMESPACE },
      { id: generateId(), name: '学习', color: DEFAULT_COLORS[1], isDefault: false, goto: false, inFocusSearch: false, visible: true, ns: DEFAULT_NAMESPACE },
      { id: generateId(), name: '娱乐', color: DEFAULT_COLORS[2], isDefault: false, goto: false, inFocusSearch: false, visible: true, ns: DEFAULT_NAMESPACE }
    ];
    await chrome.storage.local.set({ groups });
  }
  if (!result.tabs) {
    await chrome.storage.local.set({ tabs: {} });
  }

  // ── 标记迁移:settings 遗留数组 → group 属性 + ns 字段补全 ──
  // 必须在 goto 圆环 seed 之前:否则 createGroup() 把 bread 分组写入 storage 后,
  // 本地 groups 数组是 stale 的,set({ groups }) 会覆盖掉刚 seed 的面包分组(把 bread 删除),
  // 但 seed 的 tabs 仍留在 tabs map 里成为孤儿(同时 goto 圆环缺失示例数据)。
  const legacyFocusIds = new Set(Array.isArray(settings.focusSearchGroups) ? settings.focusSearchGroups : []);
  // null = 从未设置过可见性 → 默认全部可见(与旧 view.js fallback 一致)
  const legacyVisibleIds = Array.isArray(settings.visibleGroups) ? new Set(settings.visibleGroups) : null;

  let groupsUpdated = false;
  for (const g of groups) {
    if (g.goto === undefined) { g.goto = false; groupsUpdated = true; }
    if (g.inFocusSearch === undefined) { g.inFocusSearch = legacyFocusIds.has(g.id); groupsUpdated = true; }
    if (g.visible === undefined) { g.visible = legacyVisibleIds ? legacyVisibleIds.has(g.id) : true; groupsUpdated = true; }
    // ns 字段迁移:老 group 缺 ns 时补 'default'
    if (g.ns === undefined) { g.ns = DEFAULT_NAMESPACE; groupsUpdated = true; }
  }
  if (groupsUpdated) {
    await chrome.storage.local.set({ groups });
  }

  // ── goto 圆环:若无 goto=true 分组,建"📄 面包"并 seed ──
  // (visible: false — 保持历史行为:seed 分组不在看板显示)
  // createGroup 自动写入 ns: activeNs,首次安装时 getActiveNamespace() 回退到 DEFAULT_NAMESPACE,
  // 所以面包分组自然获得 ns: 'default'。
  // 注意:必须在标记迁移之后调用 —— 迁移循环里的 set({ groups }) 会用本地数组覆盖 storage,
  // 如果它跑在 createGroup 之后,会丢失刚 seed 的面包分组。
  if (!groups.some(g => g.goto === true)) {
    const breadGroup = await createGroup({
      name: '📄 面包',
      color: '#f9ca24',
      goto: true,
      visible: false
    });
    const tabsMap = await getAllTabsMapAcrossNamespaces();
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

  // 迁移完成后清理 settings 遗留 key
  if ('focusSearchGroups' in settings || 'visibleGroups' in settings) {
    const cleaned = { ...settings };
    delete cleaned.focusSearchGroups;
    delete cleaned.visibleGroups;
    await chrome.storage.local.set({ settings: cleaned });
  }
}

export {
  // ns
  getActiveNamespace,
  setActiveNamespace,
  getAllGroupsAcrossNamespaces,
  getAllTabsMapAcrossNamespaces,
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