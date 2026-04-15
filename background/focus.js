/**
 * Focus Search 专注搜索模块
 * 处理 Alt+Shift+S 快捷键触发的全局标签页搜索浮层相关功能
 */

import { generateId } from './utils.js';

// ========== History 分组管理 ==========

const HISTORY_GROUP_NAME = 'History';
const HISTORY_GROUP_COLOR = '#9e9e9e';

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
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:')) {
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

// ========== 消息处理 ==========

function setupFocusListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 异步处理
    (async () => {
      switch (request.action) {
        case 'getAllOpenTabs': {
          // 模糊搜索的上下文来自两个来源：
          // 1. 当前浏览器打开的所有 tabs
          // 2. 勾选的分组里的 tabs（focusSearchGroups）
          // 两者合并后作为搜索候选集

          const [browserTabsResult, settingsResult] = await Promise.all([
            chrome.tabs.query({}),
            chrome.storage.local.get(['settings', 'tabs'])
          ]);

          const settings = settingsResult.settings || {};
          const focusSearchGroupIds = settings.focusSearchGroups || [];
          const storedTabs = settingsResult.tabs || {};

          // 来源1: 浏览器当前 tabs
          const browserTabs = browserTabsResult
            .filter(t => t.id && t.url && !t.url.startsWith('chrome:') && !t.url.startsWith('chrome-extension:') && t.url !== 'edge://newtab')
            .map(t => ({
              id: `browser_${t.id}`,
              title: t.title || '无标题',
              url: t.url || '',
              favicon: t.favIconUrl || '',
              windowId: t.windowId,
              active: t.active,
              source: 'browser'
            }));

          // 来源2: 勾选的分组 tabs
          let groupTabs = [];
          if (focusSearchGroupIds.length > 0) {
            for (const groupId of focusSearchGroupIds) {
              if (storedTabs[groupId] && Array.isArray(storedTabs[groupId])) {
                groupTabs = groupTabs.concat(storedTabs[groupId].map(t => ({
                  id: `group_${t.id}`,
                  title: t.title || '无标题',
                  url: t.url || '',
                  favicon: t.favicon || '',
                  windowId: null,
                  active: false,
                  source: 'group',
                  groupId
                })));
              }
            }
          }

          // 合并两个来源，去重（按 URL 去重）
          const allTabs = [...browserTabs, ...groupTabs];
          const seen = new Set();
          const deduped = allTabs.filter(tab => {
            if (seen.has(tab.url)) return false;
            seen.add(tab.url);
            return true;
          });

          sendResponse({ success: true, tabs: deduped });
          break;
        }

        case 'focusSearchSwitchTab': {
          try {
            if (request.url) {
              // 先尝试找到已打开的标签页
              const tabs = await chrome.tabs.query({ url: request.url });
              if (tabs && tabs.length > 0) {
                await chrome.tabs.update(tabs[0].id, { active: true });
                await chrome.windows.update(tabs[0].windowId, { focused: true });
              } else {
                // 没找到，创建新标签页
                await chrome.tabs.create({ url: request.url, active: true });
              }
            }
          } catch (e) {
            console.error('[FocusSearch] Failed to switch tab:', e);
          }
          sendResponse({ success: true });
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

        default:
          sendResponse({ success: false, error: 'Unknown action' });
          break;
      }
    })();
    return true; // 保持消息通道开放以支持异步响应
  });
}

// ========== 模块初始化 ==========

export function init() {
  setupFocusListeners();
}
