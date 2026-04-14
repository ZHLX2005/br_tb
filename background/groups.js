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

// ========== History 分组管理 ==========

const HISTORY_GROUP_NAME = 'History';
const HISTORY_GROUP_COLOR = '#9e9e9e'; // 灰色

/**
 * 获取或创建 History 分组
 */
async function getOrCreateHistoryGroup() {
  const result = await chrome.storage.local.get(['groups']);
  const groups = result.groups || [];
  let historyGroup = groups.find(g => g.name === HISTORY_GROUP_NAME);

  if (!historyGroup) {
    historyGroup = {
      id: generateId(),
      name: HISTORY_GROUP_NAME,
      color: HISTORY_GROUP_COLOR,
      isDefault: false
    };
    groups.push(historyGroup);
    await chrome.storage.local.set({ groups });
  }
  return historyGroup;
}

/**
 * 添加标签到 History 分组
 */
async function addToHistoryGroup(tabInfo) {
  const { title, url, favicon } = tabInfo;
  if (!url || !title) return false;

  // 过滤无效 URL
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    return false;
  }

  const historyGroup = await getOrCreateHistoryGroup();
  const result = await chrome.storage.local.get(['tabs']);
  const tabs = result.tabs || {};

  if (!tabs[historyGroup.id]) {
    tabs[historyGroup.id] = [];
  }

  // 检查是否已存在（按 URL 去重）
  const exists = tabs[historyGroup.id].some(t => t.url === url);
  if (!exists) {
    tabs[historyGroup.id].unshift({
      id: generateId(),
      title: title,
      url: url,
      favicon: favicon || '',
      timestamp: new Date().toISOString(),
      visitCount: 1,
      lastVisit: new Date().toISOString()
    });

    // 限制 History 分组最多 200 条
    if (tabs[historyGroup.id].length > 200) {
      tabs[historyGroup.id] = tabs[historyGroup.id].slice(0, 200);
    }

    await chrome.storage.local.set({ tabs });
    return true;
  }
  return false;
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
  openTabboard,
  setupGroupsListeners,
  getOrCreateHistoryGroup,
  addToHistoryGroup
};

// 元素拾取器消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TABBOARD_PICK_RESULT') {
    // 获取当前标签页信息
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url) return;

      const url = new URL(tab.url).origin + new URL(tab.url).pathname;

      chrome.storage.local.get(['formData']).then((result) => {
        const formData = result.formData || {};

        if (!formData[url]) {
          formData[url] = {
            fields: [],
            checkboxes: [],
            standaloneInputs: [],
            pickedElements: [],
            timestamp: new Date().toISOString(),
            pageTitle: tab.title,
            fullUrl: tab.url
          };
        }

        if (!formData[url].pickedElements) {
          formData[url].pickedElements = [];
        }

        formData[url].pickedElements.push({
          tagName: message.data.tagName,
          id: message.data.id,
          name: message.data.name,
          value: message.data.value,
          text: message.data.text,
          placeholder: message.data.placeholder,
          href: message.data.href,
          timestamp: message.data.timestamp
        });

        chrome.storage.local.set({ formData });
      });
    });
  } else if (message.type === 'PICK_CANCEL') {
    // 取消拾取，无需特殊处理
  }
});

