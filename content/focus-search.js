/**
 * TabBoard Focus Search - 全局标签页搜索浮层
 * 按下 Alt+Shift+S 在当前页面显示模糊搜索浮层
 */

// ========== fuzzyMatchOrdered（复用自 timeline.js）==========

function fuzzyMatchOrdered(text, query) {
  if (!text || !query) return true;
  text = text.toLowerCase();
  query = query.toLowerCase();
  let textIdx = 0, queryIdx = 0;
  while (textIdx < text.length && queryIdx < query.length) {
    if (text[textIdx] === query[queryIdx]) queryIdx++;
    textIdx++;
  }
  return queryIdx === query.length;
}

// ========== 评分和排序函数==========

function scoreTab(tab, query) {
  if (!query) return 2; // 无搜索词时按原始顺序
  const q = query.toLowerCase();
  const title = tab.title || '';
  const url = tab.url || '';

  if (title.toLowerCase() === q) return 100;           // 精确标题匹配
  if (title.toLowerCase().startsWith(q)) return 80;    // 标题开头匹配
  if (title.toLowerCase().includes(q)) return 60;      // 标题包含匹配
  if (url.toLowerCase().includes(q)) return 40;        // URL包含匹配
  if (fuzzyMatchOrdered(title, q)) return 20;           // 模糊匹配
  if (fuzzyMatchOrdered(url, q)) return 10;            // URL模糊匹配
  return 0;
}

function filterAndSortTabs(tabs, query) {
  if (!query.trim()) {
    return tabs.map(t => ({ tab: t, score: 2 }));
  }
  return tabs
    .map(t => ({ tab: t, score: scoreTab(t, query) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ========== 高亮搜索词==========

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(text) {
  if (!text) return '';
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// Safe URL for img src - only allow http/https/data schemes
function safeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (['http:', 'https:', 'data:'].includes(parsed.protocol)) {
      return url;
    }
  } catch {}
  return '';
}

// ========== 浮层核心逻辑==========

let allTabs = [];
let filteredResults = [];
let selectedIndex = 0;
let overlayEl = null;

function createOverlay() {
  // 遮罩
  overlayEl = document.createElement('div');
  overlayEl.id = 'focus-search-overlay';

  // 模态框
  const modal = document.createElement('div');
  modal.className = 'focus-search-modal';

  // 头部
  const header = document.createElement('div');
  header.className = 'focus-search-header';
  header.innerHTML = `
    <input type="text"
           id="focus-search-input"
           placeholder="搜索标签页..."
           autocomplete="off"
           spellcheck="false"
           autofocus>
  `;

  // 结果区
  const results = document.createElement('div');
  results.className = 'focus-search-results';
  results.id = 'focus-search-results';

  // 底部提示
  const footer = document.createElement('div');
  footer.className = 'focus-search-footer';
  footer.innerHTML = `
    <span><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
    <span><kbd>Enter</kbd> 跳转</span>
    <span><kbd>Esc</kbd> 关闭</span>
  `;

  modal.appendChild(header);
  modal.appendChild(results);
  modal.appendChild(footer);
  overlayEl.appendChild(modal);
  document.body.appendChild(overlayEl);

  // 事件绑定
  bindOverlayEvents();

  // 加载所有标签页
  loadAllTabs();
}

function bindOverlayEvents() {
  const input = document.getElementById('focus-search-input');
  const results = document.getElementById('focus-search-results');

  // 输入搜索
  input.addEventListener('input', () => {
    const query = input.value.trim();
    filteredResults = filterAndSortTabs(allTabs, query);
    selectedIndex = filteredResults.length > 0 ? 0 : -1;
    renderResults(query);
  });

  // 键盘导航
  input.addEventListener('keydown', (e) => {
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

  // 点击遮罩关闭
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) {
      closeOverlay();
    }
  });
}

function navigate(delta) {
  if (filteredResults.length === 0) return;
  selectedIndex = (selectedIndex + delta + filteredResults.length) % filteredResults.length;
  renderResults(document.getElementById('focus-search-input').value.trim());
  scrollToSelected();
}

function scrollToSelected() {
  const results = document.getElementById('focus-search-results');
  const selected = results?.querySelector('.focus-search-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

async function jumpToSelected() {
  if (selectedIndex < 0 || selectedIndex >= filteredResults.length) return;
  const { tab } = filteredResults[selectedIndex];

  // 关闭浮层
  closeOverlay();

  // 跳转标签页
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (e) {
    console.error('[FocusSearch] Failed to switch tab:', e);
  }

  // 添加到 History 分组
  try {
    await chrome.runtime.sendMessage({
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
    const response = await chrome.runtime.sendMessage({ action: 'getAllOpenTabs' });
    if (response && response.success) {
      allTabs = response.tabs || [];
      filteredResults = [...allTabs];
      selectedIndex = allTabs.length > 0 ? 0 : -1;
      renderResults('');
    }
  } catch (e) {
    console.error('[FocusSearch] Failed to load tabs:', e);
  }
}

function renderResults(query) {
  const container = document.getElementById('focus-search-results');
  if (!container) return;

  if (filteredResults.length === 0) {
    container.innerHTML = `<div class="focus-search-empty">${query ? '没有匹配的标签页' : '没有打开的标签页'}</div>`;
    return;
  }

  container.innerHTML = filteredResults.map(({ tab }, idx) => `
    <div class="focus-search-item ${idx === selectedIndex ? 'selected' : ''}"
         data-index="${idx}"
         data-tab-id="${tab.id}">
      <img class="focus-search-favicon"
           src="${safeUrl(tab.favIconUrl)}"
           onerror="this.style.opacity='0'">
      <div class="focus-search-content">
        <div class="focus-search-title">${highlightMatch(tab.title || '无标题', query)}</div>
        <div class="focus-search-url">${highlightMatch(tab.url || '', query)}</div>
      </div>
    </div>
  `).join('');

  // 点击结果项跳转
  container.querySelectorAll('.focus-search-item').forEach(item => {
    item.addEventListener('click', async () => {
      const idx = parseInt(item.dataset.index, 10);
      if (!isNaN(idx) && idx >= 0 && idx < filteredResults.length) {
        selectedIndex = idx;
        await jumpToSelected();
      }
    });
  });
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

// ========== 初始化==========

// 监听 background 发来的显示消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showFocusSearch') {
    // 如果浮层已存在，先关闭再重新打开
    if (overlayEl) {
      closeOverlay();
    }
    createOverlay();
    sendResponse({ success: true });
  }
  return true;
});
