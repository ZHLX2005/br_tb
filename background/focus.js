/**
 * Focus Search 专注搜索模块
 * 处理 content/focus-search.js 使用的后台 API
 * group 数据操作统一走 group-model.js(唯一存储入口)
 */

import { createGroup, addTabToGroup, getGroups, getTabsMap } from './group-model.js';

const HISTORY_GROUP_NAME = 'History';
const HISTORY_GROUP_COLOR = '#9e9e9e';
const HISTORY_GROUP_MAX_TABS = 200;

async function getOrCreateHistoryGroup() {
  const groups = await getGroups();
  const existing = groups.find(g => g.name === HISTORY_GROUP_NAME);
  if (existing) return existing;
  // 统一走 createGroup;visible: false 保持历史行为(History 分组不在看板显示)
  return createGroup({
    name: HISTORY_GROUP_NAME,
    color: HISTORY_GROUP_COLOR,
    visible: false
  });
}

async function addToHistoryGroup(tabInfo) {
  const { title, url, favicon } = tabInfo;
  if (!url || !title) return false;

  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:')) {
    return false;
  }

  const historyGroup = await getOrCreateHistoryGroup();
  return addTabToGroup(
    { title, url, favicon },
    historyGroup.id,
    { maxTabs: HISTORY_GROUP_MAX_TABS, initVisitCount: true }
  );
}

async function handleGetAllOpenTabs() {
  const [browserTabs, groups, storedTabs] = await Promise.all([
    chrome.tabs.query({}),
    getGroups(),
    getTabsMap()
  ]);

  const focusGroupIds = groups
    .filter(g => g.inFocusSearch === true)
    .map(g => g.id);

  const openTabs = browserTabs
    .filter(t => t.id && t.url && !t.url.startsWith('chrome:') && !t.url.startsWith('chrome-extension:') && t.url !== 'edge://newtab')
    .map(t => ({
      id: 'browser_' + t.id,
      title: t.title || '无标题',
      url: t.url || '',
      favicon: t.favIconUrl || '',
      windowId: t.windowId,
      active: t.active,
      audible: !!t.audible,
      source: 'browser'
    }));

  let groupTabs = [];
  if (focusGroupIds.length > 0) {
    for (const groupId of focusGroupIds) {
      if (storedTabs[groupId] && Array.isArray(storedTabs[groupId])) {
        groupTabs = groupTabs.concat(storedTabs[groupId].map(t => ({
          id: 'group_' + t.id,
          title: t.title || '无标题',
          url: t.url || '',
          favicon: t.favicon || '',
          windowId: null,
          active: false,
          source: 'group',
          groupId: groupId
        })));
      }
    }
  }

  const allTabs = [...openTabs, ...groupTabs];
  const seen = new Set();
  const deduped = allTabs.filter(tab => {
    if (seen.has(tab.url)) return false;
    seen.add(tab.url);
    return true;
  });

  return { success: true, tabs: deduped };
}

async function handleFocusSearchSwitchTab(url) {
  try {
    if (url) {
      const tabs = await chrome.tabs.query({ url: url });
      if (tabs && tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: url, active: true });
      }
    }
  } catch (e) {
    console.error('[FocusSearch] Failed to switch tab:', e);
  }
  return { success: true };
}

function setupFocusListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getAllOpenTabs') {
      handleGetAllOpenTabs().then(sendResponse);
      return true;
    }
    if (request.action === 'focusSearchSwitchTab') {
      handleFocusSearchSwitchTab(request.url).then(sendResponse);
      return true;
    }
    if (request.action === 'addToHistoryGroup') {
      addToHistoryGroup(request.tabInfo).then(() => sendResponse({ success: true }));
      return true;
    }
    if (request.action === 'performSearch') {
      try {
        chrome.search.query({ text: request.query, disposition: 'NEW_TAB' });
        sendResponse({ success: true });
      } catch (e) {
        console.error('[FocusSearch] Search API error:', e);
        // fallback: 用 Google 搜索兜底
        chrome.tabs.create({ url: 'https://www.google.com/search?q=' + encodeURIComponent(request.query) });
        sendResponse({ success: true, fallback: true });
      }
      return true;
    }
    return false;
  });
}

export { setupFocusListeners, getOrCreateHistoryGroup, addToHistoryGroup };
