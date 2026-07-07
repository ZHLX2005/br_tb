# B 站观看历史模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 TabBoard 中新增 B 站观看历史面板：用户粘贴 cookies JSON、扩展通过 background fetch `http://47.110.80.47:81/api/bilibili/history/recent`，渲染近 3 天可视化的观看历史表格 + 简易柱图。

**Architecture:** 内嵌 view.js 方案（与 Timeline/Group/Timer/LeetCode 同层级），不持久化时效数据。Background service worker 提供 `bilibiliHistory/fetch` 消息处理，统一负责远端跨域 fetch。Cookies 仅在 view 闭包内 in-memory，不写入 chrome.storage / console.log。

**Tech Stack:** 纯 Vanilla JS + ES6 modules + CSS（与项目一致）；Chrome Manifest V3 service worker；后端已验证在线的 FastAPI (uvicorn) 在 `:81`。

**Spec 文件：** `docs/superpowers/specs/2026-07-07-bilibili-history-module-design.md`
**参考：** API 字段映射见 spec 第 3.2 节；按钮 ID 命名见 spec 第 6.2 节。

---

## Global Constraints

- **零第三方依赖** ——不引入 ECharts / D3 / jQuery；纯 HTML + CSS + 原生 JS。
- **内嵌 view.js 方案** ——不在 TabBoard 同页面之外的独立 HTML；走 AppShell.switchView。
- **不持久化 B 站历史** ——不写入 chrome.storage.local / .session；数据仅在 view 闭包内存中。
- **SESSDATA 脱敏** ——任何 console.warn / console.error / 用户可见日志，**只打印前 4 + 后 4**，不打印原值。
- **导航按钮顺序** ——新按钮 `#bilibiliHistoryViewBtn` 必须放在 6 个现有按钮最后（Timer 之后），HTML 与 JS 同步修改。
- **`render()` 必须更新 `#stats`** ——避免切换视图后头部残留旧文本（即使数据为空也要写一行；空态文本用 `Bili · 等待 cookies`）。
- **CSS 单文件 ≤500 行** ——超过则拆分（按 `modules/<name>/style.css` 模式）。
- **manifest 修改只动 `host_permissions`** ——不动 `permissions`（storage 已有）。
- **每个 task 末尾都必须 commit**。

---

## Task 分解（7 个 task，按依赖顺序）

```
T1  manifest + background → 后端联通测
T2  background 模块骨架 → 单元可调试
T3  view.js 框架 + cookies 解析 → 输入可见
T4  后端对接 + 表格渲染 → 数据展示
T5  柱图（分区 TOP 6 + 时间分布）→ 可视化完整
T6  样式（≤500 行） → 视觉完成
T7  AppShell / HTML / Nav 挂载 → 用户可点开面板
```

---

### Task 1: 修改 manifest + 新建 background 模块骨架（含联通测试）

**Files:**
- Modify: `manifest.json:30-40`（在 `host_permissions` 数组加 `47.110.80.47`）
- Create: `background/bilibili-history.js`
- Modify: `background/index.js:14-15`（在 import 区块加新行；在 listener 注册区块加新行）

**Interfaces:**
- Produces: `bilibili-history.js` 默认导出 `setupBiliHistoryListeners()`；监听 `chrome.runtime.onMessage` 上 `action === 'bilibiliHistory/fetch'` 的消息，调用 `fetch('http://47.110.80.47:81/api/bilibili/history/recent', { method: 'POST', ... })`，将 HTTP 状态码 + body 透传回 view（透传时不做业务码分类，只透传 `{ ok: response.ok, status, body }`）。

- [ ] **Step 1: 在 `manifest.json` 加 `host_permissions`**

打开 `manifest.json`，在 `host_permissions` 数组（如果不存在则补一个）追加：

```json
"host_permissions": [
  "http://47.110.80.47/*"
]
```

如果原 manifest 用的是 `permissions` 字段（MV3 同时支持二选一），则按现有风格保持一致，但确保新 host 在 MV3 允许的字段里。

- [ ] **Step 2: 创建 `background/bilibili-history.js`（联通验证骨架）**

```javascript
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
  console.log(`[bili-history] HTTP ${response.status} in ${elapsed}ms sessdata=${mask(payload?.sessdata)}`);
  return { ok: response.ok, status: response.status, body };
}

export function setupBiliHistoryListeners() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action !== 'bilibiliHistory/fetch') return false;
    handleFetch(msg.payload).then(sendResponse);
    return true; // keep channel open for async sendResponse
  });
}
```

- [ ] **Step 3: 在 `background/index.js` 注册**

打开 `background/index.js`，在 import 区块加：

```javascript
import { setupBiliHistoryListeners } from './bilibili-history.js';
```

在 listener 注册区块（`setupGroupsListeners();` 等调用末尾）加一行：

```javascript
setupBiliHistoryListeners();
```

- [ ] **Step 4: 在扩展里手动验证联通**

Chrome → `chrome://extensions` → 启用 TabBoard 卡片 → 点 service worker 的「Inspect views: service worker」打开 devtools → 看 console：

