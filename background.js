/**
 * TabBoard Background Service Worker
 * 处理快捷键、标签页收集和分组管理
 */

// 默认分组颜色
const DEFAULT_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7',
  '#a29bfe', '#fd79a8', '#00b894', '#e17055', '#74b9ff'
];

// 生成唯一ID
function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// 初始化默认数据
async function initializeDefaultData() {
  const result = await chrome.storage.local.get(['groups', 'tabs', 'timelineSnapshots', 'settings']);

  if (!result.groups) {
    const defaultGroups = [
      { id: generateId(), name: '工作', color: DEFAULT_COLORS[0], isDefault: true },
      { id: generateId(), name: '学习', color: DEFAULT_COLORS[1], isDefault: false },
      { id: generateId(), name: '娱乐', color: DEFAULT_COLORS[2], isDefault: false }
    ];
    await chrome.storage.local.set({ groups: defaultGroups });
  }

  if (!result.tabs) {
    await chrome.storage.local.set({ tabs: {} });
  }

  // Timeline 存储 - 快照列表
  if (!result.timelineSnapshots) {
    await chrome.storage.local.set({ timelineSnapshots: [] });
  }

  if (!result.settings) {
    await chrome.storage.local.set({
      settings: {
        closeAfterCollect: false,
        closeAfterRestore: false,
        excludeEdgeUrls: false,
        lastView: 'timeline'
      }
    });
  } else if (result.settings.lastView === undefined) {
    // 为已有设置添加 lastView 字段
    await chrome.storage.local.set({
      settings: {
        ...result.settings,
        lastView: 'timeline'
      }
    });
  }
}

// 获取默认分组ID
async function getDefaultGroupId() {
  const result = await chrome.storage.local.get(['groups']);
  const defaultGroup = result.groups?.find(g => g.isDefault);
  return defaultGroup?.id || result.groups?.[0]?.id;
}

// 添加标签页到分组
async function addTabToGroup(tab, groupId) {
  // 过滤无效标签
  if (!tab.url || tab.url === 'about:blank' || tab.url.trim() === '') {
    return false;
  }
  if (!tab.title || tab.title.trim() === '') {
    return false;
  }

  const result = await chrome.storage.local.get(['tabs']);
  const tabs = result.tabs || {};

  if (!tabs[groupId]) {
    tabs[groupId] = [];
  }

  // 检查是否已存在
  const exists = tabs[groupId].some(t => t.url === tab.url);
  if (!exists) {
    tabs[groupId].unshift({
      id: generateId(),
      title: tab.title,
      url: tab.url,
      favicon: tab.favIconUrl || '',
      timestamp: new Date().toISOString()
    });

    // 限制每个分组最多100个标签
    if (tabs[groupId].length > 100) {
      tabs[groupId] = tabs[groupId].slice(0, 100);
    }

    await chrome.storage.local.set({ tabs });
    return true;
  }
  return false;
}

// 获取当前标签页并添加到默认分组
async function addCurrentTabToDefaultGroup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // 跳过扩展页面和特殊页面
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showToast',
      type: 'info',
      title: '无法添加',
      message: '无法添加特殊页面',
      duration: 2000
    }).catch(() => {});
    return;
  }

  // 跳过空白页和无效 URL
  if (!tab.url || tab.url === 'about:blank' || tab.url.trim() === '') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showToast',
      type: 'info',
      title: '无法添加',
      message: '无法添加空白页',
      duration: 2000
    }).catch(() => {});
    return;
  }

  // 跳过空标题和无效标题
  if (!tab.title || tab.title.trim() === '') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showToast',
      type: 'info',
      title: '无法添加',
      message: '无法添加无效页面',
      duration: 2000
    }).catch(() => {});
    return;
  }

  const defaultGroupId = await getDefaultGroupId();
  if (!defaultGroupId) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showToast',
      type: 'error',
      title: '添加失败',
      message: '没有找到目标分组',
      duration: 2000
    }).catch(() => {});
    return;
  }

  // 获取分组名称用于显示
  const groupsResult = await chrome.storage.local.get(['groups']);
  const groups = groupsResult.groups || [];
  const targetGroup = groups.find(g => g.id === defaultGroupId);
  const groupName = targetGroup?.name || '目标分组';

  const added = await addTabToGroup(tab, defaultGroupId);

  if (added) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showToast',
      type: 'success',
      title: '已添加',
      message: `已保存到「${groupName}」`,
      duration: 2000,
      showOpenButton: true
    }).catch(() => {});
  } else {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showToast',
      type: 'info',
      title: '标签已存在',
      message: `该标签已在「${groupName}」中`,
      duration: 2000
    }).catch(() => {});
  }
}

