/**
 * TabBoard Focus Search - 全局标签页搜索浮层
 * 按下 Alt+Shift+S 在当前页面显示模糊搜索浮层
 */

// ========== fuzzyMatchOrdered ==========

function fuzzyMatchOrdered(text, query) {
  if (!text || !query) return true;
  text = text.toLowerCase();
  query = query.toLowerCase();
  var textIdx = 0;
  var queryIdx = 0;
  var firstMatch = -1;
  var lastMatch = -1;
  while (textIdx < text.length && queryIdx < query.length) {
    if (text[textIdx] === query[queryIdx]) {
      if (firstMatch === -1) firstMatch = textIdx;
      lastMatch = textIdx;
      queryIdx++;
    }
    textIdx++;
  }
  if (queryIdx !== query.length) return false;
  var span = lastMatch - firstMatch + 1;
  return span <= query.length * 2.5;
}

// ========== 评分和排序 ==========

function getSearchableUrl(url) {
  if (!url) return '';
  try {
    var parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch (e) {
    return url.substring(0, 60);
  }
}

function matchTab(tab, query) {
  var audibleBonus = tab.audible ? 200 : 0;
  if (!query) return { score: 2 + audibleBonus, matchType: '' };
  var q = query.toLowerCase();
  var title = (tab.title || '').toLowerCase();
  var cleanUrl = getSearchableUrl(tab.url).toLowerCase();
  if (title === q) return { score: 100 + audibleBonus, matchType: 'exact' };
  if (title.startsWith(q)) return { score: 80 + audibleBonus, matchType: 'prefix' };
  if (title.includes(q)) return { score: 60 + audibleBonus, matchType: 'contains' };
  if (cleanUrl.includes(q)) return { score: 40 + audibleBonus, matchType: 'url' };
  if (fuzzyMatchOrdered(title, q)) return { score: 20 + audibleBonus, matchType: 'fuzzy' };
  return { score: audibleBonus > 0 ? audibleBonus : 0, matchType: '' };
}

function filterAndSortTabs(tabs, query) {
  if (!query.trim()) {
    return tabs.map(function(t) { return { tab: t, score: 2, matchType: '' }; });
  }
  return tabs
    .map(function(t) {
      var m = matchTab(t, query);
      return { tab: t, score: m.score, matchType: m.matchType };
    })
    .filter(function(r) { return r.score > 0; })
    .sort(function(a, b) { return b.score - a.score; });
}

// ========== 工具函数 ==========

function escapeHtml(text) {
  if (!text) return '';
  var d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  var escaped = escapeHtml(text);
  var regex = new RegExp('(' + escapeRegex(query) + ')', 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function highlightFuzzy(text, query) {
  if (!text || !query) return escapeHtml(text);
  var lowerText = text.toLowerCase();
  var lowerQuery = query.toLowerCase();
  var result = '';
  var queryIdx = 0;
  for (var i = 0; i < text.length; i++) {
    if (queryIdx < lowerQuery.length && lowerText[i] === lowerQuery[queryIdx]) {
      result += '<mark>' + escapeHtml(text[i]) + '</mark>';
      queryIdx++;
    } else {
      result += escapeHtml(text[i]);
    }
  }
  return result;
}

function safeUrl(url) {
  if (!url) return '';
  try {
    var parsed = new URL(url);
    var allowed = ['http:', 'https:', 'data:'];
    if (allowed.indexOf(parsed.protocol) !== -1) return url;
  } catch (e) { }
  return '';
}

// 扩展上下文是否仍然有效（service worker 重启/扩展被卸载后变为 false）
function isExtensionContextAlive() {
  try {
    // chrome.runtime.id 在 context invalidated 时访问会抛错
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

// ========== 浮层状态 ==========

var allTabs = [];
var filteredResults = [];
var selectedIndex = -1;
var overlayEl = null;

// ========== 浮层创建 ==========

function createOverlay() {
  overlayEl = document.createElement('div');
  overlayEl.id = 'focus-search-overlay';

  var modal = document.createElement('div');
  modal.className = 'focus-search-modal';

  var header = document.createElement('div');
  header.className = 'focus-search-header';

  var input = document.createElement('input');
  input.type = 'text';
  input.id = 'focus-search-input';
  input.placeholder = '搜索标签页...';
  input.autocomplete = 'off';
  input.spellcheck = false;
  header.appendChild(input);

  var results = document.createElement('div');
  results.className = 'focus-search-results';
  results.id = 'focus-search-results';

  var footer = document.createElement('div');
  footer.className = 'focus-search-footer';
  footer.innerHTML = '<span><kbd>\u2191</kbd><kbd>\u2193</kbd> \u5bfc\u822a</span><span><kbd>Enter</kbd> \u8df3\u8f6c</span><span><kbd>Esc</kbd> \u5173\u95ed</span><span><kbd>&gt;</kbd> \u7cfb\u7edf\u9875</span>';

  modal.appendChild(header);
  modal.appendChild(results);
  modal.appendChild(footer);
  overlayEl.appendChild(modal);
  document.body.appendChild(overlayEl);

  bindOverlayEvents();
  loadAllTabs();
}

function bindOverlayEvents() {
  var input = document.getElementById('focus-search-input');
  if (!input) return;

  input.addEventListener('input', function() {
    var query = input.value.trim();
    if (isSystemQuery(query)) {
      var sysQuery = query.slice(1).trim();
      filteredResults = filterAndSortSystemPages(sysQuery);
    } else {
      filteredResults = filterAndSortTabs(allTabs, query);
    }
    selectedIndex = filteredResults.length > 0 ? 0 : -1;
    renderResults(query);
  });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigate(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigate(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      jumpToSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeOverlay();
    }
  });

  overlayEl.addEventListener('click', function(e) {
    if (e.target === overlayEl) closeOverlay();
  });

  input.focus();
}

function navigate(delta) {
  if (filteredResults.length === 0) return;
  selectedIndex = (selectedIndex + delta + filteredResults.length) % filteredResults.length;
  renderResults(document.getElementById('focus-search-input').value.trim());
  scrollToSelected();
}

function scrollToSelected() {
  var results = document.getElementById('focus-search-results');
  if (!results) return;
  var selected = results.querySelector('.focus-search-item.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

async function jumpToSelected() {
  if (selectedIndex < 0 || selectedIndex >= filteredResults.length) return;
  var item = filteredResults[selectedIndex];
  if (!item || !item.tab) return;
  var tab = item.tab;

  if (item.kind === 'system') {
    var url = tab.url;
    closeOverlay();
    if (!isExtensionContextAlive()) {
      console.warn('[FocusSearch] Extension context invalidated - please reload the page (Alt+Shift+S).');
      return;
    }
    // 走 openTab（与 modules/timeline 一致，Edge 已验证可打开 edge:// URL）
    // 由 background 直接 chrome.tabs.create，简单可靠
    try {
      chrome.runtime.sendMessage({ action: 'openTab', url: url }, function(response) {
        if (chrome.runtime.lastError) {
          console.warn('[FocusSearch] openTab lastError:', chrome.runtime.lastError.message);
        }
      });
    } catch (e) {
      console.error('[FocusSearch] Failed to open system page:', e);
    }
    return;
  }

  closeOverlay();

  try {
    chrome.runtime.sendMessage({
      action: 'focusSearchSwitchTab',
      url: tab.url
    });
  } catch (e) {
    console.error('[FocusSearch] Failed to switch tab:', e);
  }

  try {
    chrome.runtime.sendMessage({
      action: 'addToHistoryGroup',
      tabInfo: {
        title: tab.title || '',
        url: tab.url || '',
        favicon: tab.favIconUrl || ''
      }
    });
  } catch (e) {
    console.error('[FocusSearch] Failed to add to History:', e);
  }
}

async function loadAllTabs() {
  try {
    var response = await chrome.runtime.sendMessage({ action: 'getAllOpenTabs' });
    if (response && response.success && Array.isArray(response.tabs)) {
      allTabs = response.tabs.filter(function(t) { return t && t.id != null; });
      filteredResults = allTabs.slice(0, 10).map(function(t) {
        return { tab: t, score: 2, matchType: '' };
      });
      selectedIndex = filteredResults.length > 0 ? 0 : -1;
      renderResults('');
    }
  } catch (e) {
    console.error('[FocusSearch] Failed to load tabs:', e);
  }
}

function renderResults(query) {
  var container = document.getElementById('focus-search-results');
  if (!container) return;

  if (filteredResults.length === 0) {
    var emptyMsg;
    if (isSystemQuery(query)) {
      emptyMsg = query.length > 1 ? '\u6ca1\u6709\u5339\u914d\u7684\u7cfb\u7edf\u9875' : '\u6ca1\u6709\u53ef\u7528\u7684\u7cfb\u7edf\u9875';
    } else {
      emptyMsg = query ? '\u6ca1\u6709\u5339\u914d\u7684\u6807\u7b7e\u9875' : '\u6ca1\u6709\u6253\u5f00\u7684\u6807\u7b7e\u9875';
    }
    container.innerHTML = '<div class="focus-search-empty">' + emptyMsg + '</div>';
    return;
  }

  var htmlParts = [];
  for (var i = 0; i < filteredResults.length; i++) {
    var r = filteredResults[i];
    if (!r || !r.tab || r.tab.id == null) continue;
    var tab = r.tab;
    var isSelected = i === selectedIndex ? ' selected' : '';
    var isSystem = r.kind === 'system' ? ' system-source' : '';
    var isGroup = tab.source === 'group' ? ' group-source' : '';
    var audibleIcon = tab.audible ? '<span class="focus-search-audible" title="\u6b63\u5728\u64ad\u653e\u97f3\u9891">\u25cf</span>' : '';

    var faviconHtml = '';
    if (r.kind === 'system') {
      // \u7cfb\u7edf\u9875\u7528\u540d\u79f0\u9996\u5b57\u7b26\u4f5c\u5360\u4f4d\uff08\u4e0d\u4f7f\u7528 emoji\uff09
      var firstChar = (tab.title || '?').charAt(0);
      faviconHtml = '<span class="focus-search-system-icon">' + escapeHtml(firstChar) + '</span>';
    } else {
      var favicon = safeUrl(tab.favIconUrl);
      if (favicon) {
        faviconHtml = '<img class="focus-search-favicon" src="' + favicon + '" onerror="this.style.opacity=\'0\'">';
      }
    }

    var title = r.matchType === 'fuzzy'
      ? highlightFuzzy(tab.title || '\u65e0\u6807\u9898', query)
      : highlightMatch(tab.title || '\u65e0\u6807\u9898', query);

    var rawUrl = tab.url || '';
    var TRUNCATE = 50;
    var shortUrl = rawUrl.length > TRUNCATE ? rawUrl.substring(0, TRUNCATE) + '...' : rawUrl;
    var urlClass = 'focus-search-url';
    var urlHtml;
    if (!query || isSystemQuery(query)) {
      urlHtml = escapeHtml(shortUrl);
    } else {
      var ql = query.toLowerCase();
      if (shortUrl.toLowerCase().indexOf(ql) !== -1) {
        urlHtml = highlightMatch(shortUrl, query);
      } else if (rawUrl.toLowerCase().indexOf(ql) !== -1) {
        urlHtml = highlightMatch(rawUrl, query);
        urlClass += ' expand';
      } else {
        urlHtml = escapeHtml(shortUrl);
      }
    }

    htmlParts.push(
      '<div class="focus-search-item' + isSelected + isGroup + isSystem + '" data-index="' + i + '">' +
      faviconHtml +
      audibleIcon +
      '<div class="focus-search-content">' +
      '<div class="focus-search-title">' + title + '</div>' +
      '<div class="' + urlClass + '">' + urlHtml + '</div>' +
      '</div></div>'
    );
  }
  container.innerHTML = htmlParts.join('');

  var items = container.querySelectorAll('.focus-search-item');
  for (var j = 0; j < items.length; j++) {
    (function(idx) {
      items[idx].addEventListener('click', function() {
        selectedIndex = idx;
        jumpToSelected();
      });
    })(j);
  }
}

function closeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  filteredResults = [];
  selectedIndex = -1;
  allTabs = [];
}

// ========== 开发者系统页面 ==========

// Edge / Chrome 浏览器系统页面
var DEV_PAGES = [
  { name: '扩展管理', path: '/extensions' },
  { name: '快捷键设置', path: '/extensions/shortcuts' },
  { name: '实验功能', path: '/flags' },
  { name: '设置', path: '/settings' },
  { name: '清除浏览数据', path: '/settings/clearBrowserData' },
  { name: '下载', path: '/downloads' },
  { name: '书签', path: '/bookmarks' },
  { name: '历史记录', path: '/history' },
  { name: '已安装应用', path: '/apps' },
  { name: '开发者工具 - 设备', path: '/inspect/#devices' },
  { name: '系统信息', path: '/version' }
];

var BROWSER_PROTOCOL_KEYS = ['Edge', 'Edg', 'EdgA', 'EdgiOS', 'EdgA_iOS'];

function detectBrowserProtocol() {
  var ua = (navigator.userAgent || '');
  for (var i = 0; i < BROWSER_PROTOCOL_KEYS.length; i++) {
    if (ua.indexOf(BROWSER_PROTOCOL_KEYS[i]) !== -1) return 'edge';
  }
  return 'chrome';
}

function isSystemQuery(query) {
  return typeof query === 'string' && query.charAt(0) === '>';
}

// 把一个 DEV_PAGE 转换成与标签页结果同构的对象
function devPageToResult(page) {
  var protocol = detectBrowserProtocol();
  var fullUrl = protocol + ':' + page.path;
  return {
    kind: 'system',
    tab: {
      id: 'system_' + page.path,
      title: page.name,
      url: fullUrl,
      favIconUrl: ''
    },
    icon: page.icon,
    score: 2,
    matchType: ''
  };
}

function matchSystemPage(page, q) {
  var audibleBonus = 0;
  if (!q) return { score: 2 + audibleBonus, matchType: '' };
  var ql = q.toLowerCase();
  var name = (page.name || '').toLowerCase();
  var path = (page.path || '').toLowerCase();
  if (name === ql) return { score: 100 + audibleBonus, matchType: 'exact' };
  if (name.startsWith(ql)) return { score: 80 + audibleBonus, matchType: 'prefix' };
  if (name.includes(ql)) return { score: 60 + audibleBonus, matchType: 'contains' };
  if (path.includes(ql)) return { score: 40 + audibleBonus, matchType: 'url' };
  if (fuzzyMatchOrdered(name, ql)) return { score: 20 + audibleBonus, matchType: 'fuzzy' };
  return { score: 0, matchType: '' };
}

function filterAndSortSystemPages(query) {
  if (!query.trim()) {
    return DEV_PAGES.map(function(p) {
      var r = devPageToResult(p);
      r.score = 2;
      return r;
    });
  }
  return DEV_PAGES
    .map(function(p) {
      var m = matchSystemPage(p, query);
      return {
        kind: 'system',
        tab: { id: 'system_' + p.path, title: p.name, url: detectBrowserProtocol() + ':' + p.path, favIconUrl: '' },
        icon: p.icon,
        score: m.score,
        matchType: m.matchType
      };
    })
    .filter(function(r) { return r.score > 0; })
    .sort(function(a, b) { return b.score - a.score; });
}

// ========== 初始化 ==========

window.__focusSearchReady = true;

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'showFocusSearch') {
    if (overlayEl) closeOverlay();
    createOverlay();

    // 打开后把焦点移到浮层输入框，防止按键继续写入原来的输入框
    setTimeout(() => {
      const input = document.getElementById('focus-search-input');
      if (input) input.focus();
    }, 10);

    sendResponse({ success: true });
  }
  return true;
});