预期：console 显示 `[TabBoard] Background Service Worker 已启动`，**无红色错误**。

然后在 devtools console 跑：

```javascript
chrome.runtime.sendMessage({ action: 'bilibiliHistory/fetch', payload: { sessdata: '201714ee%2Cfake', extra_cookies: 'buvid3=fake', days: 3, business: 'all', max_pages: 1 } }, r => console.log('TEST_RESPONSE', r))
```

预期（环境无网 / 跨域 / 后端拒）：`{ok: false, status: 0, body: {detail: '网络异常：...'}}` 或 `{ok: false, status: 401, body: {...}}`。即使是失败响应，**没有 Chrome extension error**（即 manifest 加载、消息通道、host_permissions 没问题）。如果返回 `net::ERR_NAME_NOT_RESOLVED` 等裸错误，则应在 `body.detail` 里有 `"网络异常：..."`，证明 catch 块工作。

- [ ] **Step 5: Commit**

```bash
git add manifest.json background/bilibili-history.js background/index.js
git commit -m "feat(bili-history): background 模块骨架 + manifest host_permissions

- background/bilibili-history.js 提供 bilibiliHistory/fetch 消息处理
- manifest.json 加 host_permissions http://47.110.80.47/*
- background/index.js 注册监听
- 网络失败 / 后端拒时统一返回 {ok, status, body}
- SESSDATA 在日志中自动 mask（前 4 + *** + 后 4）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: view.js 框架（输入区 + 解析） —— 不接 API，只接 textarea

**Files:**
- Create: `modules/bilibili-history/index.js`
- Create: `modules/bilibili-history/view.js`
- Create: `modules/bilibili-history/style.css`（此时仅放 reset + 容器骨架）

**Interfaces:**
- Produces: `index.js` 默认导出 `BilibiliHistoryModule`（沿用 BaseModule 风格：`constructor(container, dataManager, eventBus) / init() / render(data) / bindEvents() / destroy()`）。
- Produces: `view.js` 默认导出 `BilibiliHistoryView`，constructor 接收 `dataManager`，方法：`setContainer(container)` / `updateData(data)` / `render()` / `_buildHTML(state)` / `_bindEvents()` / `parseCookies(jsonText)`。

- [ ] **Step 1: 创建 `modules/bilibili-history/index.js`**

```javascript
/**
 * BilibiliHistoryModule - B 站观看历史模块入口
 */

import BilibiliHistoryView from './view.js';

class BilibiliHistoryModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new BilibiliHistoryView(dataManager);
  }

  init() {
    this.view.setContainer(this.container);
  }

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    this.view.bindEvents();
  }

  destroy() {
    this.view.destroy();
  }
}

export default BilibiliHistoryModule;
```

- [ ] **Step 2: 创建 `modules/bilibili-history/view.js`（不含网络，只含解析）**

```javascript
/**
 * BilibiliHistoryView - B 站观看历史面板视图
 * 沿用 BaseModule 风格，render() 必须更新 header 的 #stats
 */

const REQUIRED_NAME = 'SESSDATA';
const EXTRA_FIELDS = ['buvid3', 'bili_jct', 'DedeUserID', 'sid'];

function mask(s) {
  if (!s || s.length < 8) return '***';
  return s.slice(0, 4) + '***' + s.slice(-4);
}

