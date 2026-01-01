// 全局变量存储所有书签
let allBookmarks = [];
let allFolders = [];
let bookmarkTree = [];

// 获取所有书签
function loadBookmarks() {
  chrome.bookmarks.getTree((bookmarkTreeNodes) => {
    bookmarkTree = bookmarkTreeNodes;
    allBookmarks = flattenBookmarks(bookmarkTreeNodes);
    allFolders = collectFolders(bookmarkTreeNodes);

    // 跳过根节点，直接渲染子节点
    const children = [];
    bookmarkTreeNodes.forEach(rootNode => {
      if (rootNode.children) {
        children.push(...rootNode.children);
      }
    });

    updateStats();
    renderBookmarks(children);
  });
}

// 收集所有文件夹
function collectFolders(nodes, folders = [], path = '') {
  nodes.forEach(node => {
    // 跳过没有标题的根节点
    if (!node.url) {
      // 如果是根节点（没有title），直接处理子节点
      if (!node.title && node.children) {
        collectFolders(node.children, folders, '');
        return;
      }

      const currentPath = path ? `${path} / ${node.title || '未命名'}` : (node.title || '未命名');
      folders.push({
        id: node.id,
        title: node.title || '未命名文件夹',
        path: currentPath
      });
      if (node.children) {
        collectFolders(node.children, folders, currentPath);
      }
    }
  });
  return folders;
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
  div.dataset.id = bookmark.id;
  div.draggable = true;

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
    <div class="bookmark-actions">
      <button class="btn btn-sm btn-primary" data-action="editBookmark" data-id="${bookmark.id}" title="编辑">✏️</button>
      <button class="btn btn-sm btn-primary" data-action="moveBookmark" data-id="${bookmark.id}" title="移动">📁</button>
      <button class="btn btn-sm btn-danger" data-action="deleteBookmark" data-id="${bookmark.id}" title="删除">🗑️</button>
    </div>
  `;

  // 点击打开书签
  div.addEventListener('click', (e) => {
    if (!e.target.closest('.bookmark-actions')) {
      chrome.tabs.create({ url: bookmark.url });
    }
  });

  // 拖拽事件
  div.addEventListener('dragstart', (e) => {
    div.classList.add('dragging');
    e.dataTransfer.setData('text/plain', bookmark.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!div.classList.contains('dragging')) {
      div.classList.add('drag-over');
    }
  });

  div.addEventListener('dragleave', () => {
    div.classList.remove('drag-over');
  });

  div.addEventListener('drop', (e) => {
    e.preventDefault();
    div.classList.remove('drag-over');
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId !== bookmark.id) {
      chrome.bookmarks.get(bookmark.id, (results) => {
        const targetParentId = results[0].parentId;
        const targetIndex = results[0].index;
        moveBookmarkTo(draggedId, targetParentId, targetIndex);
      });
    }
  });

  return div;
}

// 创建文件夹
function createFolder(folderNode, level) {
  const div = document.createElement('div');
  div.className = 'folder';
  div.dataset.folderId = folderNode.id;

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

  const folderActions = document.createElement('div');
  folderActions.className = 'folder-actions';
  folderActions.innerHTML = `
    <button class="btn btn-sm btn-primary" data-action="addBookmarkToFolder" data-id="${folderNode.id}" title="添加书签">➕</button>
    <button class="btn btn-sm btn-danger" data-action="deleteFolder" data-id="${folderNode.id}" title="删除文件夹">🗑️</button>
  `;

  header.appendChild(title);
  header.appendChild(count);
  header.appendChild(folderActions);
  header.appendChild(toggleBtn);

  const content = document.createElement('div');
  content.className = 'folder-content';
  content.dataset.folderId = folderNode.id;

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
  header.addEventListener('click', (e) => {
    if (!e.target.closest('.folder-actions')) {
      content.classList.toggle('active');
      toggleBtn.classList.toggle('expanded');
    }
  });

  // 文件夹拖拽支持
  content.addEventListener('dragover', (e) => {
    e.preventDefault();
    content.classList.add('drag-over-folder');
  });

  content.addEventListener('dragleave', () => {
    content.classList.remove('drag-over-folder');
  });

  content.addEventListener('drop', (e) => {
    e.preventDefault();
    content.classList.remove('drag-over-folder');
    const draggedId = e.dataTransfer.getData('text/plain');
    const targetFolderId = content.dataset.folderId;
    moveBookmarkTo(draggedId, targetFolderId);
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
    // 跳过根节点，直接渲染子节点
    const children = [];
    bookmarkTree.forEach(rootNode => {
      if (rootNode.children) {
        children.push(...rootNode.children);
      }
    });
    renderBookmarks(children);
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

// ==================== 弹窗控制 ====================

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// 填充文件夹选择器
function populateFolderSelect(selectId, selectedId = null) {
  const select = document.getElementById(selectId);
  select.innerHTML = '';
  allFolders.forEach(folder => {
    const option = document.createElement('option');
    option.value = folder.id;
    option.textContent = folder.path;
    if (selectedId && folder.id === selectedId) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

// ==================== 添加书签 ====================

function openAddBookmarkModal() {
  populateFolderSelect('newBookmarkParent');
  document.getElementById('newBookmarkTitle').value = '';
  document.getElementById('newBookmarkUrl').value = '';
  openModal('addBookmarkModal');
}

function openAddBookmarkToFolderModal(folderId) {
  populateFolderSelect('newBookmarkParent', folderId);
  document.getElementById('newBookmarkTitle').value = '';
  document.getElementById('newBookmarkUrl').value = '';
  openModal('addBookmarkModal');
}

document.getElementById('addBookmarkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = document.getElementById('newBookmarkTitle').value;
  const url = document.getElementById('newBookmarkUrl').value;
  const parentId = document.getElementById('newBookmarkParent').value;

  chrome.bookmarks.create({
    parentId: parentId,
    title: title,
    url: url
  }, () => {
    closeModal('addBookmarkModal');
    loadBookmarks();
  });
});

// ==================== 添加文件夹 ====================

function openAddFolderModal() {
  populateFolderSelect('newFolderParent');
  document.getElementById('newFolderTitle').value = '';
  openModal('addFolderModal');
}

document.getElementById('addFolderForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = document.getElementById('newFolderTitle').value;
  const parentId = document.getElementById('newFolderParent').value;

  chrome.bookmarks.create({
    parentId: parentId,
    title: title
  }, () => {
    closeModal('addFolderModal');
    loadBookmarks();
  });
});

// ==================== 编辑书签 ====================

function openEditBookmarkModal(bookmarkId) {
  chrome.bookmarks.get(bookmarkId, (results) => {
    const bookmark = results[0];
    document.getElementById('editBookmarkId').value = bookmark.id;
    document.getElementById('editBookmarkTitle').value = bookmark.title;
    document.getElementById('editBookmarkUrl').value = bookmark.url;
    openModal('editBookmarkModal');
  });
}

document.getElementById('editBookmarkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('editBookmarkId').value;
  const title = document.getElementById('editBookmarkTitle').value;
  const url = document.getElementById('editBookmarkUrl').value;

  chrome.bookmarks.update(id, {
    title: title,
    url: url
  }, () => {
    closeModal('editBookmarkModal');
    loadBookmarks();
  });
});

// ==================== 删除书签 ====================

function deleteBookmark(bookmarkId) {
  if (confirm('确定要删除这个书签吗？')) {
    chrome.bookmarks.remove(bookmarkId, () => {
      loadBookmarks();
    });
  }
}

// ==================== 删除文件夹 ====================

function deleteFolder(folderId) {
  if (confirm('确定要删除这个文件夹及其所有内容吗？此操作不可恢复！')) {
    chrome.bookmarks.removeTree(folderId, () => {
      loadBookmarks();
    });
  }
}

// ==================== 移动书签 ====================

function openMoveBookmarkModal(bookmarkId) {
  populateFolderSelect('moveBookmarkTarget');
  document.getElementById('moveBookmarkId').value = bookmarkId;
  openModal('moveBookmarkModal');
}

document.getElementById('moveBookmarkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('moveBookmarkId').value;
  const targetParentId = document.getElementById('moveBookmarkTarget').value;

  moveBookmarkTo(id, targetParentId);
  closeModal('moveBookmarkModal');
});

function moveBookmarkTo(bookmarkId, parentId, index = null) {
  const options = {
    parentId: parentId
  };
  if (index !== null) {
    options.index = index;
  }

  chrome.bookmarks.move(bookmarkId, options, () => {
    loadBookmarks();
  });
}

// ==================== 防抖函数 ====================

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

// ==================== 页面加载完成 ====================

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

  // 添加书签按钮
  document.getElementById('addBookmarkBtn').addEventListener('click', openAddBookmarkModal);

  // 添加文件夹按钮
  document.getElementById('addFolderBtn').addEventListener('click', openAddFolderModal);

  // 点击遮罩关闭弹窗
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  // 事件委托：处理所有动态按钮点击
  document.body.addEventListener('click', (e) => {
    const button = e.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    switch (action) {
      case 'editBookmark':
        openEditBookmarkModal(id);
        break;
      case 'moveBookmark':
        openMoveBookmarkModal(id);
        break;
      case 'deleteBookmark':
        deleteBookmark(id);
        break;
      case 'addBookmarkToFolder':
        openAddBookmarkToFolderModal(id);
        break;
      case 'deleteFolder':
        deleteFolder(id);
        break;
      case 'closeModal':
        const target = button.dataset.target;
        closeModal(target);
        break;
    }
  });
});

// ==================== 监听书签变化 ====================

chrome.bookmarks.onCreated.addListener(() => loadBookmarks());
chrome.bookmarks.onRemoved.addListener(() => loadBookmarks());
chrome.bookmarks.onChanged.addListener(() => loadBookmarks());
chrome.bookmarks.onMoved.addListener(() => loadBookmarks());
chrome.bookmarks.onChildrenReordered.addListener(() => loadBookmarks());