// 设置分组相关的消息监听器
function setupGroupsListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

          // 确保新分组默认可见 - 始终保持 visibleGroups 包含所有分组
          addSettings.visibleGroups = addGroups.map(g => g.id);

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

        case 'sortTabsByVisitCount': {
          // 按点击次数对所有分组的标签进行排序并保存到存储
          const sortResult = await chrome.storage.local.get(['tabs']);
          const allTabs = sortResult.tabs || {};

          // 遍历所有分组，对标签按 visitCount 降序排序
          for (const groupId in allTabs) {
            allTabs[groupId] = allTabs[groupId].sort((a, b) => {
              const visitCountA = a.visitCount || 0;
              const visitCountB = b.visitCount || 0;
              return visitCountB - visitCountA; // 降序排列
            });
          }

          // 保存排序后的数据
          await chrome.storage.local.set({ tabs: allTabs });
          sendResponse({ success: true });
          break;
        }

        case 'getAllData': {
          // 获取所有数据（分组和标签）- 侧边栏使用
          const allDataResult = await chrome.storage.local.get(['groups', 'tabs']);
          sendResponse({
            success: true,
            groups: allDataResult.groups || [],
            tabs: allDataResult.tabs || {}
          });
          break;
        }

        case 'addToHistoryGroup': {
          const { tabInfo } = request;
          if (tabInfo) {
            await addToHistoryGroup(tabInfo);
          }
          sendResponse({ success: true });
          break;
        }

        case 'getAllOpenTabs': {
          const tabs = await chrome.tabs.query({});
          const filteredTabs = tabs.filter(t =>
            t.url &&
            !t.url.startsWith('chrome://') &&
            !t.url.startsWith('chrome-extension://') &&
            !t.url.startsWith('about:') &&
            !t.url.startsWith('edge://')
          );
          sendResponse({
            success: true,
            tabs: filteredTabs.map(t => ({
              id: t.id,
              title: t.title || '无标题',
              url: t.url || '',
              favicon: t.favIconUrl || '',
              windowId: t.windowId,
              active: t.active
            }))
          });
          break;
        }

        case 'clearGroup': {
          // 清空指定分组 - 侧边栏使用
          const clearGroupResult = await chrome.storage.local.get(['tabs']);
          const clearGroupTabs = clearGroupResult.tabs || {};
          if (clearGroupTabs[request.groupId]) {
            clearGroupTabs[request.groupId] = [];
            await chrome.storage.local.set({ tabs: clearGroupTabs });
          }
          sendResponse({ success: true });
          break;
        }

        case 'openSidebar': {
          // 打开侧边栏
          try {
            await chrome.sidePanel.open({ path: 'sidepanel/sidepanel.html' });
          } catch (err) {
            console.error('打开侧边栏失败:', err);
          }
          sendResponse({ success: true });
          break;
        }

        case 'startPicker': {
          // 启动拾取器（支持标签）
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) {
              sendResponse({ success: false, error: 'No active tab' });
              break;
            }
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
              sendResponse({ success: false, error: 'Cannot pick from special pages' });
              break;
            }

            const tag = request.tag || '';

            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (pickerTag) => {
                if (window.__tabboardPickerActive) return;
                window.__tabboardPickerActive = true;

                const overlay = document.createElement("div");
                overlay.id = '__tabboard-picker-overlay';
                overlay.style.cssText = "position:absolute;border:2px solid #42a5f5;background:rgba(66,165,245,0.1);pointer-events:none;z-index:999999";
                document.body.appendChild(overlay);

                const tooltip = document.createElement("div");
                tooltip.id = '__tabboard-picker-tooltip';
                tooltip.style.cssText = "position:fixed;background:black;color:white;font-size:12px;padding:4px 8px;border-radius:4px;z-index:1000000;pointer-events:none;font-family:system-ui";
                document.body.appendChild(tooltip);

                function onMove(e) {
                  let el = document.elementFromPoint(e.clientX, e.clientY);
                  if (!el || el === overlay || el === tooltip) return;
                  const rect = el.getBoundingClientRect();
                  overlay.style.top = (rect.top + window.scrollY) + "px";
                  overlay.style.left = (rect.left + window.scrollX) + "px";
                  overlay.style.width = rect.width + "px";
                  overlay.style.height = rect.height + "px";
                  tooltip.style.top = (rect.top + window.scrollY - 28) + "px";
                  tooltip.style.left = (rect.left + window.scrollX) + "px";
                  const tagName = el.tagName.toLowerCase();
                  const id = el.id ? `#${el.id}` : '';
                  tooltip.innerText = `<${tagName}${id}>`;
                }

                function onClick(e) {
                  e.preventDefault();
                  e.stopPropagation();
                  let el = document.elementFromPoint(e.clientX, e.clientY);
                  if (!el) return;

                  let text = (el.innerText || el.textContent || '').trim();
                  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').slice(0, 5000);

                  const tagName = el.tagName.toLowerCase();
                  const value = el.value || '';
                  const placeholder = el.placeholder || '';
                  const href = el.href || '';

                  chrome.runtime.sendMessage({
                    type: 'PICK_RESULT',
                    data: {
                      tagName,
                      id: el.id || '',
                      name: el.name || '',
                      value,
                      placeholder,
                      text,
                      href,
                      sourceUrl: window.location.href,
                      sourceTitle: document.title,
                      tag: pickerTag,
                      timestamp: new Date().toISOString()
                    }
                  });
                  cleanup();
                }

                function cleanup() {
                  document.removeEventListener('mousemove', onMove, true);
                  document.removeEventListener('click', onClick, true);
                  document.removeEventListener('keydown', onKeyDown, true);
                  overlay.remove();
                  tooltip.remove();
                  window.__tabboardPickerActive = false;
                }

                function onKeyDown(e) {
                  if (e.key === 'Escape') {
                    cleanup();
                    chrome.runtime.sendMessage({ type: 'PICK_CANCEL' });
                  }
                }

                document.addEventListener('mousemove', onMove, true);
                document.addEventListener('click', onClick, true);
                document.addEventListener('keydown', onKeyDown, true);
                tooltip.innerText = '点击选择元素，ESC 取消';
              },
              args: [tag]
            });

            sendResponse({ success: true });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;
        }

        case 'startElementPicker': {
          // 启动元素拾取器
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) {
              sendResponse({ success: false, error: 'No active tab' });
              break;
            }

            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
              sendResponse({ success: false, error: 'Cannot pick from special pages' });
              break;
            }

            // 注入元素拾取脚本
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                // 防止重复注入
                if (window.__tabboardPickerActive) return;
                window.__tabboardPickerActive = true;

                // 创建高亮框
                const overlay = document.createElement("div");
                overlay.id = '__tabboard-picker-overlay';
                overlay.style.position = "absolute";
                overlay.style.border = "2px solid #42a5f5";
                overlay.style.background = "rgba(66, 165, 245, 0.1)";
                overlay.style.pointerEvents = "none";
                overlay.style.zIndex = "999999";
                document.body.appendChild(overlay);

                // 创建提示框
                const tooltip = document.createElement("div");
                tooltip.id = '__tabboard-picker-tooltip';
                tooltip.style.position = "fixed";
                tooltip.style.background = "black";
                tooltip.style.color = "white";
                tooltip.style.fontSize = "12px";
                tooltip.style.padding = "4px 8px";
                tooltip.style.borderRadius = "4px";
                tooltip.style.zIndex = "1000000";
                tooltip.style.pointerEvents = "none";
                tooltip.style.fontFamily = "system-ui";
                document.body.appendChild(tooltip);

                function onMove(e) {
                  let el = document.elementFromPoint(e.clientX, e.clientY);
                  if (!el || el === overlay || el === tooltip) return;

                  const rect = el.getBoundingClientRect();
                  overlay.style.top = rect.top + window.scrollY + "px";
                  overlay.style.left = rect.left + window.scrollX + "px";
                  overlay.style.width = rect.width + "px";
                  overlay.style.height = rect.height + "px";

                  tooltip.style.top = (rect.top + window.scrollY - 28) + "px";
                  tooltip.style.left = (rect.left + window.scrollX) + "px";

                  // 显示元素信息
                  const tagName = el.tagName.toLowerCase();
                  const id = el.id ? `#${el.id}` : '';
                  const cls = el.className ? `.${el.className.split(' ').join('.')}` : '';
                  tooltip.innerText = `<${tagName}${id}${cls}>`;
                }

                function onClick(e) {
                  e.preventDefault();
                  e.stopPropagation();

                  let el = document.elementFromPoint(e.clientX, e.clientY);
                  if (!el) return;

                  // 获取元素文本
                  let text = (el.innerText || el.textContent || '').trim();
                  // 清理多余空白
                  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').slice(0, 5000);

                  // 获取元素属性
                  const tagName = el.tagName.toLowerCase();
                  const id = el.id || '';
                  const name = el.name || '';
                  const value = el.value || '';
                  const type = el.type || '';
                  const placeholder = el.placeholder || '';
                  const href = el.href || '';

                  // 发送数据到 background
                  chrome.runtime.sendMessage({
                    type: 'PICK_RESULT',
                    data: {
                      tagName,
                      id,
                      name,
                      value,
                      type,
                      placeholder,
                      text,
                      href,
                      sourceUrl: window.location.href,
                      sourceTitle: document.title,
                      timestamp: new Date().toISOString()
                    }
                  });

                  cleanup();
                }

                function cleanup() {
                  document.removeEventListener('mousemove', onMove, true);
                  document.removeEventListener('click', onClick, true);
                  document.removeEventListener('keydown', onKeyDown, true);
                  overlay.remove();
                  tooltip.remove();
                  window.__tabboardPickerActive = false;
                }

                function onKeyDown(e) {
                  if (e.key === 'Escape') {
                    cleanup();
                    chrome.runtime.sendMessage({ type: 'PICK_CANCEL' });
                  }
                }

                document.addEventListener('mousemove', onMove, true);
                document.addEventListener('click', onClick, true);
                document.addEventListener('keydown', onKeyDown, true);

                // 提示用户
                tooltip.innerText = '点击选择元素，ESC 取消';
              }
            });

            sendResponse({ success: true });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
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
  });
}
