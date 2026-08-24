/**
 * 收藏分组模块 — 消息适配层
 * 处理分组相关的 chrome.runtime 消息,数据操作全部委托 group-model.js(唯一存储入口)
 */

import { showToast } from './utils.js';
import { openTabboard } from './tabboard.js';
import {
  getGotoRingSettings,
  updateGotoRingSize,
  updateGotoRingBg
} from './ring-settings.js';
import {
  getGroups,
  getTabsMap,
  getDefaultGroupId,
  createGroup,
  deleteGroup as modelDeleteGroup,
  renameGroup,
  setDefaultGroup as modelSetDefaultGroup,
  updateBoardOrder as modelUpdateBoardOrder,
  importGroupsAndTabs,
  toggleGoto,
  setGroupFocusSearch,
  setGroupsVisibility,
  toggleTabInGroup,
  updateTab as modelUpdateTab,
  moveTab as modelMoveTab,
  deleteTab as modelDeleteTab,
  clearGroupTabs,
  clearAllGroupTabs,
  incrementVisitCount,
  sortAllTabsByVisitCount
} from './group-model.js';

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
  const groups = await getGroups();
  const groupName = groups.find(g => g.id === defaultGroupId)?.name || '目标分组';

  const action = await toggleTabInGroup(tab, defaultGroupId);

  if (action === 'added') {
    showToast(tab.id, {
      type: 'success',
      title: '已添加',
      message: `已保存到「${groupName}」`,
      duration: 2000,
      showOpenButton: true
    });
  } else if (action === 'removed') {
    showToast(tab.id, {
      type: 'info',
      title: '已移除',
      message: `已从「${groupName}」移除`,
      duration: 2000
    });
  } else {
    // noop 兜底(实际不可达)
    showToast(tab.id, {
      type: 'info',
      title: '标签已存在',
      message: `该标签已在「${groupName}」中`,
      duration: 2000
    });
  }
}

// 导出函数供外部使用
export {
  addCurrentTabToDefaultGroup,
  getDefaultGroupId,
  openTabboard,
  setupGroupsListeners
};