// 收集当前窗口所有标签页到 Timeline（创建快照）
async function collectCurrentWindowTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const settings = await chrome.storage.local.get(['settings']);
  const closeAfterCollect = settings.settings?.closeAfterCollect || false;
  const excludeEdgeUrls = settings.settings?.excludeEdgeUrls || false;

  const result = await chrome.storage.local.get(['timelineSnapshots']);
  const timelineSnapshots = result.timelineSnapshots || [];

  // 收集所有有效标签页
  const collectedTabs = [];
  for (const tab of tabs) {
    // 跳过扩展页面和特殊页面
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      continue;
    }

    // 可选：跳过 edge:// 页面
    if (excludeEdgeUrls && tab.url.startsWith('edge://')) {
      continue;
    }

    // 跳过空白页和无效 URL
    if (!tab.url || tab.url === 'about:blank' || tab.url.trim() === '') {
      continue;
    }

    // 跳过空标题和无效标题
    if (!tab.title || tab.title.trim() === '') {
      continue;
    }

    collectedTabs.push({
      id: generateId(),
      title: tab.title,
      url: tab.url,
      favicon: tab.favIconUrl || ''
    });
  }

  // 如果没有收集到任何标签，不创建快照
  if (collectedTabs.length === 0) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab.id, {
        action: 'showToast',
        type: 'info',
        title: '没有可收集的标签',
        message: '当前窗口没有可收集的标签页',
        duration: 2000
      }).catch(() => {});
    }
    return;
  }

  // 创建新快照
  const newSnapshot = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    tabs: collectedTabs
  };

  // 添加到快照列表开头
  timelineSnapshots.unshift(newSnapshot);

  // 限制最多 50 个快照（删除最旧的，即数组末尾的）
  if (timelineSnapshots.length > 50) {
    timelineSnapshots.splice(50);  // 删除索引 50 及之后的所有元素
  }

  await chrome.storage.local.set({ timelineSnapshots });

  // 如果设置为收集后关闭
  if (closeAfterCollect) {
    const tabsToClose = await chrome.tabs.query({ currentWindow: true });
    for (const tab of tabsToClose) {
      if (!tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        await chrome.tabs.remove(tab.id);
      }
    }
  }

  // 获取当前活动标签页用于显示提示
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 显示提示
  if (activeTab) {
    chrome.tabs.sendMessage(activeTab.id, {
      action: 'showToast',
      type: 'success',
      title: '收集完成',
      message: `已收集 ${collectedTabs.length} 个标签页`,
      duration: 2000,
      showOpenButton: true
    }).catch(() => {});
  }
}

// 打开标签页管理看板
async function openTabboard() {
  // 检查是否已经打开了看板
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find(tab => tab.url?.includes('modules/tabboard/tabboard.html'));

  if (existingTab) {
    // 如果已存在，激活它并确保固定
    await chrome.tabs.update(existingTab.id, { active: true });
    if (!existingTab.pinned) {
      await chrome.tabs.update(existingTab.id, { pinned: true });
    }
  } else {
    // 创建新的固定标签页
    await chrome.tabs.create({
      url: chrome.runtime.getURL('modules/tabboard/tabboard.html'),
      pinned: true
    });
  }
}

