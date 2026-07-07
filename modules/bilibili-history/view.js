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
    if (state.kind === 'empty') return this._buildForm();
    if (state.kind === 'error' && !state.masked) return this._buildForm(state.error || '');
    if (state.kind === 'loading') return `<div class="bili-loading">拉取中…（${state.masked?.sessdata || '?'}）</div>`;
    if (state.kind === 'error' && state.masked) return this._renderError(state.error);
    if (state.kind === 'data') return this._buildDataHTML();
    return '';
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
    const btn = this.container?.querySelector('#biliFetchBtn');
    const ta = this.container?.querySelector('#biliCookieInput');
    if (btn && ta) {
      btn.addEventListener('click', () => {
        const result = this.parseCookies(ta.value.trim());
        if (!result.ok) { this.state = { kind: 'error', error: result.error }; this.render(); return; }
        this.payload = result.payload;
        this.state = { kind: 'loading', masked: result.masked };
        this.render();
        this._fetch(result.payload, result.masked);
      });
    }
    const retry = this.container?.querySelector('#biliRetryBtn');
    if (retry && this.payload) retry.addEventListener('click', () => {
      this.state = { kind: 'loading', masked: this.state.masked };
      this.render();
      this._fetch(this.payload, this.state.masked);
    });
  }

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
}

export default BilibiliHistoryView;
