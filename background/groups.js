/**
 * 收藏分组模块
 * 处理分组的创建、删除、标签管理等功能
 */

import { generateId, showToast, getUrlBase } from './utils.js';

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

// 添加当前标签页到默认分组
async function addCurrentTabToDefaultGroup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // 跳过扩展页面和特殊页面
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
    showToast(tab.id, {
      type: 'info',
      title: '无法添加',
      message: '无法添加特殊页面',
      duration: 2000
    });
    return;
  }

  // 跳过空白页和无效 URL
  if (!tab.url || tab.url === 'about:blank' || tab.url.trim() === '') {
    showToast(tab.id, {
      type: 'info',
      title: '无法添加',
      message: '无法添加空白页',
      duration: 2000
    });
    return;
  }

  // 跳过空标题和无效标题
  if (!tab.title || tab.title.trim() === '') {
    showToast(tab.id, {
      type: 'info',
      title: '无法添加',
      message: '无法添加无效页面',
      duration: 2000
    });
    return;
  }

  const defaultGroupId = await getDefaultGroupId();
  if (!defaultGroupId) {
    showToast(tab.id, {
      type: 'error',
      title: '添加失败',
      message: '没有找到目标分组',
      duration: 2000
    });
    return;
  }

  // 获取分组名称用于显示
  const groupsResult = await chrome.storage.local.get(['groups']);
  const groups = groupsResult.groups || [];
  const targetGroup = groups.find(g => g.id === defaultGroupId);
  const groupName = targetGroup?.name || '目标分组';

  const added = await addTabToGroup(tab, defaultGroupId);

  if (added) {
    showToast(tab.id, {
      type: 'success',
      title: '已添加',
      message: `已保存到「${groupName}」`,
      duration: 2000,
      showOpenButton: true
    });
  } else {
    showToast(tab.id, {
      type: 'info',
      title: '标签已存在',
      message: `该标签已在「${groupName}」中`,
      duration: 2000
    });
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

// 导出函数供外部使用
export {
  addCurrentTabToDefaultGroup,
  addTabToGroup,
  getDefaultGroupId,
  openTabboard
};

// 消息处理器
export function handleGroupsMessage(request, sender, sendResponse) {
  (async () => {
    try {
      switch (request.action) {
        case 'getGroups': {
          const result = await chrome.storage.local.get(['groups']);
          sendResponse({ success: true, groups: result.groups || [] });
          break;
        }

        case 'clearAllGroups': {
          const clearResult = await chrome.storage.local.get(['tabs']);
          const clearedTabs = clearResult.tabs || {};
          // 清空所有分组的标签
          for (const groupId in clearedTabs) {
            clearedTabs[groupId] = [];
          }
          await chrome.storage.local.set({ tabs: clearedTabs });
          sendResponse({ success: true });
          break;
        }

        case 'importGroupsAndTabs': {
          // 导入分组和标签数据（替换现有数据）
          await chrome.storage.local.set({
            groups: request.groups,
            tabs: request.tabs
          });
          sendResponse({ success: true });
          break;
        }

        case 'addTab': {
          const defaultId = await getDefaultGroupId();
          await addTabToGroup(request.tab, request.groupId || defaultId);
          sendResponse({ success: true });
          break;
        }

        case 'moveTab': {
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
        }

        case 'updateBoardOrder': {
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
        }

        case 'deleteTab': {
          const deleteResult = await chrome.storage.local.get(['tabs']);
          const deleteTabs = deleteResult.tabs || {};
          if (deleteTabs[request.groupId]) {
            deleteTabs[request.groupId] = deleteTabs[request.groupId].filter(t => t.id !== request.tabId);
            await chrome.storage.local.set({ tabs: deleteTabs });
          }
          sendResponse({ success: true });
          break;
        }

        case 'addGroup': {
          const addGroupResult = await chrome.storage.local.get(['groups', 'settings']);
          const addGroups = addGroupResult.groups || [];
          const addSettings = addGroupResult.settings || {};
          const { DEFAULT_COLORS } = await import('./utils.js');

          const addedGroup = {
            id: generateId(),
            name: request.name,
            color: request.color,
            isDefault: false
          };

          addGroups.push(addedGroup);

          // 确保新分组默认可见
          if (!addSettings.visibleGroups) {
            addSettings.visibleGroups = addGroups.map(g => g.id);
          } else {
            addSettings.visibleGroups.push(addedGroup.id);
          }

          await chrome.storage.local.set({ groups: addGroups, settings: addSettings });
          sendResponse({ success: true });
          break;
        }

        case 'deleteGroup': {
          const delGroupResult = await chrome.storage.local.get(['groups', 'tabs']);
          const delGroups = delGroupResult.groups || [];
          const delTabs = delGroupResult.tabs || {};

          // 删除分组和对应的标签
          const newGroups = delGroups.filter(g => g.id !== request.groupId);
          delete delTabs[request.groupId];

          await chrome.storage.local.set({ groups: newGroups, tabs: delTabs });
          sendResponse({ success: true });
          break;
        }

        case 'setDefaultGroup': {
          const setDefaultResult = await chrome.storage.local.get(['groups']);
          const setDefaultGroups = setDefaultResult.groups || [];
          setDefaultGroups.forEach(g => g.isDefault = (g.id === request.groupId));
          await chrome.storage.local.set({ groups: setDefaultGroups });
          sendResponse({ success: true });
          break;
        }

        case 'openTab': {
          await chrome.tabs.create({ url: request.url });
          sendResponse({ success: true });
          break;
        }

        case 'openGroup': {
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
        }

        case 'updateGroupName': {
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
        }

        case 'openTabboard': {
          await openTabboard();
          sendResponse({ success: true });
          break;
        }

        case 'incrementVisitCount': {
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
        }

        default:
          return false; // 未处理的消息
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // 异步响应
}
