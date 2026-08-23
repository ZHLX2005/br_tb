/**
 * Timeline/标签快照模块
 * 处理快照的收集、恢复、导入导出等功能
 */

import { generateId, showToast, DEFAULT_COLORS } from './utils.js';
import SearchHelper from '../modules/shared/search-helper.js';
import { getGroups, createGroup, seedGroupTabs } from './group-model.js';

// 计算所有快照中的总标签数
function countTotalTabs(snapshots) {
  return snapshots.reduce((total, snapshot) => total + snapshot.tabs.length, 0);
}

// 限制快照总数不超过指定标签数（通过删除最旧的快照）
function limitSnapshotsByTabCount(snapshots, maxTabs = 1000) {
  while (snapshots.length > 0 && countTotalTabs(snapshots) > maxTabs) {
    // 删除最旧的快照（数组末尾）
    snapshots.pop();
  }
  return snapshots;
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
    if (shouldSkipTab(tab, excludeEdgeUrls)) {
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
      showToast(activeTab.id, {
        type: 'info',
        title: '没有可收集的标签',
        message: '当前窗口没有可收集的标签页',
        duration: 2000
      });
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

  // 限制总标签数不超过 1000（删除最旧的快照，即数组末尾的）
  limitSnapshotsByTabCount(timelineSnapshots, 1000);

  await chrome.storage.local.set({ timelineSnapshots });

  // 如果设置为收集后关闭
  if (closeAfterCollect) {
    await closeCollectedTabs(tabs);
  }

  // 若当前窗口已存在 pin 的 TabBoard 看板页，直接切换过去（不显示带"打开看板"按钮的 toast）
  const pinnedTabboard = (await chrome.tabs.query({
    pinned: true,
    currentWindow: true
  })).find(tab => tab.url?.includes('modules/tabboard/tabboard.html'));

  if (pinnedTabboard) {
    await chrome.tabs.update(pinnedTabboard.id, { active: true });
    return;
  }

  // 否则显示带"打开看板"按钮的 toast
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (activeTab) {
    showToast(activeTab.id, {
      type: 'success',
      title: '收集完成',
      message: `已收集 ${collectedTabs.length} 个标签页`,
      duration: 2000,
      showOpenButton: true
    });
  }
}

// 收集除了当前页面外的其他所有标签页到 Timeline（创建快照）
async function collectOtherTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 如果没有活动标签页，直接返回
  if (!activeTab) {
    return;
  }

  const settings = await chrome.storage.local.get(['settings']);
  const closeAfterCollect = settings.settings?.closeAfterCollect || false;
  const excludeEdgeUrls = settings.settings?.excludeEdgeUrls || false;

  const result = await chrome.storage.local.get(['timelineSnapshots']);
  const timelineSnapshots = result.timelineSnapshots || [];

  // 收集所有有效标签页（除了当前活动标签页）
  const collectedTabs = [];
  for (const tab of tabs) {
    // 跳过当前活动标签页
    if (tab.id === activeTab.id) {
      continue;
    }

    if (shouldSkipTab(tab, excludeEdgeUrls)) {
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
    if (activeTab) {
      showToast(activeTab.id, {
        type: 'info',
        title: '没有可收集的标签',
        message: '除了当前页面外，没有其他可收集的标签页',
        duration: 2000
      });
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

  // 限制总标签数不超过 1000（删除最旧的快照，即数组末尾的）
  limitSnapshotsByTabCount(timelineSnapshots, 1000);

  await chrome.storage.local.set({ timelineSnapshots });

  // 如果设置为收集后关闭（只关闭收集的标签页，不关闭当前活动页面）
  if (closeAfterCollect) {
    await closeCollectedTabs(tabs, activeTab.id);
  }

  // 获取当前活动标签页用于显示提示
  const [currentActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 显示提示
  if (currentActiveTab) {
    showToast(currentActiveTab.id, {
      type: 'success',
      title: '收集完成',
      message: `已收集 ${collectedTabs.length} 个标签页（保留了当前页面）`,
      duration: 2000,
      showOpenButton: true
    });
  }
}

// 判断是否跳过该标签页
function shouldSkipTab(tab, excludeEdgeUrls) {
  // 跳过扩展页面和特殊页面
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return true;
  }

  // 可选：跳过 edge:// 页面
  if (excludeEdgeUrls && tab.url.startsWith('edge://')) {
    return true;
  }

  // 跳过空白页和无效 URL
  if (!tab.url || tab.url === 'about:blank' || tab.url.trim() === '') {
    return true;
  }

  // 跳过空标题和无效标题
  if (!tab.title || tab.title.trim() === '') {
    return true;
  }

  return false;
}

// 关闭收集的标签页
async function closeCollectedTabs(tabs, keepActiveTabId = null) {
  const tabsToCloseIds = [];
  for (const tab of tabs) {
    // 如果指定了保留的标签页ID，跳过它
    if (keepActiveTabId && tab.id === keepActiveTabId) {
      continue;
    }

    // 只保留需要关闭的标签页（与收集时的逻辑一致）
    const shouldClose = !(
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://')
    );

    if (shouldClose) {
      tabsToCloseIds.push(tab.id);
    }
  }

  // 关闭所有符合条件的标签页，添加错误处理
  if (tabsToCloseIds.length > 0) {
    try {
      // 使用 Promise.allSettled 确保所有标签页都被处理，即使有错误
      const closePromises = tabsToCloseIds.map(tabId =>
        chrome.tabs.remove(tabId).catch(error => {
          console.warn(`Failed to close tab ${tabId}:`, error);
        })
      );

      await Promise.allSettled(closePromises);
      console.log(`Successfully closed ${tabsToCloseIds.length} tabs`);
    } catch (error) {
      console.error('Error closing tabs:', error);
    }
  }
}

// 收集并打开看板
async function collectAndOpenTabboard() {
  // 先收集当前窗口所有标签
  await collectCurrentWindowTabs();
  // 然后打开看板
  await openTabboard();
}

// 打开标签页管理看板（统一从 tabboard.js 导出，修复跨窗口焦点问题）
import { openTabboard as _openTabboardImpl } from './tabboard.js';
const openTabboard = _openTabboardImpl;

// 导出函数供外部使用
export {
  collectCurrentWindowTabs,
  collectOtherTabs,
  collectAndOpenTabboard,
  openTabboard,
  setupTimelineListeners
};

/**
 * 搜索快照列表（委托给 SearchHelper）
 */
function fuzzySearchSnapshots(snapshots, query) {
  return SearchHelper.searchSnapshots(snapshots, query);
}

// 设置 Timeline 相关的消息监听器
function setupTimelineListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getTimelineTabs': {
          const timelineResult = await chrome.storage.local.get(['timelineSnapshots']);
          sendResponse({ success: true, snapshots: timelineResult.timelineSnapshots || [] });
          break;
        }

        case 'searchTimeline': {
          // 有序字符串模糊搜索快照
          const timelineResult = await chrome.storage.local.get(['timelineSnapshots']);
          const snapshots = timelineResult.timelineSnapshots || [];
          const query = request.query || '';
          const results = fuzzySearchSnapshots(snapshots, query);
          sendResponse({ success: true, snapshots: results, total: snapshots.length });
          break;
        }

        case 'deleteTimelineSnapshot': {
          const deleteSnapshotResult = await chrome.storage.local.get(['timelineSnapshots']);
          const snapshots = deleteSnapshotResult.timelineSnapshots || [];
          const newSnapshots = snapshots.filter(s => s.id !== request.snapshotId);
          await chrome.storage.local.set({ timelineSnapshots: newSnapshots });
          sendResponse({ success: true });
          break;
        }

        case 'restoreSnapshot': {
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
        }

        case 'importTimelineSnapshots': {
          const importResult = await chrome.storage.local.get(['timelineSnapshots']);
          const existingSnapshots = importResult.timelineSnapshots || [];
          // 合并导入的快照到现有快照中（去重）
          const existingIds = new Set(existingSnapshots.map(s => s.id));
          const snapshotsToAdd = request.snapshots.filter(s => !existingIds.has(s.id));
          // 现有快照在前，新导入的在后，这样超过限制时截断的是新快照而非现有快照
          const mergedSnapshots = [...existingSnapshots, ...snapshotsToAdd];
          // 限制总标签数不超过 1000（删除最旧的快照，即数组末尾的）
          limitSnapshotsByTabCount(mergedSnapshots, 1000);
          await chrome.storage.local.set({ timelineSnapshots: mergedSnapshots });
          sendResponse({ success: true, imported: snapshotsToAdd.length, total: mergedSnapshots.length });
          break;
        }

        case 'toggleTabMark': {
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
        }

        case 'extractMarkedAsGroup': {
          // 将标记为重要的标签提取为新分组，并清空所有快照
          console.log('[Background] extractMarkedAsGroup request:', request);
          const { markedTabs } = request;

          // groups / tabs 走 group-model(唯一存储入口),timeline 自身负责清空快照
          const existingGroups = await getGroups();
          const newColor = DEFAULT_COLORS[existingGroups.length % DEFAULT_COLORS.length];
          const newGroup = await createGroup({
            name: `重要标签 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
            color: newColor
          });
          await seedGroupTabs(newGroup.id, markedTabs);

          // 清空所有快照
          await chrome.storage.local.set({ timelineSnapshots: [] });

          console.log('[Background] Extracted marked tabs to group:', newGroup.name);
          sendResponse({ success: true, groupName: newGroup.name });
          break;
        }

        case 'collectOtherTabs': {
          await collectOtherTabs();
          sendResponse({ success: true });
          break;
        }

        case 'collectAndOpenTabboard': {
          await collectAndOpenTabboard();
          sendResponse({ success: true });
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
