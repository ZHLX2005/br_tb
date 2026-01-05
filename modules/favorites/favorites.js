// 加载收藏列表
function loadFavorites() {
  chrome.storage.local.get(['favorites'], (result) => {
    const favorites = result.favorites || [];
    displayFavorites(favorites);
  });
}

// 显示收藏列表
function displayFavorites(favorites) {
  const favoritesList = document.getElementById('favoritesList');
  const clearBtn = document.getElementById('clearBtn');
  const count = document.getElementById('favoritesCount');

  count.textContent = `共 ${favorites.length} 条收藏`;

  if (favorites.length === 0) {
    favoritesList.innerHTML = '<div class="empty-message">暂无收藏内容<br><br>提示：选中网页上的文字，然后按住Ctrl键即可收藏</div>';
    clearBtn.style.display = 'none';
  } else {
    favoritesList.innerHTML = favorites.map((item, index) => `
      <div class="favorite-item" data-index="${index}">
        <div class="favorite-header">
          <div class="favorite-content">
            <div class="favorite-text">${escapeHtml(item.text)}</div>
            ${item.result ? `
              <div class="favorite-result-label">📝 识别结果</div>
              <div class="favorite-result">${escapeHtml(item.result)}</div>
            ` : ''}
            <div class="favorite-url" data-url="${escapeHtml(item.url)}" title="点击访问来源页面">${getDomain(item.url)}</div>
            <div class="timestamp">${new Date(item.timestamp).toLocaleString('zh-CN')}</div>
          </div>
          <button class="delete-btn" data-index="${index}">删除</button>
        </div>
      </div>
    `).join('');
    clearBtn.style.display = 'inline-block';

    // 绑定删除按钮事件
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        deleteFavorite(index);
      });
    });

    // 绑定URL点击事件
    document.querySelectorAll('.favorite-url').forEach(urlEl => {
      urlEl.addEventListener('click', (e) => {
        const url = e.target.dataset.url;
        openUrl(url);
      });
    });
  }
}

// 获取域名
function getDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + urlObj.pathname;
  } catch (e) {
    return url;
  }
}

// 打开URL
function openUrl(url) {
  chrome.tabs.create({ url: url });
}

// HTML转义函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 删除单个收藏
function deleteFavorite(index) {
  if (confirm('确定要删除这条收藏吗？')) {
    chrome.storage.local.get(['favorites'], (result) => {
      const favorites = result.favorites || [];
      favorites.splice(index, 1);
      chrome.storage.local.set({ favorites }, () => {
        displayFavorites(favorites);
      });
    });
  }
}

// 清空收藏列表
function clearFavorites() {
  if (confirm('确定要清空所有收藏吗？此操作不可撤销。')) {
    chrome.storage.local.remove(['favorites'], () => {
      displayFavorites([]);
      alert('收藏列表已清空');
    });
  }
}

// 导出收藏列表
function exportFavorites() {
  chrome.storage.local.get(['favorites'], (result) => {
    const favorites = result.favorites || [];

    if (favorites.length === 0) {
      alert('没有可导出的收藏');
      return;
    }

    // 创建导出文本
    const exportText = favorites.map(item => {
      let text = `收藏内容: ${item.text}\n来源页面: ${item.url}\n收藏时间: ${new Date(item.timestamp).toLocaleString('zh-CN')}`;
      if (item.result) {
        text += `\n识别结果: ${item.result}`;
      }
      text += `\n${'-'.repeat(50)}`;
      return text;
    }).join('\n\n');

    // 创建Blob并下载
    const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `我的收藏_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
  // 绑定按钮事件
  document.getElementById('clearBtn').addEventListener('click', clearFavorites);
  document.getElementById('exportBtn').addEventListener('click', exportFavorites);

  // 加载收藏列表
  loadFavorites();
});

// 监听存储变化（如果有其他标签页修改了收藏列表）
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.favorites) {
    displayFavorites(changes.favorites.newValue || []);
  }
});