// 设置分组相关的消息监听器
function setupGroupsListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getGroups': {
          sendResponse({ success: true, groups: await getGroups() });
          break;
        }

        case 'clearAllGroups': {
          await clearAllGroupTabs();
          sendResponse({ success: true });
          break;
        }

        case 'importGroupsAndTabs': {
          // 导入分组和标签数据（替换现有数据）
          await importGroupsAndTabs(request.groups, request.tabs);
          sendResponse({ success: true });
          break;
        }

        case 'addTab': {
          const defaultId = await getDefaultGroupId();
          const targetGroupId = request.groupId || defaultId;
          const action = await toggleTabInGroup(request.tab, targetGroupId);
          sendResponse({ success: true, action });
          break;
        }

        case 'updateTab': {
          await modelUpdateTab(request);
          sendResponse({ success: true });
          break;
        }

        case 'moveTab': {
          await modelMoveTab(request);
          sendResponse({ success: true });
          break;
        }

        case 'updateBoardOrder': {
          await modelUpdateBoardOrder(request.boardOrder);
          sendResponse({ success: true });
          break;
        }

        case 'deleteTab': {
          await modelDeleteTab(request);
          sendResponse({ success: true });
          break;
        }

        case 'addGroup': {
          const addedGroup = await createGroup({
            name: request.name,
            color: request.color || '#ff6b6b'
          });
          sendResponse({ success: true, groupId: addedGroup.id });
          break;
        }

        case 'deleteGroup': {
          await modelDeleteGroup(request.groupId);
          sendResponse({ success: true });
          break;
        }

        case 'setDefaultGroup': {
          await modelSetDefaultGroup(request.groupId);
          sendResponse({ success: true });
          break;
        }

        case 'setGroupAsGoto': {
          const isGoto = await toggleGoto(request.groupId);
          broadcastGotoRefresh();
          sendResponse({ success: true, isGoto });
          break;
        }

        case 'toggleGroupFocusSearch': {
          const inFocusSearch = await setGroupFocusSearch(request.groupId, request.value);
          sendResponse({ success: true, inFocusSearch });
          break;
        }

        case 'setGroupsVisibility': {
          // request.visibleGroupIds: 全量可见 ID 列表,不在其中的一律隐藏
          await setGroupsVisibility(request.visibleGroupIds);
          sendResponse({ success: true });
          break;
        }

        case 'openTab': {
          // 去重：若已有同 URL 标签页，则激活它，避免重复创建。
          // ⚠️ chrome.tabs.query 对受限 URL（chrome://、edge://、chrome-extension://、
          //    about:、devtools://、file://）会抛 "Cannot access a chrome:// URL"，
          //    因此整个 case 必须 try/catch 包裹，query 失败时 fallback 到 create。
          const url = request.url;
          try {
            if (url) {
              const existing = await chrome.tabs.query({ url: url });
              if (existing && existing.length > 0) {
                const win = await chrome.windows.getCurrent();
                const inCurrent = existing.find(t => t.windowId === win.id);
                const target = inCurrent || existing[0];
                try {
                  await chrome.tabs.update(target.id, { active: true });
                  await chrome.windows.update(target.windowId, { focused: true });
                  sendResponse({ success: true, reused: true });
                  break;
                } catch (e) {
                  console.warn('[TabBoard] openTab switch failed, falling back to create:', e);
                }
              }
            }
          } catch (queryErr) {
            // 受限 URL 在 query 阶段就会抛错（例如 chrome://settings、edge://flags）。
            // 记录后继续走 create 兜底 —— chrome.tabs.create 对多数受限 URL 仍可建。
            console.warn('[TabBoard] openTab query failed for', url, '- falling back to create:', queryErr.message);
          }
          try {
            await chrome.tabs.create({ url: url });
            sendResponse({ success: true });
          } catch (createErr) {
            console.error('[TabBoard] openTab create FAILED for', url, '-', createErr.message);
            sendResponse({ success: false, error: createErr.message });
          }
          break;
        }

        case 'openGroup': {
          const tabsMap = await getTabsMap();
          const groupTabs = tabsMap[request.groupId] || [];

          // 单个 tab 创建失败不能让整个 group 后续 tab 都打不开。
          // 受限 URL（chrome://、edge://、file:// 等）在 MV3 下 create 会被拒，
          // 单独 try/catch 后跳过并记录，继续打开其它 tab。
          let opened = 0;
          const failed = [];
          for (const tab of groupTabs) {
            if (!tab || !tab.url) continue;
            try {
              await chrome.tabs.create({ url: tab.url });
              opened++;
            } catch (e) {
              console.warn('[TabBoard] openGroup skipped', tab.url, '-', e.message);
              failed.push({ url: tab.url, error: e.message });
            }
          }

          // 如果设置为打开后删除
          const { settings } = await chrome.storage.local.get(['settings']);
          if (settings.closeAfterRestore) {
            await clearGroupTabs(request.groupId);
          }

          sendResponse({ success: true, opened, failed: failed.length, failures: failed });
          break;
        }

        case 'updateGroupName': {
          await renameGroup(request.groupId, request.newName);
          sendResponse({ success: true });
          break;
        }

        case 'openTabboard': {
          if (request.view) {
            const { settings } = await chrome.storage.local.get(['settings']);
            await chrome.storage.local.set({
              settings: { ...settings, lastView: request.view }
            });
          }
          await openTabboard();
          sendResponse({ success: true });
          break;
        }

        case 'incrementVisitCount': {
          // 增加标签页的访问次数
          const found = await incrementVisitCount(request.url);
          sendResponse({ success: true, found });
          break;
        }

        case 'sortTabsByVisitCount': {
          await sortAllTabsByVisitCount();
          sendResponse({ success: true });
          break;
        }

        case 'getGotoRingSettings': {
          const ringSettings = await getGotoRingSettings();
          sendResponse({ success: true, ...ringSettings });
          break;
        }

        case 'updateGotoRingSize': {
          try {
            const result = await updateGotoRingSize(request.size);
            sendResponse({ success: true, ...result });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
          break;
        }

        case 'updateGotoRingBg': {
          try {
            const result = await updateGotoRingBg(request.bg);
            sendResponse({ success: true, ...result });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
          break;
        }

        case 'getAllData': {
          // 获取所有数据（分组和标签）- 侧边栏使用
          const [groups, tabsMap] = await Promise.all([getGroups(), getTabsMap()]);
          sendResponse({ success: true, groups, tabs: tabsMap });
          break;
        }

        case 'clearGroup': {
          await clearGroupTabs(request.groupId);
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

/**
 * 向所有 tab 广播 goto 圆环刷新消息
 */
async function broadcastGotoRefresh() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && !tab.url?.startsWith('chrome://')) {
        chrome.tabs.sendMessage(tab.id, { action: 'refreshGotoRing' }).catch(() => {});
      }
    }
  } catch (e) {
    // ignore
  }
}