class BilibiliHistoryView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.state = { kind: 'empty' }; // 'empty' | 'loading' | 'error' | 'data'
    this.payload = null;            // { sessdata, extra_cookies }
    this.items = [];
    this.container = null;
    this._eventsBound = false;
  }

  setContainer(container) { this.container = container; }

  updateData(_data) { /* no-op: 本模块不走 storage */ }

  render() {
    if (!this.container) return;
    const stats = document.getElementById('stats');
    if (stats) {
      stats.textContent = this.state.kind === 'data'
        ? `Bili · 近 3 天 ${this.items.length} 条`
        : 'Bili · 等待 cookies';
    }
    this.container.innerHTML = this._buildHTML(this.state);
    this.bindEvents();
  }

  destroy() {
    this.container = null;
    this._eventsBound = false;
  }

  // ---- 解析 ----
  parseCookies(raw) {
    let arr;
    try {
      const parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : null;
    } catch { return { ok: false, error: '请粘贴有效的 JSON 数组' }; }
    if (!arr) return { ok: false, error: '顶层必须是数组' };

    const map = new Map();
    for (const c of arr) {
      if (c && typeof c.name === 'string') map.set(c.name, c.value);
    }
    const sessdata = map.get(REQUIRED_NAME);
    if (!sessdata) return { ok: false, error: '缺少 SESSDATA 字段' };

    const extras = EXTRA_FIELDS
      .filter(n => map.has(n))
      .map(n => `${n}=${map.get(n)}`)
      .join('; ');

    return {
      ok: true,
      payload: { sessdata, extra_cookies: extras },
      masked: { sessdata: mask(sessdata) },
    };
  }

  // ---- HTML / events ----
  _buildHTML(state) {
    if (state.kind === 'empty' || state.kind === 'error') {
      return this._buildForm(state.error || '');
    }
    if (state.kind === 'loading') {
      return `<div class="bili-loading">拉取中…</div>`;
    }
    // 'data' 由后续 task 接管，此处留 stub
    return `<div class="bili-stub">已加载 ${this.items.length} 条（渲染待 Task 4）</div>`;
  }

  _buildForm(errorMsg = '') {
    const sample = `[\n  {"name": "SESSDATA", "value": "你的 SESSDATA 值"},\n  ...\n]`;
    return `
      <div class="bili-form">
        <div class="bili-form-header">
          <h3>📊 B 站近 3 天观看历史</h3>
          <a href="https://www.bilibili.com" target="_blank" class="bili-link">打开 B 站 ↗</a>
        </div>
        ${errorMsg ? `<div class="bili-error">${errorMsg}</div>` : ''}
        <p class="bili-hint">从浏览器 <kbd>F12 → Application → Cookies → https://www.bilibili.com</kbd>，<br>
          全选所有 cookie 复制，粘贴到下方（JSON 数组格式）：</p>
        <textarea id="biliCookieInput" class="bili-textarea" placeholder='${sample}'></textarea>
        <div class="bili-form-actions">
          <button id="biliFetchBtn" class="btn btn-primary">✓ 解析并拉取</button>
        </div>
      </div>`;
  }

  bindEvents() {
    if (this._eventsBound) return;
    const btn = this.container?.querySelector('#biliFetchBtn');
    const ta = this.container?.querySelector('#biliCookieInput');
    if (btn && ta) {
      btn.addEventListener('click', () => {
        const result = this.parseCookies(ta.value.trim());
        if (!result.ok) { this.state = { kind: 'error', error: result.error }; this.render(); return; }
        this.payload = result.payload;
        // Task 4 接管拉取；Task 2 先把状态推进到 loading 验证管道
        this.state = { kind: 'loading', masked: result.masked };
        this.render();
      });
    }
    this._eventsBound = true;
  }
}

