/**
 * Native Host 连接管理(常驻模式)
 *
 * host 是单 entry 双 transport:
 *   - sendNativeMessage(单发):Chrome 拉起 host → 1 条消息 → Chrome 终止 host
 *   - connectNative(常驻):host 循环读消息直到端口断开 —— 本模块管理的就是这种
 *
 * 对 popup 暴露 4 个消息:
 *   hostStart  → 建立长连接 + 版本握手
 *   hostStop   → port.disconnect()(Chrome 会终止 host 进程)
 *   hostStatus → { connected, hostInfo, lastError, startedAt }
 *   hostCall   → 通过长连接调命令;未连接时自动降级 one-shot sendNativeMessage
 */

const HOST_NAME = 'com.tabboard.tb';
const CONNECT_TIMEOUT_MS = 8000;   // 握手超时:host 8 秒没报版本视为失败
const CALL_TIMEOUT_MS = 20000;     // 单条命令超时(backup 大数据量留余量)

let port = null;
let hostInfo = null;      // { version, node, platform }
let lastError = null;
let startedAt = null;
let connectPromise = null;
const pending = new Map();   // __id → { resolve, reject, timer }
let seq = 0;

function setDisconnected(error) {
  const hadPort = port !== null;
  port = null;
  hostInfo = null;
  if (error) lastError = error;
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(error || 'host 连接断开'));
  }
  pending.clear();
  return hadPort;
}

/** 建立长连接(幂等:已连接直接返回;进行中复用同一 promise) */
function connect() {
  if (port) return Promise.resolve({ ok: true, hostInfo, alreadyConnected: true });
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; connectPromise = null; resolve(r); } };

    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (e) {
      lastError = e?.message ?? String(e);
      port = null;
      return done({ ok: false, error: lastError });
    }

    const failTimer = setTimeout(() => {
      const had = setDisconnected('连接超时:host 8 秒未完成版本握手');
      done({ ok: false, error: lastError, hadPort: had });
    }, CONNECT_TIMEOUT_MS);

    port.onMessage.addListener((msg) => {
      // 握手:第一条 version 响应
      if (!hostInfo && msg?.status === 'ok' && msg?.data?.version) {
        hostInfo = msg.data;
        startedAt = Date.now();
        lastError = null;
        clearTimeout(failTimer);
        return done({ ok: true, hostInfo });
      }
      // 常规响应:按 __id 分发
      const p = pending.get(msg?.__id);
      if (p) {
        pending.delete(msg.__id);
        clearTimeout(p.timer);
        p.resolve(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message ?? null;
      clearTimeout(failTimer);
      setDisconnected(err);   // 正常关闭(用户 stop / SW 休眠)时 err 为 null
      done({ ok: false, error: lastError, disconnected: true });
    });

    // 握手:版本
    port.postMessage({ command: 'version' });
  });

  return connectPromise;
}

/** 通过长连接调命令;未连接时降级 one-shot */
async function call(command, args = {}) {
  if (!port) {
    // 降级:one-shot(等价于"按需自动启动")
    const resp = await Promise.race([
      chrome.runtime.sendNativeMessage(HOST_NAME, { command, ...args }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('host 20 秒无响应(one-shot)')), CALL_TIMEOUT_MS)),
    ]);
    return resp;
  }
  const __id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(__id);
      reject(new Error(`host 命令 ${command} 超时(${CALL_TIMEOUT_MS}ms)`));
    }, CALL_TIMEOUT_MS);
    pending.set(__id, { resolve, reject, timer });
    port.postMessage({ command, ...args, __id });
  });
}

export function setupHostRelay() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message?.action) {
      case 'hostStart': {
        connect().then((r) => {
          sendResponse({
            success: r.ok,
            connected: !!port,
            hostInfo,
            error: r.ok ? null : (r.error || '连接失败'),
          });
        });
        return true;   // 异步响应
      }

      case 'hostStop': {
        if (port) {
          try { port.disconnect(); } catch { /* 忽略 */ }
          setDisconnected(null);
        }
        sendResponse({ success: true, connected: false });
        return false;
      }

      case 'hostStatus': {
        sendResponse({
          success: true,
          connected: !!port,
          hostInfo,
          lastError,
          startedAt,
        });
        return false;
      }

      case 'hostCall': {
        call(message.command, message.args ?? {})
          .then((resp) => sendResponse({ success: resp?.status === 'ok', resp }))
          .catch((e) => sendResponse({ success: false, error: e?.message ?? String(e) }));
        return true;   // 异步响应
      }

      default:
        return false;   // 其他 action 交给 groups.js 等监听器
    }
  });
}
