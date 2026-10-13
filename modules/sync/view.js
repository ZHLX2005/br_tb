/**
 * SyncView - 数据同步 / native host 管理视图
 *
 * 由 popup 迁入（popup 只留轻量快捷操作，数据管理这类重交互放到看板页）。
 * 三块：native host 状态与控制 / 同步到本地 / 全量备份。
 *
 * 事件用容器委托绑定一次（render 多次不会堆叠监听器）—— 见 module-extension-guide §7。
 */
class SyncView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.container = null;
    this.storage = {};           // 最近一次 storage dump（用于统计展示）
    this._delegationBound = false;
  }

  setContainer(container) {
    this.container = container;
  }

  updateData(data) {
    this.storage = data || {};
    this.render();
  }

  async init() {
    this._wireDelegation();
    await this.refreshHostStatus();
  }

  render() {
    if (!this.container) return;

    // 头部统计（tabboard.js 强制要求 render 更新 #stats，避免切视图残留"加载中"）
    const stats = document.getElementById('stats');
    if (stats) {
      const keys = Object.keys(this.storage || {}).length;
      stats.textContent = `同步 · ${keys} 项本地数据`;
    }

    this.container.innerHTML = `
      <div class="sync-page">
        <section class="sync-card">
          <h2 class="sync-card-title">Native Host</h2>
          <div class="sync-status-row">
            <span id="syncHostDot" class="sync-dot"></span>
            <span id="syncHostText" class="sync-status-text">检查中…</span>
          </div>
          <div class="sync-btn-row">
            <button class="sync-btn" data-act="host-start">启动</button>
            <button class="sync-btn sync-btn-ghost" data-act="host-stop">关闭</button>
            <button class="sync-btn sync-btn-ghost" data-act="host-check">检查</button>
          </div>
          <div id="syncHostDetail" class="sync-detail"></div>
        </section>

        <section class="sync-card">
          <h2 class="sync-card-title">同步到本地数据湖</h2>
          <p class="sync-hint">把当前浏览器的全部数据写入 <code>~/.tabboard/lake/</code>，之后可用 <code>nx-tb tb list</code> 读取。</p>
          <div class="sync-btn-row">
            <button class="sync-btn sync-btn-primary" data-act="sync">同步到本地</button>
            <span id="syncLastHint" class="sync-hint sync-hint-inline"></span>
          </div>
        </section>

        <section class="sync-card">
          <h2 class="sync-card-title">全量备份</h2>
          <p class="sync-hint">导出为 JSON 文件，或从备份文件整库还原（会覆盖当前全部数据）。</p>
          <div class="sync-btn-row">
            <button class="sync-btn" data-act="export">导出全部数据</button>
            <button class="sync-btn sync-btn-ghost" data-act="import">导入备份</button>
          </div>
          <input type="file" id="syncImportInput" accept="application/json,.json" hidden>
        </section>
      </div>
    `;

    this._renderHostStatus(this._lastStatus || {});
  }

  /** 容器委托：渲染多少次都只绑一次 */
  _wireDelegation() {
    if (this._delegationBound || !this.container) return;
    this.container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'host-start') this._hostStart();
      else if (act === 'host-stop') this._hostStop();
      else if (act === 'host-check') this._hostCheck();
      else if (act === 'sync') this._sync();
      else if (act === 'export') this._export();
      else if (act === 'import') this.container.querySelector('#syncImportInput')?.click();
    });
    this.container.addEventListener('change', (e) => {
      if (e.target?.id === 'syncImportInput') this._import(e.target);
    });
    this._delegationBound = true;
  }

  destroy() {
    // 委托挂在 container 上；container 是 tabboard 的固定 div，不需要解绑
    // （模块切换时 tabboard.js 会清容器 innerHTML，委托随元素存活但操作的是新 DOM）
    this._delegationBound = false;
    if (this.container) this.container.innerHTML = '';
  }

  // ---- native host ----

  async refreshHostStatus() {
    try {
      const st = await chrome.runtime.sendMessage({ action: 'hostStatus' });
      this._lastStatus = st || {};
    } catch {
      this._lastStatus = {};
    }
    this._renderHostStatus(this._lastStatus);
  }

  _renderHostStatus(st) {
    const dot = this.container?.querySelector('#syncHostDot');
    const text = this.container?.querySelector('#syncHostText');
    if (!dot || !text) return;

    if (st.connected) {
      dot.dataset.state = 'ok';
      text.textContent = `已连接 · host v${st.hostInfo?.version ?? '?'}`;
    } else if (st.lastError) {
      dot.dataset.state = 'err';
      text.textContent = '错误：' + st.lastError;
    } else {
      dot.dataset.state = 'idle';
      text.textContent = '未启动（同步时按需自动拉起）';
    }
  }

  async _hostStart() {
    const text = this.container.querySelector('#syncHostText');
    if (text) text.textContent = '连接中…';
    try {
      const r = await chrome.runtime.sendMessage({ action: 'hostStart' });
      if (!r?.success) this._setDetail('启动失败: ' + (r?.error || '未知错误'));
      else this._setDetail('');
    } catch (e) {
      this._setDetail('启动失败: ' + (e?.message || e));
    }
    await this.refreshHostStatus();
  }

  async _hostStop() {
    try {
      await chrome.runtime.sendMessage({ action: 'hostStop' });
    } catch { /* 忽略 */ }
    await this.refreshHostStatus();
  }

  async _hostCheck() {
    this._setDetail('检查中…');
    try {
      const r = await chrome.runtime.sendMessage({ action: 'hostCall', command: 'doctor' });
      if (r?.success && r.resp?.status === 'ok') {
        this._setDetail(this._formatDoctor(r.resp.data));
      } else {
        this._setDetail('检查失败: ' + (r?.error || r?.resp?.message || '未知错误'));
      }
    } catch (e) {
      this._setDetail('检查失败: ' + (e?.message || e));
    }
  }

  _formatDoctor(d = {}) {
    const lines = [`host v${d.version} · ${d.allOk ? '全部检查通过' : d.summary}`];
    const lake = (d.checks || []).find((c) => c.name === 'lake-writable');
    if (lake?.path) lines.push(`数据湖: ${lake.path}`);
    const backup = (d.checks || []).find((c) => c.name === 'last-backup');
    if (backup?.detail?.present) {
      lines.push(`上次同步: ${backup.detail.ts}（${backup.detail.wrote} 条）`);
    }
    const bad = (d.checks || []).filter((c) => !c.ok);
    if (bad.length) lines.push('异常项: ' + bad.map((c) => c.name).join(', '));
    return lines.join('\n');
  }

  _setDetail(msg) {
    const el = this.container?.querySelector('#syncHostDetail');
    if (el) el.textContent = msg || '';
  }

  // ---- 同步 / 备份 ----

  async _sync() {
    const hint = this.container.querySelector('#syncLastHint');
    if (hint) hint.textContent = '同步中…';
    try {
      const r = await chrome.runtime.sendMessage({ action: 'tbSyncToLocal' });
      if (r?.success) {
        if (hint) hint.textContent = `已同步 ${r.wrote} 条（${(r.kinds || []).slice(0, 3).join(', ')}…）`;
      } else {
        if (hint) hint.textContent = '';
        this._setDetail(r?.error || '同步失败');
        if (r?.needInit) this._setDetail('native host 未注册。请在终端运行: npx nx-tb init（只需一次）');
      }
    } catch (e) {
      if (hint) hint.textContent = '';
      this._setDetail('同步失败: ' + (e?.message || e));
    }
  }

  async _export() {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'exportAllStorage' });
      if (!r?.success) return this._setDetail('导出失败: ' + (r?.error || '未知错误'));
      const data = r.data || {};
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tabboard-backup-${this._timestamp()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this._setDetail(`已导出 ${Object.keys(data).length} 项数据`);
    } catch (e) {
      this._setDetail('导出失败: ' + (e?.message || e));
    }
  }

  async _import(input) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return this._setDetail('备份文件格式错误（必须是对象）');
      }
      const r = await chrome.runtime.sendMessage({ action: 'importAllStorage', data: parsed });
      if (!r?.success) return this._setDetail('导入失败: ' + (r?.error || '未知错误'));
      this._setDetail(`已导入 ${Object.keys(parsed).length} 项数据（刷新后生效）`);
    } catch (e) {
      this._setDetail('导入失败: ' + (e?.message || e));
    } finally {
      input.value = '';
    }
  }

  _timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
}

export default SyncView;
