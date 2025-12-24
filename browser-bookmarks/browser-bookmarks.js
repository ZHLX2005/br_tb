// 全局变量存储所有书签
let allBookmarks = [];
let bookmarkTree = [];

// 获取所有书签
function loadBookmarks() {
  chrome.bookmarks.getTree((bookmarkTreeNodes) => {
    bookmarkTree = bookmarkTreeNodes;
    allBookmarks = flattenBookmarks(bookmarkTreeNodes);
    updateStats();
    renderBookmarks(bookmarkTreeNodes);
  });
}

// 扁平化书签树，用于搜索
function flattenBookmarks(nodes) {
  let bookmarks = [];
  nodes.forEach(node => {
    if (node.url) {
      bookmarks.push({
        id: node.id,
        title: node.title,
        url: node.url,
        dateAdded: node.dateAdded,
        dateGroupModified: node.dateGroupModified,
        index: node.index,
        parentId: node.parentId
      });
    }
    if (node.children) {
      bookmarks = bookmarks.concat(flattenBookmarks(node.children));
    }
  });
  return bookmarks;
}

// 更新统计信息
function updateStats() {
  const stats = document.getElementById('stats');
  stats.textContent = `共 ${allBookmarks.length} 个书签`;
}

// 渲染书签树
function renderBookmarks(nodes, container = null, level = 0) {
  if (!container) {
    container = document.getElementById('bookmarksContainer');
    container.innerHTML = '';
  }

  if (nodes.length === 0) {
    container.innerHTML = '<div class="empty">暂无书签</div>';
    return;
  }

  nodes.forEach(node => {
    if (node.url) {
      // 这是一个书签
      const bookmarkItem = createBookmarkItem(node);
      container.appendChild(bookmarkItem);
    } else if (node.children && node.children.length > 0) {
      // 这是一个文件夹
      const folder = createFolder(node, level);
      container.appendChild(folder);
    }
  });
}

// 创建书签项
function createBookmarkItem(bookmark) {
  const div = document.createElement('div');
  div.className = 'bookmark-item';
  div.dataset.url = bookmark.url;

  // 获取 favicon
  const url = new URL(bookmark.url);
  const faviconUrl = `chrome://favicon/${url.origin}`;

  div.innerHTML = `
    <div class="bookmark-favicon">
      <img src="${faviconUrl}" alt="" onerror="this.style.display='none'">
    </div>
    <div class="bookmark-info">
      <div class="bookmark-title">${escapeHtml(bookmark.title || '无标题')}</div>
      <div class="bookmark-url">${escapeHtml(bookmark.url)}</div>
    </div>
    <div class="bookmark-date">${formatDate(bookmark.dateAdded)}</div>
  `;

  div.addEventListener('click', () => {
    chrome.tabs.create({ url: bookmark.url });
  });

  return div;
}

// 创建文件夹
function createFolder(folderNode, level) {
  const div = document.createElement('div');
  div.className = 'folder';

  const header = document.createElement('div');
  header.className = 'folder-header';

  const title = document.createElement('div');
  title.className = 'folder-title';
  title.textContent = folderNode.title || '未命名文件夹';

  const count = document.createElement('div');
  count.className = 'folder-count';
  const bookmarkCount = countBookmarks(folderNode);
  count.textContent = `${bookmarkCount} 个书签`;

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'toggle-btn';
  toggleBtn.innerHTML = '&#9662;'; // 向下箭头

  header.appendChild(title);
  header.appendChild(count);
  header.appendChild(toggleBtn);

  const content = document.createElement('div');
  content.className = 'folder-content';

  if (level === 0) {
    content.classList.add('active');
    toggleBtn.classList.add('expanded');
  }

  div.appendChild(header);
  div.appendChild(content);

  // 渲染子项
  folderNode.children.forEach(child => {
    if (child.url) {
      const bookmarkItem = createBookmarkItem(child);
      content.appendChild(bookmarkItem);
    } else if (child.children && child.children.length > 0) {
      const nestedFolder = createFolder(child, level + 1);
      nestedFolder.classList.add('nested-folder');
      content.appendChild(nestedFolder);
    }
  });

  // 切换展开/收起
  header.addEventListener('click', () => {
    content.classList.toggle('active');
    toggleBtn.classList.toggle('expanded');
  });

  return div;
}

// 计算文件夹中的书签数量
function countBookmarks(node) {
  let count = 0;
  if (node.url) {
    return 1;
  }
  if (node.children) {
    node.children.forEach(child => {
      count += countBookmarks(child);
    });
  }
  return count;
}

// 格式化日期
function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

  return date.toLocaleDateString('zh-CN');
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 搜索书签
function searchBookmarks(query) {
  const container = document.getElementById('bookmarksContainer');
  container.innerHTML = '';

  if (!query.trim()) {
    renderBookmarks(bookmarkTree);
    return;
  }

  const lowerQuery = query.toLowerCase();
  const filtered = allBookmarks.filter(bookmark =>
    (bookmark.title && bookmark.title.toLowerCase().includes(lowerQuery)) ||
    (bookmark.url && bookmark.url.toLowerCase().includes(lowerQuery))
  );

  if (filtered.length === 0) {
    container.innerHTML = '<div class="no-results">未找到匹配的书签</div>';
    return;
  }

  const div = document.createElement('div');
  div.innerHTML = `<div style="margin-bottom: 20px; color: #666;">找到 ${filtered.length} 个结果</div>`;

  filtered.forEach(bookmark => {
    const bookmarkItem = createBookmarkItem(bookmark);
    div.appendChild(bookmarkItem);
  });

  container.appendChild(div);
}

// 防抖函数
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
  loadBookmarks();

  // 搜索功能
  const searchInput = document.getElementById('searchInput');
  const debouncedSearch = debounce((query) => {
    searchBookmarks(query);
  }, 300);

  searchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });
});

// 监听书签变化
chrome.bookmarks.onCreated.addListener(() => loadBookmarks());
chrome.bookmarks.onRemoved.addListener(() => loadBookmarks());
chrome.bookmarks.onChanged.addListener(() => loadBookmarks());
chrome.bookmarks.onMoved.addListener(() => loadBookmarks());
chrome.bookmarks.onChildrenReordered.addListener(() => loadBookmarks());
