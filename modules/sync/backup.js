/**
 * 独立备份页（modules/sync/backup.html）
 *
 * 设计目标：不经看板、不经 background，直接对 chrome.storage.local 读/写。
 * 这样即使 tabboard 的某个模块或 background 出问题，也能把数据捞出来。
 *
 * 导出 = storage.local.get(null)（全量键值对，不裹信封）
 * 导入 = clear + set（与 background/group-model.js 的 importAllStorage 语义一致）
 */

const $ = (id) => document.getElementById(id);

const btnDownload = $('btnDownload');
const btnCopy = $('btnCopy');
const btnPreview = $('btnPreview');
const preview = $('preview');
const exportHint = $('exportHint');

const fileInput = $('fileInput');
const importInfo = $('importInfo');
const importHint = $('importHint');
const confirmRow = $('confirmRow');
const autoBackupRow = $('autoBackupRow');
const autoBackup = $('autoBackup');
const btnConfirmImport = $('btnConfirmImport');
const btnCancelImport = $('btnCancelImport');

const PREVIEW_MAX_BYTES = 200 * 1024;
const PREVIEW_MAX_KEYS = 40;

let pending = null;      // 待导入的解析结果
let pendingName = '';

/* ── 工具 ───────────────────────────────────────────── */

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function byteLen(str) {
  return new TextEncoder().encode(str).length;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 一句话描述一个 storage 值 */
function summarize(value) {
  if (Array.isArray(value)) return { label: `数组 · ${value.length} 项`, count: value.length };
  if (value && typeof value === 'object') {
    const n = Object.keys(value).length;
    return { label: `对象 · ${n} 个键`, count: n };
  }
  if (typeof value === 'string') return { label: `字符串 · ${value.length} 字符`, count: 1 };
  return { label: typeof value, count: 1 };
}

async function readStorage() {
  return await chrome.storage.local.get(null);
}

/* ── 元信息：扩展 ID 是排查 key 问题的关键 ─────────────── */

function renderMeta() {
  const m = chrome.runtime.getManifest();
  const hasKey = Boolean(m.key);
  const idNote = hasKey
    ? 'ID 由 manifest.key 固定，换机器/换路径都不变'
    : 'ID 由「加载路径」派生，同名不同路径算两个扩展，数据不互通';

  $('meta').innerHTML = `
    <div class="bp-row"><span>扩展 ID</span><code>${chrome.runtime.id}</code></div>
    <div class="bp-row"><span>版本</span><code>${m.version}</code></div>
    <div class="bp-row">
      <span>manifest.key</span>
      <code class="${hasKey ? 'bp-ok' : 'bp-warn'}">${hasKey ? '存在' : '已删除'}</code>
    </div>
  `;
  $('metaHint').innerHTML = idNote;
}

/* ── 数据统计 ───────────────────────────────────────── */

async function renderStats() {
  const all = await readStorage();
  const keys = Object.keys(all).sort();

  if (keys.length === 0) {
    $('stats').innerHTML = '<div class="bp-hint">当前 storage 是空的（或这个扩展 ID 下没有数据）。</div>';
    return;
  }

  const rows = keys.map((k) => {
    const v = all[k];
    const { label } = summarize(v);
    let size = 0;
    try {
      size = byteLen(JSON.stringify(v ?? null));
    } catch {
      size = 0;
    }
    return `<div class="bp-stat-row">
      <span class="bp-stat-key">${k}</span>
      <span class="bp-stat-meta">${label}</span>
      <span class="bp-stat-meta">${fmtBytes(size)}</span>
    </div>`;
  });

  const total = rows.length;
  $('stats').innerHTML =
    `<div class="bp-hint" style="margin:0 0 8px">共 ${total} 个 key</div>` + rows.join('');
}

/* ── 导出 ───────────────────────────────────────────── */

async function currentJSON() {
  const all = await readStorage();
  return { all, text: JSON.stringify(all, null, 2) };
}

btnDownload.addEventListener('click', async () => {
  btnDownload.disabled = true;
  try {
    const { all, text } = await currentJSON();
    if (Object.keys(all).length === 0) {
      exportHint.textContent = '当前没有数据，导出的会是空对象 {}。';
      return;
    }
    download(`tabboard-backup-${timestamp()}.json`, text);
    exportHint.textContent = `已导出 ${Object.keys(all).length} 项 · ${fmtBytes(byteLen(text))}`;
  } catch (e) {
    exportHint.textContent = '导出失败: ' + (e?.message || e);
  } finally {
    btnDownload.disabled = false;
  }
});

btnCopy.addEventListener('click', async () => {
  try {
    const { text } = await currentJSON();
    await navigator.clipboard.writeText(text);
    exportHint.textContent = `已复制到剪贴板 · ${fmtBytes(byteLen(text))}`;
  } catch (e) {
    exportHint.textContent = '复制失败: ' + (e?.message || e);
  }
});

btnPreview.addEventListener('click', async () => {
  if (!preview.hidden) {
    preview.hidden = true;
    btnPreview.textContent = '预览';
    return;
  }
  try {
    const { all, text } = await currentJSON();
    const keys = Object.keys(all);
    let shown = text;

    if (byteLen(text) > PREVIEW_MAX_BYTES || keys.length > PREVIEW_MAX_KEYS) {
      const slice = {};
      keys.slice(0, PREVIEW_MAX_KEYS).forEach((k) => { slice[k] = all[k]; });
      shown = JSON.stringify(slice, null, 2);
      exportHint.textContent =
        `内容较大（${fmtBytes(byteLen(text))} · ${keys.length} 个 key），预览只显示前 ${PREVIEW_MAX_KEYS} 个 key；完整内容请用「下载 JSON」。`;
    } else {
      exportHint.textContent = `${fmtBytes(byteLen(text))} · ${keys.length} 个 key`;
    }

    preview.textContent = shown;
    preview.hidden = false;
    btnPreview.textContent = '收起预览';
  } catch (e) {
    exportHint.textContent = '预览失败: ' + (e?.message || e);
  }
});

/* ── 导入（覆盖式） ─────────────────────────────────── */

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  pending = null;
  pendingName = '';
  importInfo.hidden = true;
  confirmRow.hidden = true;
  autoBackupRow.hidden = true;
  importHint.textContent = '';
  if (!file) return;

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (e) {
    importHint.textContent = '文件不是合法 JSON: ' + (e?.message || e);
    return;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    importHint.textContent = '备份格式错误：顶层必须是对象（键值对字典）。';
    return;
  }

  const incomingKeys = Object.keys(parsed);
  if (incomingKeys.length === 0) {
    importHint.textContent = '这个文件里没有任何 key，导入会清空全部数据。确定要用它吗？';
  }

  const current = await readStorage();
  const currentKeys = Object.keys(current);
  const overwritten = incomingKeys.filter((k) => k in current);
  const added = incomingKeys.filter((k) => !(k in current));
  const lost = currentKeys.filter((k) => !(k in parsed));

  pending = parsed;
  pendingName = file.name;

  importInfo.hidden = false;
  importInfo.innerHTML = `
    <div class="bp-import-title">${file.name} · ${incomingKeys.length} 个 key</div>
    <ul>
      <li>覆盖已有：${overwritten.length} 项${overwritten.length ? `（${overwritten.slice(0, 6).join(', ')}${overwritten.length > 6 ? ' …' : ''}）` : ''}</li>
      <li>新增：${added.length} 项${added.length ? `（${added.slice(0, 6).join(', ')}${added.length > 6 ? ' …' : ''}）` : ''}</li>
      <li>${lost.length ? `<b style="color:var(--bp-danger)">将丢失：${lost.length} 项（当前有、备份里没有）</b>` : '将丢失：0 项'}</li>
    </ul>
  `;

  autoBackupRow.hidden = false;
  confirmRow.hidden = false;
  importHint.textContent = '';
});

