/**
 * TabBoard Focus Search - 全局标签页搜索浮层
 * 按下 Alt+Shift+S 在当前页面显示模糊搜索浮层
 */

// ========== fuzzyMatchOrdered ==========

function fuzzyMatchOrdered(text, query) {
  if (!text || !query) return true;
  text = text.toLowerCase();
  query = query.toLowerCase();
  let textIdx = 0;
  let queryIdx = 0;
  while (textIdx < text.length && queryIdx < query.length) {
    if (text[textIdx] === query[queryIdx]) queryIdx++;
    textIdx++;
  }
  return queryIdx === query.length;
}

// ========== 评分和排序 ==========

function scoreTab(tab, query) {
  if (!query) return 2;
  const q = query.toLowerCase();
  const title = tab.title || '';
  const url = tab.url || '';
  if (title.toLowerCase() === q) return 100;
  if (title.toLowerCase().startsWith(q)) return 80;
  if (title.toLowerCase().includes(q)) return 60;
  if (url.toLowerCase().includes(q)) return 40;
  if (fuzzyMatchOrdered(title, q)) return 20;
  if (fuzzyMatchOrdered(url, q)) return 10;
  return 0;
}

function filterAndSortTabs(tabs, query) {
  if (!query.trim()) {
    return tabs.map(function(t) { return { tab: t, score: 2 }; });
  }
  return tabs
    .map(function(t) { return { tab: t, score: scoreTab(t, query) }; })
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

function safeUrl(url) {
  if (!url) return '';
  try {
    var parsed = new URL(url);
    var allowed = ['http:', 'https:', 'data:'];
    if (allowed.indexOf(parsed.protocol) !== -1) return url;
  } catch (e) { }
  return '';
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
  footer.innerHTML = '<span><kbd>\u2191</kbd><kbd>\u2193</kbd> \u5bfc\u822a</span><span><kbd>Enter</kbd> \u8df3\u8f6c</span><span><kbd>Esc</kbd> \u5173\u95ed</span>';

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
    filteredResults = filterAndSortTabs(allTabs, query);
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
      filteredResults = allTabs.slice();
      selectedIndex = allTabs.length > 0 ? 0 : -1;
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
    container.innerHTML = '<div class="focus-search-empty">' +
      (query ? '\u6ca1\u6709\u5339\u914d\u7684\u6807\u7b7e\u9875' : '\u6ca1\u6709\u6253\u5f00\u7684\u6807\u7b7e\u9875') +
      '</div>';
    return;
  }

  var htmlParts = [];
  for (var i = 0; i < filteredResults.length; i++) {
    var r = filteredResults[i];
    if (!r || !r.tab || r.tab.id == null) continue;
    var tab = r.tab;
    var isSelected = i === selectedIndex ? ' selected' : '';
    var favicon = safeUrl(tab.favIconUrl);
    var faviconHtml = favicon ? '<img class="focus-search-favicon" src="' + favicon + '" onerror="this.style.opacity=\'0\'">' : '';
    var title = highlightMatch(tab.title || '\u65e0\u6807\u9898', query);
    var url = highlightMatch(tab.url || '', query);
    htmlParts.push(
      '<div class="focus-search-item' + isSelected + '" data-index="' + i + '">' +
      faviconHtml +
      '<div class="focus-search-content">' +
      '<div class="focus-search-title">' + title + '</div>' +
      '<div class="focus-search-url">' + url + '</div>' +
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

// ========== 初始化 ==========

window.__focusSearchReady = true;

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'showFocusSearch') {
    if (overlayEl) closeOverlay();
    createOverlay();
    sendResponse({ success: true });
  }
  return true;
});