export default BilibiliHistoryView;
```

- [ ] **Step 3: 创建 `modules/bilibili-history/style.css`（最小骨架）**

```css
/* B 站历史模块样式 - 占位骨架，Task 6 丰富 */
.bili-form {
  max-width: 720px;
  margin: 24px auto;
  padding: 16px;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  background: #1a1a1a;
  color: #eee;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.bili-form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.bili-link { color: #00aeec; text-decoration: none; font-size: 13px; }
.bili-link:hover { text-decoration: underline; }
.bili-textarea {
  width: 100%;
  min-height: 120px;
  padding: 8px;
  background: #0d0d0d;
  color: #d4d4d4;
  border: 1px solid #333;
  border-radius: 4px;
  font-family: "SF Mono", Consolas, monospace;
  font-size: 12px;
  resize: vertical;
  box-sizing: border-box;
}
.bili-textarea:focus { outline: none; border-color: #00aeec; }
.bili-form-actions { margin-top: 12px; text-align: right; }
.bili-error {
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #3a1a1a;
  border: 1px solid #b94444;
  border-radius: 4px;
  color: #ff8888;
  font-size: 13px;
}
.bili-hint { font-size: 12px; color: #999; line-height: 1.6; }
.bili-hint kbd {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 11px;
  font-family: monospace;
}
.bili-loading { padding: 40px; text-align: center; color: #999; }
.bili-stub { padding: 24px; color: #888; }
```

- [ ] **Step 4: 在 TabBoard 临时挂载（验证 view.js 渲染）**

打开 `modules/tabboard/tabboard.js`，临时在 `_setupViewSwitchButtons()` 内加一行（Task 7 会重构成完整接入）：

```javascript
// TEMP Task 2 hook - 在切换按钮组最末追加一行用于验证
document.getElementById('timerViewBtn')?.insertAdjacentHTML('afterend',
  '<button id="bilibiliHistoryViewBtn" class="nav-btn" title="B 站历史" onclick="window.location.reload()">Bili</button>');
```

打开 `modules/tabboard/tabboard.html`，在 `<link rel="stylesheet" href="../timer/style.css">` 之后加：

```html
<link rel="stylesheet" href="../bilibili-history/style.css">
```

并在 `<div id="timerView" class="view-container" style="display: none;">…</div>` 之后加：

```html
<div id="bilibiliHistoryView" class="view-container" style="display: none;">
  <div id="bilibiliHistoryPanel"></div>
</div>
```

临时在 `tabboard.js` 的 `switchView` 中加分支：

```javascript
case 'bilibili-history':  // 临时，Task 7 替换
  // 行为暂不实现 — Task 7 接完整路径
  console.warn('[temp] bilibili-history case 待 Task 7');
  break;
```

预期（F12 console）：当点击新 Bili 按钮 / 或在 devtools 临时改 UI 验证时，能看见表单出现（粘贴错误 JSON 时显示红条，粘贴合法 JSON 后状态推进到 loading 但卡住 —— 这是预期，因为 Task 4 才接 API）。

- [ ] **Step 5: Commit（仅 view.js + CSS + index.js + 临时 HTML 接入部分）**

```bash
git add modules/bilibili-history/ modules/tabboard/tabboard.html modules/tabboard/tabboard.js
git commit -m "feat(bili-history): 模块骨架 + view.js 输入区解析

- modules/bilibili-history/{index,view}.js + style.css 占位骨架
- view.js 含 parseCookies() 与表单渲染
- tabboard.html/css 临时挂载（Task 7 替换为正式接入）
- 验证管线：粘贴 cookies JSON → 解析后 state 推进到 loading
- 不依赖网络，渲染骨架完整可手测

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 后端对接 —— 从 loading 到 data/error

**Files:**
- Modify: `modules/bilibili-history/view.js:160-200`（替换 `_buildHTML` 的 loading 分支 + bindEvents 调真实拉取 + 新增 `_renderData()` `_renderError()`）

**Interfaces:**
- Produces: `view.js` 新方法 `_fetch(payload, masked)` 调用 `chrome.runtime.sendMessage({action: 'bilibiliHistory/fetch', payload})` 并按 `state.kind` 推进到 `data | error`。

- [ ] **Step 1: 修改 `view.js` 在 `bindEvents()` 的按钮回调里调用 `_fetch()`**

将原 `bindEvents` 中 `btn.addEventListener('click', () => { ... this.state = { kind: 'loading', masked: result.masked }; this.render(); });` 替换为：

```javascript
btn.addEventListener('click', () => {
  const result = this.parseCookies(ta.value.trim());
  if (!result.ok) { this.state = { kind: 'error', error: result.error }; this.render(); return; }
  this.payload = result.payload;
  this.state = { kind: 'loading', masked: result.masked };
  this.render();
  this._fetch(result.payload, result.masked);
});
```

- [ ] **Step 2: 在 `view.js` 类内部新增 `_fetch / _renderData / _renderError / _buildDataHTML`**

```javascript
_fetch(payload, masked) {
  chrome.runtime.sendMessage(
    { action: 'bilibiliHistory/fetch', payload },
    (resp) => {
      if (!resp) {
        this.state = { kind: 'error', error: '扩展通信失败，请重试' };
        this.render();
        return;
      }
      const { ok, status, body } = resp;
      if (ok && body && Array.isArray(body.items)) {
        this.items = body.items;
        this.state = { kind: 'data', masked, meta: body };
        this.render();
      } else {
        const detail = body?.detail || `HTTP ${status}`;
        this.state = { kind: 'error', error: `${detail}`, masked };
        this.render();
      }
    }
  );
}

_buildDataHTML() {
  // Task 4 接管，先 stub
  return `<div class="bili-stub">✓ 数据 ${this.items.length} 条（表格待 Task 4）</div>`;
}

_renderError(msg) {
  return `
    <div class="bili-error-bar">
      <span class="bili-error-icon">⚠</span>
      <span class="bili-error-text">${msg}</span>
      <button class="btn bili-retry" id="biliRetryBtn">重试</button>
    </div>
    ${this._buildForm()}`;
}
```

将 `_buildHTML` 改成：

```javascript
_buildHTML(state) {
  if (state.kind === 'empty') return this._buildForm();
  if (state.kind === 'error' && !state.masked) return this._buildForm(state.error || '');
  if (state.kind === 'loading') return `<div class="bili-loading">拉取中…（${state.masked?.sessdata || '?'}）</div>`;
  if (state.kind === 'error' && state.masked) return this._renderError(state.error);
  if (state.kind === 'data') return this._buildDataHTML();
  return '';
}
```

并在 `bindEvents` 末尾追加重试按钮绑定（`bindEvents` 内部，**不重置 `_eventsBound`**，而是新增一段，每次 render 重绑）：

```javascript
const retry = this.container?.querySelector('#biliRetryBtn');
if (retry && this.payload) retry.addEventListener('click', () => {
  this.state = { kind: 'loading', masked: this.state.masked };
  this.render();
  this._fetch(this.payload, this.state.masked);
});
```

注意：Task 2 中 `bindEvents` 有 `_eventsBound` 防重复绑定逻辑。Task 3 改为 `bindEvents` 每次 render 都跑（删掉 `_eventsBound` 那两行），textarea 元素的 input 不需要重复清理事件；按钮是 render 后替换的 DOM，不会有 stale 监听。

- [ ] **Step 3: 在扩展里手动验证三种错误码分支**

- 测试 1 — SESSDATA 有效（用真实 cookie）：预期看到「拉取中… → 数据 N 条」（Task 4 之前是 stub 文案）
- 测试 2 — 把 sessdata 改成 `xxx_invalid`：手动观察 console 等待 background 输出 `[bili-history] HTTP 401 in XX ms`；UI 应显示红条 `SESSDATA 失效（-101），请重新登录 B 站`
- 测试 3 — 后端暂时改成不同 days 值（如 `days: 100`）：预期红条显示 FastAPI 422 detail

- [ ] **Step 4: Commit**

```bash
git add modules/bilibili-history/view.js
git commit -m "feat(bili-history): 接 background fetch + 错误码分发

- view._fetch() 调 background /bilibiliHistory/fetch
- 401 / 422 / 502 / 500 分支显示对应红条
- 顶部红条 + 重试按钮 + 重试回调复用 payload
- 删 _eventsBound 单次绑定，每次 render 都重绑（DOM 已替换）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 表格渲染（hist 列表）

**Files:**
- Modify: `modules/bilibili-history/view.js:160-200`（重写 `_buildDataHTML()` 真实列表）

**Interfaces:**
- Produces: view.js `_buildDataHTML()` 渲染一个 `<table class="bili-table">` 表格 + 头部统计 + 分页/过滤留待 Task 5。

- [ ] **Step 1: 在 `view.js` 类内部新增一组工具函数**

```javascript
_fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || '—';
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const HH = d.getHours().toString().padStart(2, '0');
  const M  = d.getMinutes().toString().padStart(2, '0');
  return `${mm}-${dd} ${HH}:${M}`;
}
_fmtDuration(s) {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) return `${Math.floor(m/60)}h${m%60}m`;
  return sec > 0 ? `${m}m${sec}s` : `${m}m`;
}
_fmtProgress(progress, duration) {
  if (!duration) return '—';
  const pct = Math.min(100, Math.round((progress / duration) * 100));
  return `${this._fmtDuration(progress)} / ${this._fmtDuration(duration)} · ${pct}%`;
}
_dayBucket(iso) {
  // 返回本地时区的 "MM-DD"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '未知';
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${m}-${day}`;
}
```

- [ ] **Step 2: 重写 `_buildDataHTML()` —— 头部摘要 + 表格**

```javascript
_buildDataHTML() {
  const items = this.items;
  const totalDuration = items.reduce((acc, it) => acc + (it.duration || 0), 0);

  // 按 day 分组（用于渲染分块标题）
  const groups = new Map();
  for (const it of items) {
    const k = this._dayBucket(it.view_at_iso);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const header = `
    <div class="bili-summary">
      <div class="bili-summary-stats">
        <span><b>${items.length}</b> 个视频</span>
        <span class="dot"></span>
        <span>累计时长 <b>${this._fmtDuration(totalDuration)}</b></span>
        <span class="dot"></span>
        <span>窗口 <b>${this.state.meta?.since_iso?.slice(0,10) ?? '?'}</b> → <b>${this.state.meta?.until_iso?.slice(0,10) ?? '?'}</b></span>
        <span class="dot"></span>
        <span>分页 <b>${this.state.meta?.page_count ?? '?'}</b></span>
        <span class="dot"></span>
        <span class="bili-masked">${this.state.masked?.sessdata || ''}</span>
      </div>
      <div class="bili-summary-actions">
        <button id="biliRefreshBtn" class="btn btn-secondary">🔄 重新拉取</button>
        <button id="biliReinputBtn" class="btn">更换 cookies</button>
      </div>
    </div>`;

  const rows = items.map((it, idx) => `
    <tr data-bvid="${it.bvid || ''}" data-aid="${it.aid || ''}">
      <td class="bili-td-time">${this._fmtTime(it.view_at_iso)}</td>
      <td class="bili-td-title">
        <a href="https://www.bilibili.com/video/${it.bvid || ''}" target="_blank" rel="noopener">
          ${this._escape(it.title || '(无标题)')}
        </a>
        ${it.show_title ? `<div class="bili-sub">${this._escape(it.show_title)}</div>` : ''}
      </td>
      <td class="bili-td-author">${this._escape(it.author_name || 'unknown')}</td>
      <td class="bili-td-duration">${this._fmtProgress(it.progress, it.duration)}</td>
      <td class="bili-td-tag">${this._escape(it.tag_name || it.business || '—')}</td>
    </tr>`).join('');

  const table = `
    <table class="bili-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>标题</th>
          <th>UP 主</th>
          <th>进度</th>
          <th>分区</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5" class="bili-empty">近 3 天内无观看记录</td></tr>`}</tbody>
    </table>`;

  return `${header}${table}`;
}

_escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
```

- [ ] **Step 3: 扩展 `bindEvents()` 让 refresh / reinput 按钮工作**

```javascript
const refresh = this.container?.querySelector('#biliRefreshBtn');
if (refresh && this.payload) {
  refresh.addEventListener('click', () => {
    this.state = { kind: 'loading', masked: this.state.masked };
    this.render();
    this._fetch(this.payload, this.state.masked);
  });
}
const reinput = this.container?.querySelector('#biliReinputBtn');
if (reinput) {
  reinput.addEventListener('click', () => {
    this.payload = null;
    this.items = [];
    this.state = { kind: 'empty' };
    this.render();
  });
}
```

- [ ] **Step 4: 在扩展里手动验证表格**

预期：
- 默认 desc 按 `view_at` 倒序（API 返回顺序就是 desc，无需客户端排序）
- 时间列显示 `MM-DD HH:mm`（本地时区）
- 标题点击在新标签页打开对应 bvid
- 累计时长等于所有 `duration` 之和（与 summary 文案一致）
- 重新拉取、拉取中 → 重新拉取三态切换正常
- 更换 cookies 回表单

- [ ] **Step 5: Commit**

```bash
git add modules/bilibili-history/view.js
git commit -m "feat(bili-history): 表格渲染 + 累计时长摘要

- _buildDataHTML() 渲染头部摘要 + 标题/UP主/进度/分区/时间表格
- 时间本地化 (MM-DD HH:mm)
- 进度 = progress/duration + 百分比
- 重新拉取 / 更换 cookies 按钮接好事件
- 标题防 XSS (escapeHtml)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 可视化柱图（分区 TOP 6 + 时间分布）

**Files:**
- Modify: `modules/bilibili-history/view.js`（在 `_buildDataHTML()` 末尾追加 `_buildChartsHTML()`）
- Modify: `modules/bilibili-history/style.css`（加柱图样式）

**Interfaces:**
- Produces: view.js `_buildChartsHTML()` 返回两段：① 分区横向柱图（top 6 tag by count）；② 最近 3 天 × 24h 时长聚合（CSS div 柱）。

- [ ] **Step 1: 在 `view.js` 加 `_topTags()` `_byHourDay()` 聚合函数**

```javascript
_topTags(limit = 6) {
  const counter = new Map();
  for (const it of this.items) {
    const k = it.tag_name || it.business || '其他';
    counter.set(k, (counter.get(k) || 0) + 1);
  }
  const arr = [...counter.entries()].sort((a,b) => b[1]-a[1]).slice(0, limit);
  const max = arr[0]?.[1] || 1;
  return arr.map(([tag, count]) => ({ tag, count, pct: Math.round(count / max * 100) }));
}

_byHourDay() {
  // 返回 { 'MM-DD': [h0..h23 总秒数] }
  const map = new Map();
  for (const it of this.items) {
    const d = new Date(it.view_at_iso);
    if (isNaN(d.getTime())) continue;
    const day = `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
    const hr = d.getHours();
    if (!map.has(day)) map.set(day, new Array(24).fill(0));
    map.get(day)[hr] += it.duration || 0;
  }
  return [...map.entries()].sort(); // 按日期 asc
}
```

- [ ] **Step 2: 在 `_buildDataHTML()` 表格前加 `_buildChartsHTML()` 输出**

```javascript
_buildChartsHTML() {
  const tags = this._topTags();
  const maxTag = tags[0]?.count || 1;
  const tagRows = tags.map(t => `
    <div class="bili-bar-row">
      <span class="bili-bar-label">${this._escape(t.tag)}</span>
      <div class="bili-bar-track"><div class="bili-bar-fill" style="width:${Math.round(t.count/maxTag*100)}%"></div></div>
      <span class="bili-bar-num">${t.count}</span>
    </div>`).join('');

  const byHour = this._byHourDay();
  // 找出所有 day × hour 全集
  const dayMax = byHour.reduce((m, [, arr]) => Math.max(m, ...arr), 1);
  const hourGrid = byHour.map(([day, hours]) => {
    const cells = hours.map(v => {
      const pct = v > 0 ? Math.max(8, Math.round(v/dayMax*100)) : 0;
      return `<div class="bili-hour-cell" style="--pct:${pct}%" title="${day} ${this._fmtDuration(v)}"></div>`;
    }).join('');
    return `<div class="bili-hour-day"><span class="bili-hour-label">${day}</span><div class="bili-hour-row">${cells}</div></div>`;
  }).join('');

  return `
    <div class="bili-charts">
      <section class="bili-chart-block">
        <h4>分区 TOP 6</h4>
        ${tags.length ? tagRows : '<p class="bili-empty-mini">无 tag 数据</p>'}
      </section>
      <section class="bili-chart-block">
        <h4>每天 24h 时长分布</h4>
        ${byHour.length ? hourGrid : '<p class="bili-empty-mini">无时间数据</p>'}
      </section>
    </div>`;
}
```

并在 `_buildDataHTML()` 第 1 行（`const items = this.items;` 之前）加：

```javascript
const charts = this._buildChartsHTML();
```

然后把 `return \`${header}${table}\`;` 改成 `return \`${header}${charts}${table}\`;`

- [ ] **Step 3: 给柱图加 CSS（追加到 style.css 末尾）**

```css
/* 柱图 */
.bili-charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 16px 0;
}
.bili-chart-block {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  padding: 12px;
}
.bili-chart-block h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #aaa;
  font-weight: 500;
}
.bili-bar-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; }
.bili-bar-label { width: 70px; color: #ccc; text-align: right; }
.bili-bar-track { flex: 1; height: 10px; background: #2a2a2a; border-radius: 3px; overflow: hidden; }
.bili-bar-fill { height: 100%; background: linear-gradient(90deg, #00aeec 0%, #fb7299 100%); transition: width 0.4s ease; }
.bili-bar-num { width: 30px; color: #999; text-align: right; }
.bili-hour-day { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
.bili-hour-label { width: 38px; font-size: 11px; color: #888; }
.bili-hour-row { flex: 1; display: grid; grid-template-columns: repeat(24, 1fr); gap: 1px; }
.bili-hour-cell {
  height: 14px;
  background: #1f1f1f;
  border-radius: 2px;
  background: linear-gradient(to top, rgba(0,174,236,0.7) var(--pct), #1f1f1f var(--pct));
}
@media (max-width: 900px) {
  .bili-charts { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: 在扩展里手动验证柱图**

预期：
- 分区 TOP 6 按 count 降序，最长者 100%，其它比例缩放
- 时间分布按最近 3 天 × 24 行 / 列，每格高度反映 `duration / dayMax` 比，最小 8%
- 空数据时显示「无 tag 数据 / 无时间数据」
- 900px 以下窗口，柱图并排变单列

- [ ] **Step 5: 校验 CSS 行数**

```bash
wc -l modules/bilibili-history/style.css
```

预期：≤500 行。超过则把 Task 6 已经做好的样式整批 review，本 task 只 ≤100 行新增。

- [ ] **Step 6: Commit**

```bash
git add modules/bilibili-history/view.js modules/bilibili-history/style.css
git commit -m "feat(bili-history): 柱图（分区 TOP 6 + 24h 热力）

- _topTags() / _byHourDay() 聚合函数
- 分区横向柱图（百分比宽度 + 渐变色）
- 时间热力使用 CSS var(--pct) 控制高度，避免 JS 多次 reflow
- 响应式：< 900px 单列布局

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 错误条样式 + 视觉打磨

**Files:**
- Modify: `modules/bilibili-history/style.css`

**Interfaces:**
- Produces: 表格、表单、按钮的整体视觉与暗色主题一致。

- [ ] **Step 1: 追加表格相关样式到 style.css**

```css
.bili-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 13px;
  color: #ccc;
}
.bili-summary .bili-summary-stats { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bili-summary b { color: #00aeec; font-weight: 600; }
.bili-summary .dot { width: 4px; height: 4px; background: #555; border-radius: 50%; }
.bili-summary .bili-masked { color: #777; font-family: monospace; font-size: 11px; }
.bili-summary-actions { display: flex; gap: 6px; }

.bili-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
  font-size: 13px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  overflow: hidden;
}
.bili-table th, .bili-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #232323;
}
.bili-table thead th {
  background: #222;
  color: #aaa;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.bili-table tbody tr:hover { background: #202020; }
.bili-td-time { white-space: nowrap; color: #888; font-family: monospace; font-size: 12px; }
.bili-td-title a { color: #00aeec; text-decoration: none; }
.bili-td-title a:hover { text-decoration: underline; }
.bili-sub { font-size: 11px; color: #888; margin-top: 2px; }
.bili-td-author { color: #ccc; }
.bili-td-duration { font-family: monospace; font-size: 12px; color: #aaa; white-space: nowrap; }
.bili-td-tag { color: #fb7299; font-size: 11px; }
.bili-empty { padding: 32px; text-align: center; color: #777; }
.bili-empty-mini { color: #777; font-size: 12px; margin: 8px 0; }

.bili-error-bar {
  background: #3a1a1a;
  border: 1px solid #b94444;
  border-radius: 4px;
  padding: 10px 14px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #ffb3b3;
}
.bili-retry { margin-left: auto; }
```

- [ ] **Step 2: 验证 `wc -l` ≤500**

```bash
wc -l modules/bilibili-history/style.css
```

若 >500：从样式中抽出 「表单 / 卡片 / 按钮通用样式」到 `modules/tabboard/tabboard.css` 不可能（会污染），所以更现实做法是「再拆 `modules/bilibili-history/charts.css`」仅包含 .bili-charts / .bili-chart-block / .bili-bar-* / .bili-hour-* 那一组，并在 `style.css` 顶部加 `@import './charts.css';`。本 task 视情况启用。

- [ ] **Step 3: 在扩展里视觉对齐验证**

预期：表格行 hover 灰底、错条背景 #3a1a1a、时间戳等宽字体、tag 粉色与 B 站品牌呼应。

- [ ] **Step 4: Commit**

```bash
git add modules/bilibili-history/style.css
git commit -m "feat(bili-history): 错误条 + 表格视觉打磨

- 表格 hover / 暗色一致 / 等宽时间戳 / B 站粉品牌色
- 错误条 + retry 按钮固定布局
- style.css 行数约束 ≤500（超出时拆 charts.css）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 正式挂载到 AppShell + 删临时接入

**Files:**
- Modify: `modules/tabboard/tabboard.js:8-13, 34-41, 86-104, 116-128`
- Modify: `modules/tabboard/tabboard.html:25-30, 58-61`

**Interfaces:**
- Produces: tabboard.js 完整 `import BilibiliHistoryModule` + `case 'bilibili-history'` 分支 + `_updateViewUI` 切换；tabboard.html 顶部 nav 永久按钮 `#bilibiliHistoryViewBtn` + 视图容器。

- [ ] **Step 1: 改 `modules/tabboard/tabboard.js` 的 import 区块**

把原来 `import TimerModule from '../timer/index.js';` 后追加：

```javascript
import BilibiliHistoryModule from '../bilibili-history/index.js';
```

- [ ] **Step 2: 替换 `_setupViewSwitchButtons()` 末尾**

在 `document.getElementById('timerViewBtn')?.addEventListener('click', () => this.switchView('timer'));` 之后追加：

```javascript
document.getElementById('bilibiliHistoryViewBtn')?.addEventListener('click', () => this.switchView('bilibili-history'));
```

并删除 Task 2 留下的临时 `<button … onclick="window.location.reload()">Bili</button>` 临时接入（一行 in `insertAdjacentHTML`）。

- [ ] **Step 3: 在 `switchView()` switch 中加正式分支**

在 `case 'timer': container = document.getElementById('timerPanel'); ModuleClass = TimerModule; break;` 之后、默认之前，插入：

```javascript
case 'bilibili-history':
  container = document.getElementById('bilibiliHistoryPanel');
  ModuleClass = BilibiliHistoryModule;
  break;
```

把 `Task 2 临时 'console.warn` 那段删除。

- [ ] **Step 4: 在 `_updateViewUI()` 末尾追加**

在 `document.getElementById('timerView').style.display = viewName === 'timer' ? 'block' : 'none';` 之后追加：

```javascript
document.getElementById('bilibiliHistoryViewBtn')?.classList.toggle('active', viewName === 'bilibili-history');
document.getElementById('bilibiliHistoryView').style.display = viewName === 'bilibili-history' ? 'block' : 'none';
```

- [ ] **Step 5: 改 `modules/tabboard/tabboard.html`**

把原来 nav 按钮组末尾的「Task 2 临时 Bili 按钮」删掉（如果还在），并把它替换为正式版（在 `<button id="timerViewBtn" …>Timer</button>` 之后）：

```html
<button id="bilibiliHistoryViewBtn" class="nav-btn" title="B 站历史">Bili</button>
```

视图容器 `<div id="bilibiliHistoryView" …>` 已经在 Task 2 加过，直接保留。

- [ ] **Step 6: 验证 Chrome 扩展加载无错误**

刷新 TabBoard 页面 → F12 console 应无 404 / 模块加载错误。点击 `Bili` 按钮：

预期：从默认视图切到 B 站面板，URL 不变，显示 textarea 空表单；`#stats` 立即变成 `Bili · 等待 cookies`。

- [ ] **Step 7: 端到端验收**

按 spec 第 7.2 节 6 条 acceptance criteria 一一勾对。**关键验收**：
- 切到 Bili 视图后 `#stats` 文本更新
- 粘贴真实 cookies JSON → 点解析 → 看到 90 条近 7 天（实际上 days=3，约 30 条/天，合计可能 > 100 因为分页合理）
- 切到 Group / Timer / LeetCode 再切回 Bili，能保留数据（state 仍在内存）
- 按 Refresh 按钮重拉数据
- 错误路径：故意把 sessdata 改成 `xxx`，看到红条 `SESSDATA 失效（-101），请重新登录 B 站`

- [ ] **Step 8: Commit**

```bash
git add modules/tabboard/tabboard.js modules/tabboard/tabboard.html
git commit -m "feat(bili-history): 正式挂载到 TabBoard AppShell

- tabboard.js：import + switchView 分支 + _updateViewUI 切换
- tabboard.html：永久 nav 按钮 + 视图容器
- 移除 Task 2 的临时 insertAdjacentHTML hack
- 端到端验收：解析 / 拉取 / 错误码 / 切回保留数据 / Refresh

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- [x] **Spec coverage**：
  - 模块三件套 ✓ Task 2、4-6
  - 表格 + 柱图 ✓ Task 4 + 5
  - 错误处理 ✓ Task 3
  - 后端 fetch + manifest ✓ Task 1
  - 不持久化 ✓ Task 7`updateData(_data)` no-op 显式标注
  - `#stats` 必更新 ✓ `render()` 在所有 task 中都覆盖
  - 暗色风格 ✓ Task 6
  - 不引入第三方 ✓ 全程零依赖
- [x] **Placeholder 扫描**：无 TBD / TODO；每个 Step 都给了完整代码块。
- [x] **类型 / 字段名一致**：
  - `state.kind ∈ {'empty','loading','error','data'}` 跨 Task 3 / 4 / 5 一致。
  - message `action` 字符串 `bilibiliHistory/fetch` Task 1 与 Task 3 一致。
  - `payload = { sessdata, extra_cookies }` Task 1 background 与 Task 2-3 view 一致。
  - meta 字段 `body.items` 在 Task 3 / 4 / 5 都一致。
- [x] **风险**：CORS 留作后端运维配置项，本期不动 nginx；用户已验证后端在线。

**Plan complete and saved to `docs/superpowers/plans/2026-07-07-bilibili-history-module.md`.**

下一步走 subagent-driven 模式派工：每个 task 一个 subagent，verify 阶段并行 verify。
