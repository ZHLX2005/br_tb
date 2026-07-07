/**
 * Bilibili History Service Worker
 * 提供 bilibiliHistory/fetch 消息处理，转发到 47.110.80.47:81 后端
 */

const API_BASE = 'http://47.110.80.47:81';
const API_PATH = '/api/bilibili/history/recent';

function mask(s) {
  if (!s || s.length < 8) return '***';
  return s.slice(0, 4) + '***' + s.slice(-4);
}

async function handleFetch(payload) {
  const url = `${API_BASE}${API_PATH}`;
  const t0 = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, status: 0, body: { detail: `网络异常：${err.message}` } };
  }
  const elapsed = Date.now() - t0;
  let body;
  try {
    body = await response.json();
  } catch {
    body = { detail: `后端非 JSON 响应（HTTP ${response.status}）` };
  }
  console.debug(`[bili-history] HTTP ${response.status} in ${elapsed}ms sessdata=${mask(payload?.sessdata)}`);
  return { ok: response.ok, status: response.status, body };
}

export function setupBiliHistoryListeners() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action !== 'bilibiliHistory/fetch') return false;
    handleFetch(msg.payload).then(sendResponse);
    return true; // keep channel open for async sendResponse
  });
}