// 收集并打开看板
async function collectAndOpenTabboard() {
  // 先收集当前窗口所有标签
  await collectCurrentWindowTabs();
  // 然后打开看板
  await openTabboard();
}

// 快捷键命令处理
chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case 'add-current-tab':
      addCurrentTabToDefaultGroup();
      break;
    case 'collect-all-tabs':
      collectCurrentWindowTabs();
      break;
    case 'open-tabboard':
      openTabboard();
      break;
    default:
      console.warn('Unknown command:', command);
  }
});

// 消息处理（用于 popup 和 tabboard 通信）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getGroups':
          const result = await chrome.storage.local.get(['groups']);
          sendResponse({ success: true, groups: result.groups || [] });
          break;

        case 'getTimelineTabs':
          const timelineResult = await chrome.storage.local.get(['timelineSnapshots']);
          sendResponse({ success: true, snapshots: timelineResult.timelineSnapshots || [] });
          break;

        case 'deleteTimelineSnapshot':
          const deleteSnapshotResult = await chrome.storage.local.get(['timelineSnapshots']);
          const snapshots = deleteSnapshotResult.timelineSnapshots || [];
          const newSnapshots = snapshots.filter(s => s.id !== request.snapshotId);
          await chrome.storage.local.set({ timelineSnapshots: newSnapshots });
          sendResponse({ success: true });
          break;

        case 'restoreSnapshot':
          const restoreResult = await chrome.storage.local.get(['timelineSnapshots']);
          const allSnapshots = restoreResult.timelineSnapshots || [];
          const snapshot = allSnapshots.find(s => s.id === request.snapshotId);
          if (snapshot) {
            for (const tab of snapshot.tabs) {
              await chrome.tabs.create({ url: tab.url });
            }
          }
          sendResponse({ success: true });
          break;

        case 'importTimelineSnapshots':
          const importResult = await chrome.storage.local.get(['timelineSnapshots']);
          const existingSnapshots = importResult.timelineSnapshots || [];
          // 合并导入的快照到现有快照中（去重）
          const existingIds = new Set(existingSnapshots.map(s => s.id));
          const snapshotsToAdd = request.snapshots.filter(s => !existingIds.has(s.id));
          // 现有快照在前，新导入的在后，这样超过50个时截断的是新快照而非现有快照
          const mergedSnapshots = [...existingSnapshots, ...snapshotsToAdd];
          // 限制最多 50 个快照（删除最旧的，即数组末尾的）
          if (mergedSnapshots.length > 50) {
            mergedSnapshots.splice(50);  // 删除索引 50 及之后的所有元素
          }
          await chrome.storage.local.set({ timelineSnapshots: mergedSnapshots });
          sendResponse({ success: true, imported: snapshotsToAdd.length, total: mergedSnapshots.length });
          break;

        case 'clearAllGroups':
          const clearResult = await chrome.storage.local.get(['tabs']);
          const clearedTabs = clearResult.tabs || {};
          // 清空所有分组的标签
          for (const groupId in clearedTabs) {
            clearedTabs[groupId] = [];
          }
          await chrome.storage.local.set({ tabs: clearedTabs });
          sendResponse({ success: true });
          break;

        case 'importGroupsAndTabs':
          // 导入分组和标签数据（替换现有数据）
          await chrome.storage.local.set({
            groups: request.groups,
            tabs: request.tabs
          });
          sendResponse({ success: true });
          break;

        case 'addTab':
          const defaultId = await getDefaultGroupId();
          await addTabToGroup(request.tab, request.groupId || defaultId);
          sendResponse({ success: true });
          break;

        case 'moveTab':
          const moveResult = await chrome.storage.local.get(['tabs']);
          const tabsData = moveResult.tabs || {};
          const { fromGroup, toGroup, tabId } = request;

          // 从原分组移除
          tabsData[fromGroup] = tabsData[fromGroup]?.filter(t => t.id !== tabId) || [];

          // 添加到新分组
          const tabToMove = tabsData[fromGroup]?.find(t => t.id === tabId) ||
                            Object.values(tabsData).flat().find(t => t.id === tabId);

          if (tabToMove) {
            if (!tabsData[toGroup]) tabsData[toGroup] = [];
            tabsData[toGroup].push(tabToMove);

            // 从所有分组中清理旧数据
            for (const gid in tabsData) {
              if (gid !== toGroup) {
                tabsData[gid] = tabsData[gid].filter(t => t.id !== tabId);
              }
            }

            await chrome.storage.local.set({ tabs: tabsData });
          }
          sendResponse({ success: true });
          break;

        case 'deleteTab':
          const deleteResult = await chrome.storage.local.get(['tabs']);
          const deleteTabs = deleteResult.tabs || {};
          if (deleteTabs[request.groupId]) {
            deleteTabs[request.groupId] = deleteTabs[request.groupId].filter(t => t.id !== request.tabId);
            await chrome.storage.local.set({ tabs: deleteTabs });
          }
          sendResponse({ success: true });
          break;

        case 'addGroup':
          const addGroupResult = await chrome.storage.local.get(['groups']);
          const groups = addGroupResult.groups || [];
          groups.push({
            id: generateId(),
            name: request.name,
            color: request.color,
            isDefault: false
          });
          await chrome.storage.local.set({ groups });
          sendResponse({ success: true });
          break;

        case 'deleteGroup':
          const delGroupResult = await chrome.storage.local.get(['groups', 'tabs']);
          const delGroups = delGroupResult.groups || [];
          const delTabs = delGroupResult.tabs || {};

          // 删除分组和对应的标签
          const newGroups = delGroups.filter(g => g.id !== request.groupId);
          delete delTabs[request.groupId];

          await chrome.storage.local.set({ groups: newGroups, tabs: delTabs });
          sendResponse({ success: true });
          break;

        case 'setDefaultGroup':
          const setDefaultResult = await chrome.storage.local.get(['groups']);
          const setDefaultGroups = setDefaultResult.groups || [];
          setDefaultGroups.forEach(g => g.isDefault = (g.id === request.groupId));
          await chrome.storage.local.set({ groups: setDefaultGroups });
          sendResponse({ success: true });
          break;

        case 'openTab':
          await chrome.tabs.create({ url: request.url });
          sendResponse({ success: true });
          break;

        case 'openGroup':
          const openGroupResult = await chrome.storage.local.get(['tabs', 'settings']);
          const openTabs = openGroupResult.tabs || {};
          const settings = openGroupResult.settings || {};
          const groupTabs = openTabs[request.groupId] || [];

          for (const tab of groupTabs) {
            await chrome.tabs.create({ url: tab.url });
          }

          // 如果设置为打开后删除
          if (settings.closeAfterRestore) {
            openTabs[request.groupId] = [];
            await chrome.storage.local.set({ tabs: openTabs });
          }

          sendResponse({ success: true });
          break;

        case 'getSettings':
          const settingsResult = await chrome.storage.local.get(['settings']);
          sendResponse({ success: true, settings: settingsResult.settings || {} });
          break;

        case 'updateSettings':
          const currentSettings = await chrome.storage.local.get(['settings']);
          const newSettings = { ...currentSettings.settings, ...request.settings };
          await chrome.storage.local.set({ settings: newSettings });
          sendResponse({ success: true });
          break;

        case 'openTabboard':
          await openTabboard();
          sendResponse({ success: true });
          break;

        case 'collectAndOpenTabboard':
          await collectAndOpenTabboard();
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // 异步响应
});

// 初始化
initializeDefaultData();
console.log('[TabBoard] Background Service Worker 已启动');
