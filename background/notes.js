/**
 * Notes — 便签页（每页 = 一篇可编辑文章）
 *
 * 数据模型：
 *   notePages: [
 *     {
 *       id, name, content,           ← content 是页面的全文内容
 *       createdAt, updatedAt,
 *       boundTabs: [{ url, title, favicon }]
 *     }
 *   ]
 *
 * 语义：每个便签页就是一篇独立的文章，content 是全文（不分条）。
 * 适用：随手记/长文/草稿/教程笔记。
 */

function generateId(prefix = 'n') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function loadPages() {
  const r = await chrome.storage.local.get(['notePages']);
  return Array.isArray(r.notePages) ? r.notePages : [];
}

async function savePages(notePages) {
  await chrome.storage.local.set({ notePages });
}

// 全局默认便签页 id：用户上次选中的 page,跨 tab 共享
// 用户在面板里主动选择 page 时写入(覆盖),下次开面板默认就是它
// 已选 page 时不再被覆盖(用户主动选了 a,即使面板里还有别的页面,保持 a)
async function loadCurrentPageId() {
  const r = await chrome.storage.local.get(['noteCurrentPageId']);
  return r.noteCurrentPageId || null;
}

async function saveCurrentPageId(id) {
  if (id) await chrome.storage.local.set({ noteCurrentPageId: id });
  else await chrome.storage.local.remove('noteCurrentPageId');
}

function touch(page) {
  page.updatedAt = new Date().toISOString();
  return page;
}

function nowIso() {
  return new Date().toISOString();
}

const NOTE_ACTIONS = new Set([
  'getNotes',
  'getActiveTabInfo',
  'createNotePage', 'renameNotePage', 'deleteNotePage',
  'updateNoteContent',
  'bindTabToPage', 'unbindTabFromPage',
  'getPagesForTab',
  // 全局默认 page id:用户上次选的 page,跨 tab 共享
  'getNoteCurrentPageId', 'setNoteCurrentPageId'
]);

export function setupNotesListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const a = request?.action;
    if (!a || !NOTE_ACTIONS.has(a)) return false;
    (async () => {
      try {
        let result = { success: true };

        switch (a) {
          case 'getActiveTabInfo': {
            // content script 没有 chrome.tabs;sender.tab 就是该 content script 所在 tab
            const tab = sender.tab;
            result = {
              success: true,
              url: tab?.url || '',
              title: tab?.title || '',
              favicon: tab?.favIconUrl || ''
            };
            break;
          }
          case 'getNotes': {
            const notePages = await loadPages();
            result = { success: true, notePages };
            break;
          }
          case 'createNotePage': {
            const notePages = await loadPages();
            const page = {
              id: generateId('p'),
              name: (request.name || '未命名便签').trim().slice(0, 40) || '未命名便签',
              content: (request.content || '').toString(),
              createdAt: nowIso(),
              updatedAt: nowIso(),
              boundTabs: []
            };
            notePages.push(page);
            await savePages(notePages);
            result = { success: true, page };
            break;
          }
          case 'renameNotePage': {
            const notePages = await loadPages();
            const page = notePages.find(p => p.id === request.id);
            if (!page) { result = { success: false, error: '页面不存在' }; break; }
            const name = (request.name || page.name).trim().slice(0, 40);
            if (name) {
              page.name = name;
              touch(page);
              await savePages(notePages);
            }
            result = { success: true, page };
            break;
          }
          case 'deleteNotePage': {
            let notePages = await loadPages();
            const before = notePages.length;
            notePages = notePages.filter(p => p.id !== request.id);
            if (notePages.length === before) { result = { success: false, error: '页面不存在' }; break; }
            await savePages(notePages);
            // 若全局默认指向被删页,清掉(下次开面板会取 pages[0])
            const currentId = await loadCurrentPageId();
            if (currentId === request.id) {
              await saveCurrentPageId(null);
            }
            result = { success: true };
            break;
          }
          case 'updateNoteContent': {
            const notePages = await loadPages();
            const page = notePages.find(p => p.id === request.id);
            if (!page) { result = { success: false, error: '页面不存在' }; break; }
            page.content = (request.content || '').toString();
            touch(page);
            await savePages(notePages);
            result = { success: true, page };
            break;
          }
          case 'bindTabToPage': {
            const notePages = await loadPages();
            const page = notePages.find(p => p.id === request.pageId);
            if (!page) { result = { success: false, error: '页面不存在' }; break; }
            const url = (request.url || '').trim();
            if (!url) { result = { success: false, error: 'URL 为空' }; break; }
            if (!page.boundTabs.some(t => t.url === url)) {
              page.boundTabs.push({
                url,
                title: (request.title || url).slice(0, 120),
                favicon: request.favicon || ''
              });
              touch(page);
              await savePages(notePages);
            }
            result = { success: true, page };
            break;
          }
          case 'unbindTabFromPage': {
            const notePages = await loadPages();
            const page = notePages.find(p => p.id === request.pageId);
            if (!page) { result = { success: false, error: '页面不存在' }; break; }
            page.boundTabs = page.boundTabs.filter(t => t.url !== request.url);
            touch(page);
            await savePages(notePages);
            result = { success: true, page };
            break;
          }
          case 'getPagesForTab': {
            const notePages = await loadPages();
            const url = (request.url || '').trim();
            if (!url) { result = { success: true, pages: [] }; break; }
            let origin;
            try { origin = new URL(url).origin; } catch (_) { origin = ''; }
            const matched = notePages.filter(p =>
              p.boundTabs.some(t => t.url === url || (origin && (() => {
                try { return new URL(t.url).origin === origin; } catch (_) { return false; }
              })()))
            );
            result = { success: true, pages: matched };
            break;
          }
          case 'getNoteCurrentPageId': {
            // 读全局默认 page id。语义：用户选过的 page,跨 tab 共享
            const currentId = await loadCurrentPageId();
            result = { success: true, currentPageId: currentId };
            break;
          }
          case 'setNoteCurrentPageId': {
            // 用户在面板里选了 page 时写入。已选 page 时不再被覆盖
            const id = request.id || null;
            if (id) {
              const notePages = await loadPages();
              if (!notePages.find(p => p.id === id)) {
                result = { success: false, error: '页面不存在' };
                break;
              }
            }
            await saveCurrentPageId(id);
            result = { success: true, currentPageId: id };
            break;
          }
          default:
            result = { success: false, error: '未知操作' };
        }
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  });
}

/**
 * tab 激活广播：content script 没有 chrome.tabs.onActivated,
 * 由 background 监听激活变化,通知对应 tab 的 content script 重新探测。
 */
export function initNoteTabBroadcast() {
  if (!chrome.tabs?.onActivated) return;
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.sendMessage(tabId, { action: 'noteTabActivated' }).catch(() => {});
  });
}