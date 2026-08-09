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
  'getNoteCurrentPageId', 'setNoteCurrentPageId',
  // 便签截图 → 图床
  'uploadNoteImage',
  // 图片代理:SW fetch http 图 → dataURL,绕开 HTTPS 页 Mixed Content
  'fetchImageAsDataUrl',
  // 登录状态查询:通用 service,module/noteRing 都可用
  'getLoginStatus',
  // 主动登录(无 token 时一次性登录拿 token,缓存 30 天)
  'ensureLogin'
]);

// ===================== 图床上传（便签截图） =====================
// 后端:dev_ctr_hello GoFrame + Postgres 图床
// 契约:POST /api/v1/user/login {email,password} → data.token(JWT 30 天)
//       POST /api/v1/files multipart(file + accessLevel + expireSeconds + groupId) → data.url
// 凭证存 chrome.storage.local.noteUpload { email, password, token, tokenExpiry }

const UPLOAD_API_BASE = 'http://47.110.80.47:8988';
const UPLOAD_CFG_KEY = 'noteUpload';
const UPLOAD_TOKEN_TTL = 30 * 24 * 3600 * 1000; // JWT 30 天

async function loadUploadConfig() {
  const r = await chrome.storage.local.get([UPLOAD_CFG_KEY]);
  return r[UPLOAD_CFG_KEY] || {};
}

async function saveUploadConfig(cfg) {
  await chrome.storage.local.set({ [UPLOAD_CFG_KEY]: cfg });
}

/**
 * 登录拿 token。token 未过期(预留 60s)直接复用;force=true 强制重新登录。
 */
async function loginAndGetToken(force = false) {
  const cfg = await loadUploadConfig();
  if (!cfg.email || !cfg.password) {
    throw new Error('未配置图床账号，请到 popup「基础设置 → 图床账号」填写');
  }
  if (!force && cfg.token && cfg.tokenExpiry && Date.now() < cfg.tokenExpiry - 60000) {
    return cfg.token;
  }
  let resp;
  try {
    resp = await fetch(`${UPLOAD_API_BASE}/api/v1/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cfg.email, password: cfg.password })
    });
  } catch (err) {
    throw new Error('无法连接图床服务: ' + err.message);
  }
  let body = {};
  try { body = await resp.json(); } catch (_) {}
  if (!resp.ok || body.code !== 0 || !body.data?.token) {
    throw new Error('图床登录失败: ' + (body.message || ('HTTP ' + resp.status)));
  }
  const token = body.data.token;
  cfg.token = token;
  cfg.tokenExpiry = Date.now() + UPLOAD_TOKEN_TTL;
  await saveUploadConfig(cfg);
  return token;
}

async function postUploadForm(form, token) {
  const resp = await fetch(`${UPLOAD_API_BASE}/api/v1/files`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: form
  });
  let body = {};
  try { body = await resp.json(); } catch (_) {}
  return { status: resp.status, body };
}

/**
 * dataUrl(PNG) → 上传图床 → 返回公开 URL(http://)。
 * 401 时 token 失效 → 强制重登一次。
 * 注:图床返回 http URL 在 HTTPS 页面(如 B 站)加载会被 Mixed Content 拦截。
 * 浏览器扩展层面可解决:noteRing 渲染预览时通过扩展 fetch 转 blob URL 替换 img.src。
 * 笔记正文仍存原 URL(http://...),只占几十字节、可分享、未来 HTTPS 化自动好。
 */
async function uploadNoteImage(dataUrl) {
  const token = await loginAndGetToken();
  const blob = await (await fetch(dataUrl)).blob();
  const makeForm = () => {
    const f = new FormData();
    f.append('file', blob, 'frame.png');
    f.append('accessLevel', 'public');
    f.append('expireSeconds', '0');
    f.append('groupId', '0');
    return f;
  };
  let { status, body } = await postUploadForm(makeForm(), token);
  if (status === 401) {
    const token2 = await loginAndGetToken(true);
    ({ status, body } = await postUploadForm(makeForm(), token2));
  }
  if (status !== 200 || body.code !== 0 || !body.data?.url) {
    throw new Error('图床上传失败: ' + (body.message || ('HTTP ' + status)));
  }
  return body.data.url;
}

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
          case 'uploadNoteImage': {
            if (!request.dataUrl) { result = { success: false, error: '缺少图片数据' }; break; }
            const url = await uploadNoteImage(request.dataUrl);
            result = { success: true, url };
            break;
          }
          case 'fetchImageAsDataUrl': {
            // HTTPS 页面加载 http:// 图被 Mixed Content 拦截。
            // 扩展 Service Worker 在独立的 background context 里 fetch,
            // 不受页面 Mixed Content 规则约束 → 转 dataURL 回传,
            // 任意页面都能显示。笔记正文始终存原 http URL(几十字节)。
            if (!request.url) { result = { success: false, error: '缺少 url' }; break; }
            try {
              const r = await fetch(request.url);
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const blob = await r.blob();
              const dataUrl = await new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onload = () => res(fr.result);
                fr.onerror = () => rej(fr.error);
                fr.readAsDataURL(blob);
              });
              result = { success: true, dataUrl };
            } catch (err) {
              result = { success: false, error: err.message };
            }
            break;
          }
          case 'getLoginStatus': {
            // 通用登录态查询(不强制登录)
            const cfg = await loadUploadConfig();
            const hasCredentials = !!(cfg.email && cfg.password);
            const tokenValid = !!(cfg.token && cfg.tokenExpiry && Date.now() < cfg.tokenExpiry - 60000);
            result = {
              success: true,
              hasCredentials,
              hasToken: !!cfg.token,
              tokenValid,
              email: cfg.email || null,
              tokenExpiry: cfg.tokenExpiry || null
            };
            break;
          }
          case 'ensureLogin': {
            // 主动登录(无 token / 过期时);已有效 token 直接返回
            try {
              await loginAndGetToken(false);
              result = { success: true };
            } catch (err) {
              result = { success: false, error: err.message };
            }
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