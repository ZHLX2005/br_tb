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
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '未知';
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${m}-${day}`;
  }

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
    const map = new Map();
    for (const it of this.items) {
      const d = new Date(it.view_at_iso);
      if (isNaN(d.getTime())) continue;
      const day = `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
      const hr = d.getHours();
      if (!map.has(day)) map.set(day, new Array(24).fill(0));
      map.get(day)[hr] += it.duration || 0;
    }
    return [...map.entries()].sort();
  }

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

  _buildDataHTML() {
    const items = this.items;
    const totalDuration = items.reduce((acc, it) => acc + (it.duration || 0), 0);
    const charts = this._buildChartsHTML();

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

    const rows = items.map((it) => `
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

    return `${header}${charts}${table}`;
  }

  _escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
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
