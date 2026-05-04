/**
 * Focus Search 专注搜索模块
 * 处理 content/focus-search.js 使用的后台 API
 */

import { generateId } from './utils.js';

const HISTORY_GROUP_NAME = 'History';
const HISTORY_GROUP_COLOR = '#9e9e9e';

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

async function addToHistoryGroup(tabInfo) {
  const { title, url, favicon } = tabInfo;
  if (!url || !title) return false;

  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:')) {
    return false;
  }

  const historyGroup = await getOrCreateHistoryGroup();
  const result = await chrome.storage.local.get(['tabs']);
  const tabs = result.tabs || {};

  if (!tabs[historyGroup.id]) {
    tabs[historyGroup.id] = [];
  }

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

    if (tabs[historyGroup.id].length > 200) {
      tabs[historyGroup.id] = tabs[historyGroup.id].slice(0, 200);
    }

    await chrome.storage.local.set({ tabs });
    return true;
  }
  return false;
}

async function handleGetAllOpenTabs() {
  const [browserTabsResult, settingsResult] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.local.get(['settings', 'tabs'])
  ]);

  const settings = settingsResult.settings || {};
  const focusSearchGroupIds = settings.focusSearchGroups || [];
  const storedTabs = settingsResult.tabs || {};

  const browserTabs = browserTabsResult
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
  if (focusSearchGroupIds.length > 0) {
    for (const groupId of focusSearchGroupIds) {
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

  const allTabs = [...browserTabs, ...groupTabs];
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
    return false;
  });
}

export { setupFocusListeners, getOrCreateHistoryGroup, addToHistoryGroup };