btnConfirmImport.addEventListener('click', async () => {
  if (!pending) return;
  btnConfirmImport.disabled = true;
  try {
    let safety = '';
    if (autoBackup.checked) {
      const { all, text } = await currentJSON();
      if (Object.keys(all).length > 0) {
        download(`tabboard-preimport-${timestamp()}.json`, text);
        safety = '（覆盖前的数据已下载）';
      }
    }

    const count = Object.keys(pending).length;
    await chrome.storage.local.clear();
    await chrome.storage.local.set(pending);

    importHint.textContent = `已导入 ${count} 个 key${safety}。刷新看板或重新打开标签页后生效。`;
    importInfo.hidden = true;
    confirmRow.hidden = true;
    autoBackupRow.hidden = true;
    fileInput.value = '';
    pending = null;

    await renderStats();
  } catch (e) {
    importHint.textContent = '导入失败: ' + (e?.message || e);
  } finally {
    btnConfirmImport.disabled = false;
  }
});

btnCancelImport.addEventListener('click', () => {
  pending = null;
  pendingName = '';
  fileInput.value = '';
  importInfo.hidden = true;
  confirmRow.hidden = true;
  autoBackupRow.hidden = true;
  importHint.textContent = '已取消。';
});

/* ── 启动 ───────────────────────────────────────────── */

(async function init() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    document.body.innerHTML =
      '<main class="bp"><div class="bp-card"><h2>环境不正确</h2>' +
      '<p class="bp-hint">这个页面必须作为扩展页面打开（chrome-extension://…/modules/sync/backup.html），直接用文件方式打开读不到数据。</p>' +
      '</div></main>';
    return;
  }
  try {
    renderMeta();
    await renderStats();
  } catch (e) {
    $('stats').innerHTML = `<div class="bp-hint">读取失败: ${e?.message || e}</div>`;
  }
})();
