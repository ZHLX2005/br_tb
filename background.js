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

// 获取 URL 基础部分（忽略查询参数和 hash）
function getUrlBase(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.origin + urlObj.pathname;
  } catch {
    return url;
  }
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

  // 初始化录制状态
  if (!result.recordingState) {
    await chrome.storage.local.set({
      recordingState: {
        isRecording: false,
        groupId: null,
        groupName: '',
        startTime: null,
        tabCount: 0
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

// 监听标签页创建事件（用于录制模式）
chrome.tabs.onCreated.addListener(async (tab) => {
  const result = await chrome.storage.local.get(['recordingState']);
  const recordingState = result.recordingState || {};

  if (!recordingState.isRecording || !recordingState.groupId) {
    return;
  }

  // 跳过特殊页面
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url === 'about:blank') {
    return;
  }

  // 等待标签页完全加载
  if (tab.status === 'loading') {
    await new Promise(resolve => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // 超时保护
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 5000);
    });

    // 重新获取标签页信息
    const updatedTab = await chrome.tabs.get(tab.id);
    tab.url = updatedTab.url;
    tab.title = updatedTab.title;
    tab.favIconUrl = updatedTab.favIconUrl;
  }

  // 检查标签页是否有效
  if (!tab.url || !tab.title || tab.url === 'about:blank') {
    return;
  }

  // 添加到录制分组
  const added = await addTabToGroup(tab, recordingState.groupId);

  if (added) {
    // 更新录制状态中的标签计数
    const updatedResult = await chrome.storage.local.get(['recordingState']);
    const updatedState = updatedResult.recordingState || {};
    updatedState.tabCount = (updatedState.tabCount || 0) + 1;
    await chrome.storage.local.set({ recordingState: updatedState });

    console.log('[TabBoard] 录制模式下自动捕获标签页:', tab.title);
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
          const { fromGroup, toGroup, tabId, afterTabId } = request;

          // 从原分组移除并找到要移动的标签
          let tabToMove = tabsData[fromGroup]?.find(t => t.id === tabId);
          if (tabsData[fromGroup]) {
            tabsData[fromGroup] = tabsData[fromGroup].filter(t => t.id !== tabId);
          }

          // 如果原分组没找到，从所有分组中查找
          if (!tabToMove) {
            for (const gid in tabsData) {
              const found = tabsData[gid].find(t => t.id === tabId);
              if (found) {
                tabToMove = found;
                tabsData[gid] = tabsData[gid].filter(t => t.id !== tabId);
                break;
              }
            }
          }

          if (tabToMove) {
            if (!tabsData[toGroup]) tabsData[toGroup] = [];

            // 根据 afterTabId 确定插入位置
            if (afterTabId) {
              const afterIndex = tabsData[toGroup].findIndex(t => t.id === afterTabId);
              if (afterIndex !== -1) {
                // 插入到 afterTabId 之后
                tabsData[toGroup].splice(afterIndex + 1, 0, tabToMove);
              } else {
                // 没找到 afterTabId，添加到末尾
                tabsData[toGroup].push(tabToMove);
              }
            } else {
              // 没有指定 afterTabId，添加到开头
              tabsData[toGroup].unshift(tabToMove);
            }

            await chrome.storage.local.set({ tabs: tabsData });
          }
          sendResponse({ success: true });
          break;

        case 'updateBoardOrder':
          const boardResult = await chrome.storage.local.get(['groups']);
          const allGroups = boardResult.groups || [];
          const { boardOrder } = request;

          // 根据 boardOrder 重新排列 groups 数组
          if (Array.isArray(boardOrder) && boardOrder.length > 0) {
            const orderedGroups = [];
            const groupMap = new Map(allGroups.map(g => [g.id, g]));

            // 按照指定顺序添加分组
            for (const groupId of boardOrder) {
              if (groupMap.has(groupId)) {
                orderedGroups.push(groupMap.get(groupId));
                groupMap.delete(groupId);
              }
            }

            // 添加任何未在 boardOrder 中的分组（新创建的等）
            for (const group of groupMap.values()) {
              orderedGroups.push(group);
            }

            await chrome.storage.local.set({ groups: orderedGroups });
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

        case 'updateGroupName':
          // 更新分组名称
          const nameUpdateResult = await chrome.storage.local.get(['groups']);
          const groupsForUpdate = nameUpdateResult.groups || [];
          const targetGroup = groupsForUpdate.find(g => g.id === request.groupId);

          if (targetGroup) {
            targetGroup.name = request.newName;
            await chrome.storage.local.set({ groups: groupsForUpdate });
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Group not found' });
          }
          break;

        case 'openTabboard':
          await openTabboard();
          sendResponse({ success: true });
          break;

        case 'collectAndOpenTabboard':
          await collectAndOpenTabboard();
          sendResponse({ success: true });
          break;

        case 'incrementVisitCount':
          // 增加标签页的访问次数
          const visitResult = await chrome.storage.local.get(['tabs']);
          const allTabs = visitResult.tabs || {};
          let found = false;

          // 遍历所有分组，查找匹配的 URL
          for (const groupId in allTabs) {
            const groupTabs = allTabs[groupId];
            for (const tab of groupTabs) {
              // 使用 URL 基础部分进行匹配（忽略查询参数和 hash）
              const tabUrlBase = getUrlBase(tab.url);
              const requestUrlBase = getUrlBase(request.url);

              if (tabUrlBase === requestUrlBase) {
                // 增加访问次数
                if (!tab.visitCount) {
                  tab.visitCount = 0;
                }
                tab.visitCount += 1;
                tab.lastVisit = new Date().toISOString();
                found = true;
                break;
              }
            }
            if (found) break;
          }

          // 如果找到匹配的标签，保存更新
          if (found) {
            await chrome.storage.local.set({ tabs: allTabs });
          }

          sendResponse({ success: true, found });
          break;

        case 'toggleTabMark':
          // 切换快照中标签的红色标记状态
          console.log('[Background] toggleTabMark request:', request);
          const markResult = await chrome.storage.local.get(['timelineSnapshots']);
          const markSnapshots = markResult.timelineSnapshots || [];
          const { snapshotId, tabUrl, marked } = request;

          // 找到对应的快照
          const targetSnapshot = markSnapshots.find(s => s.id === snapshotId);
          console.log('[Background] Found snapshot:', targetSnapshot ? 'Yes' : 'No');

          if (targetSnapshot) {
            // 找到对应的标签
            const targetTab = targetSnapshot.tabs.find(t => t.url === tabUrl);
            console.log('[Background] Found tab:', targetTab ? 'Yes' : 'No', 'Searching for URL:', tabUrl);

            if (targetTab) {
              targetTab.marked = marked;
              console.log('[Background] Setting marked to:', marked, 'for tab:', targetTab.title);
              await chrome.storage.local.set({ timelineSnapshots: markSnapshots });
              sendResponse({ success: true, marked: targetTab.marked });
              console.log('[Background] Mark toggled successfully');
            } else {
              console.error('[Background] Tab not found. Available tabs:', targetSnapshot.tabs.map(t => t.url));
              sendResponse({ success: false, error: 'Tab not found' });
            }
          } else {
            console.error('[Background] Snapshot not found. Available snapshots:', markSnapshots.map(s => s.id));
            sendResponse({ success: false, error: 'Snapshot not found' });
          }
          break;

        case 'extractMarkedAsGroup':
          // 将标记为重要的标签提取为新分组，并清空所有快照
          console.log('[Background] extractMarkedAsGroup request:', request);
          const extractResult = await chrome.storage.local.get(['groups', 'tabs']);
          const existingGroups = extractResult.groups || [];
          const existingTabs = extractResult.tabs || {};
          const { markedTabs } = request;

          // 生成新分组的颜色（使用默认颜色）
          const newColor = DEFAULT_COLORS[existingGroups.length % DEFAULT_COLORS.length];
          const newGroupId = generateId();

          // 创建新分组
          const newGroup = {
            id: newGroupId,
            name: `重要标签 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
            color: newColor,
            isDefault: false
          };

          existingGroups.push(newGroup);
          existingTabs[newGroupId] = markedTabs.map(tab => ({
            id: generateId(),
            title: tab.title,
            url: tab.url,
            favicon: tab.favicon,
            timestamp: new Date().toISOString()
          }));

          // 清空所有快照
          await chrome.storage.local.set({
            groups: existingGroups,
            tabs: existingTabs,
            timelineSnapshots: []
          });

          console.log('[Background] Extracted marked tabs to group:', newGroup.name);
          sendResponse({ success: true, groupName: newGroup.name });
          break;

        case 'getRecordingState':
          const recordingStateResult = await chrome.storage.local.get(['recordingState']);
          sendResponse({ success: true, recordingState: recordingStateResult.recordingState || { isRecording: false } });
          break;

        case 'startRecording':
          const startRecResult = await chrome.storage.local.get(['groups', 'tabs', 'recordingState']);
          const startRecGroups = startRecResult.groups || [];
          const startRecTabs = startRecResult.tabs || {};

          // 创建新的录制分组
          const recColor = DEFAULT_COLORS[startRecGroups.length % DEFAULT_COLORS.length];
          const recGroupId = generateId();
          const recGroupName = request.groupName || `录制 ${new Date().toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

          const recGroup = {
            id: recGroupId,
            name: recGroupName,
            color: recColor,
            isDefault: false
          };

          startRecGroups.push(recGroup);
          startRecTabs[recGroupId] = [];

          const newRecordingState = {
            isRecording: true,
            groupId: recGroupId,
            groupName: recGroupName,
            startTime: new Date().toISOString(),
            tabCount: 0
          };

          await chrome.storage.local.set({
            groups: startRecGroups,
            tabs: startRecTabs,
            recordingState: newRecordingState
          });

          // 更新徽章显示
          chrome.action.setBadgeText({ text: 'REC' });
          chrome.action.setBadgeBackgroundColor({ color: '#ef5350' });

          sendResponse({ success: true, recordingState: newRecordingState });
          break;

        case 'stopRecording':
          const stopRecResult = await chrome.storage.local.get(['recordingState']);
          const currentRecordingState = stopRecResult.recordingState || {};
          const tabCount = currentRecordingState.tabCount || 0;

          const stoppedRecordingState = {
            isRecording: false,
            groupId: null,
            groupName: '',
            startTime: null,
            tabCount: 0
          };

          await chrome.storage.local.set({
            recordingState: stoppedRecordingState
          });

          // 清除徽章
          chrome.action.setBadgeText({ text: '' });

          sendResponse({ success: true, recordingState: stoppedRecordingState, tabCount });
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
