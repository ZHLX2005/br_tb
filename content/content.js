// 创建翻译浮层元素
let translationTooltip = null;
let lastSelection = '';
// 设置状态（默认值，会从 storage 加载实际值）
let settings = {
  autoTranslate: false,
  showContextMenu: true
};
// 标记设置是否已从 storage 加载完成
let settingsInitialized = false;

// 收藏快捷键（默认值：按下 Ctrl 键收藏）
let favoritesShortcut = null;
let favoritesShortcutPressed = false;

// 初始化翻译浮层
function createTooltip() {
  translationTooltip = document.createElement('div');
  translationTooltip.id = 'translation-tooltip';
  translationTooltip.className = 'translation-tooltip';
  document.body.appendChild(translationTooltip);
}

// 显示翻译浮层
function showTooltip(x, y, originalText, translatedText) {
  if (!translationTooltip) {
    createTooltip();
  }

  translationTooltip.innerHTML = `
    <div class="tooltip-header">
      <span class="tooltip-title">翻译结果</span>
      <button class="tooltip-close" data-action="close">×</button>
    </div>
    <div class="tooltip-content">
      <div class="original-text">${originalText}</div>
      <div class="arrow">↓</div>
      <div class="translated-text">${translatedText}</div>
    </div>
    <div class="tooltip-footer">
      <button class="copy-btn" data-action="copy" data-text="${translatedText.replace(/"/g, '&quot;')}">复制</button>
      <button class="history-btn" data-action="favorites">收藏列表</button>
    </div>
  `;

  // 定位浮层
  translationTooltip.style.left = x + 'px';
  translationTooltip.style.top = y + 'px';
  translationTooltip.style.display = 'block';

  // 绑定事件监听器
  bindTooltipEvents(translatedText);

  // 调整位置以确保不超出视窗
  adjustTooltipPosition();
}

// 调整浮层位置
function adjustTooltipPosition() {
  const rect = translationTooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // 水平位置调整
  if (rect.right > viewportWidth) {
    translationTooltip.style.left = (viewportWidth - rect.width - 10) + 'px';
  }

  // 垂直位置调整
  if (rect.bottom > viewportHeight) {
    translationTooltip.style.top = (viewportHeight - rect.height - 10) + 'px';
  }

  // 确保不会超出左上角
  if (rect.left < 0) {
    translationTooltip.style.left = '10px';
  }
  if (rect.top < 0) {
    translationTooltip.style.top = '10px';
  }
}

// 隐藏翻译浮层
function hideTooltip() {
  if (translationTooltip) {
    translationTooltip.style.display = 'none';
  }
}

// 绑定浮层事件
function bindTooltipEvents(translatedText) {
  // 移除之前的事件监听器（如果有）
  const existingHandler = translationTooltip._tooltipHandler;
  if (existingHandler) {
    translationTooltip.removeEventListener('click', existingHandler);
  }

  // 创建新的事件处理函数并保存引用
  const handler = (e) => {
    const action = e.target.dataset.action;

    switch (action) {
      case 'close':
        hideTooltip();
        break;
      case 'copy':
        const textToCopy = e.target.dataset.text || translatedText;
        copyText(textToCopy);
        break;
      case 'favorites':
        showFavorites();
        break;
    }
  };

  // 使用事件委托处理所有按钮点击
  translationTooltip.addEventListener('click', handler);
  translationTooltip._tooltipHandler = handler;
}

// 复制文本到剪贴板
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    // 显示复制成功提示
    const copyBtn = document.querySelector('.copy-btn');
    if (copyBtn) {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '已复制';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1000);
    }
  });
}

// 显示收藏列表
function showFavorites() {
  chrome.runtime.sendMessage({ action: 'openFavorites' });
  hideTooltip();
}

// 检查快捷键是否匹配
function checkFavoritesShortcut(e) {
  // 如果没有设置自定义快捷键，使用默认行为（Ctrl键）
  if (!favoritesShortcut) {
    return e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key === 'Control';
  }

  // 检查自定义快捷键是否匹配
  return (
    e.ctrlKey === favoritesShortcut.ctrlKey &&
    e.altKey === favoritesShortcut.altKey &&
    e.shiftKey === favoritesShortcut.shiftKey &&
    e.metaKey === favoritesShortcut.metaKey &&
    e.key.toLowerCase() === favoritesShortcut.key.toLowerCase()
  );
}

// 获取快捷键的主键（用于 keyup 检测）
function getShortcutMainKey() {
  if (!favoritesShortcut) {
    return 'Control';
  }
  return favoritesShortcut.key;
}

// 监听键盘事件（用于收藏快捷键）
document.addEventListener('keydown', (e) => {
  // 检查是否按下收藏快捷键
  if (checkFavoritesShortcut(e)) {
    // 避免重复触发
    if (favoritesShortcutPressed) return;
    favoritesShortcutPressed = true;

    // 检查是否有选中文本
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText) {
      // 收藏选中的文本
      addToFavorites(selectedText, window.location.href);

      // 显示收藏成功提示
      showFavoriteNotification(selectedText);
    }
  }
});

// 监听键盘抬起事件
document.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === getShortcutMainKey().toLowerCase()) {
    favoritesShortcutPressed = false;
  }
});

// 监听文本选择变化（支持鼠标选择后按快捷键收藏）
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  // 如果有选中文本且快捷键被按下
  if (selectedText && favoritesShortcutPressed) {
    addToFavorites(selectedText, window.location.href);
    showFavoriteNotification(selectedText);
  }
});

// 收藏文本到本地存储
function addToFavorites(text, url) {
  chrome.runtime.sendMessage({
    action: 'addToFavorites',
    text: text,
    url: url,
    timestamp: new Date().toISOString()
  });
}

// 显示收藏成功提示
function showFavoriteNotification(text) {
  // 创建提示元素
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #6c757d;
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 10001;
    font-size: 14px;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = `已收藏: "${text.length > 30 ? text.substring(0, 30) + '...' : text}"`;

  // 添加动画样式
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(notification);

  // 3秒后自动移除
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    }, 300);
  }, 3000);
}

// 监听文本选择事件
document.addEventListener('mouseup', (e) => {
  // 检查设置是否已初始化，以及是否启用了自动翻译
  if (!settingsInitialized) {
    console.log('[自动翻译] 设置尚未初始化，跳过');
    return;
  }

  if (!settings.autoTranslate) {
    console.log('[自动翻译] 自动翻译未开启，跳过');
    return;
  }

  console.log('[自动翻译] 触发 mouseup 事件，开始处理...');

  // 延迟一小段时间确保选择完成
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    console.log('[自动翻译] 选中的文本:', selectedText);

    // 如果有选中文本且与上次不同
    if (selectedText && selectedText !== lastSelection) {
      lastSelection = selectedText;

      // 获取选中文本的位置
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      console.log('[自动翻译] 发送翻译请求:', selectedText);

      // 发送翻译请求到后台
      chrome.runtime.sendMessage({
        action: 'translate',
        text: selectedText
      }, (response) => {
        if (response && response.success) {
          console.log('[自动翻译] 收到翻译结果:', response.translatedText);

          // 在选中文本下方显示翻译结果
          showTooltip(
            rect.left,
            rect.bottom + window.scrollY + 5,
            response.originalText,
            response.translatedText
          );
        } else {
          console.error('[自动翻译] 翻译失败:', response);
        }
      });
    } else if (!selectedText) {
      // 没有选中文本时隐藏浮层
      hideTooltip();
      lastSelection = '';
    }
  }, 100);
});

// 监听来自后台的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateSettings') {
    console.log('[消息] 收到 updateSettings 消息:', request.settings);

    // 更新设置
    settings = { ...settings, ...request.settings };

    console.log('[消息] 更新后的设置:', settings);

    sendResponse({ success: true });
  } else if (request.action === 'showTranslation') {
    // 获取当前选择的位置
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      showTooltip(
        rect.left,
        rect.bottom + window.scrollY + 5,
        request.originalText,
        request.translatedText
      );
    }
  } else if (request.action === 'updateFavoritesShortcut') {
    // 更新收藏快捷键
    favoritesShortcut = request.shortcut;
    console.log('[收藏快捷键] 收到更新消息:', favoritesShortcut);
    sendResponse({ success: true });
  } else if (request.action === 'clearFavoritesShortcut') {
    // 清除收藏快捷键（恢复默认）
    favoritesShortcut = null;
    console.log('[收藏快捷键] 快捷键已清除，恢复默认（Ctrl键）');
    sendResponse({ success: true });
  }
});

// 点击页面其他地方时隐藏浮层
document.addEventListener('click', (e) => {
  if (translationTooltip && !translationTooltip.contains(e.target)) {
    hideTooltip();
  }
});

// 防止选中文本时立即隐藏浮层
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection().toString().trim();
  if (!selection && translationTooltip) {
    // 延迟隐藏，给用户查看翻译结果的时间
    setTimeout(() => {
      const currentSelection = window.getSelection().toString().trim();
      if (!currentSelection) {
        hideTooltip();
      }
    }, 2000);
  }
});

// 监听ESC键隐藏浮层
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideTooltip();
  }
});

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', () => {
  createTooltip();
});

// 立即加载设置（不等待 DOMContentLoaded）
// 使用 Promise 确保设置在用户操作前已加载
loadSettings().then(() => {
  console.log('[初始化] 设置加载完成，当前状态:', settings);
}).catch(err => {
  console.error('[初始化] 设置加载失败:', err);
});

// 立即加载收藏快捷键
loadFavoritesShortcut();

// 加载设置
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      // 如果没有存储的设置，使用默认值
      const defaultSettings = {
        autoTranslate: false,
        showContextMenu: true
      };

      if (result.settings) {
        // 合并存储的设置和默认值（存储的设置优先）
        settings = { ...defaultSettings, ...result.settings };
      } else {
        // 使用默认值
        settings = { ...defaultSettings };
      }

      // 标记设置已初始化
      settingsInitialized = true;

      console.log('[初始化] 设置已加载:', settings);
      console.log('[初始化] settingsInitialized 已设置为 true');
      resolve(settings);
    });
  });
}

// 加载收藏快捷键
function loadFavoritesShortcut() {
  chrome.storage.local.get(['favoritesShortcut'], (result) => {
    if (result.favoritesShortcut) {
      favoritesShortcut = result.favoritesShortcut;
      console.log('[收藏快捷键] 快捷键已加载:', favoritesShortcut);
    } else {
      // 默认快捷键：仅按 Ctrl 键
      favoritesShortcut = null;
      console.log('[收藏快捷键] 使用默认快捷键（Ctrl键）');
    }
  });
}

// 监听storage变化（当popup修改设置时自动同步）
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.settings) {
    const oldSettings = changes.settings.oldValue;
    const newSettings = changes.settings.newValue;

    console.log('[设置变化] 检测到设置更新');
    console.log('[设置变化] 旧设置:', oldSettings);
    console.log('[设置变化] 新设置:', newSettings);

    settings = { ...settings, ...newSettings };

    // 确保设置初始化标志已设置
    settingsInitialized = true;

    console.log('[设置变化] 当前设置:', settings);
    console.log('[设置变化] settingsInitialized 已设置为 true');
  }

  // 监听收藏快捷键变化
  if (areaName === 'local' && changes.favoritesShortcut) {
    const newShortcut = changes.favoritesShortcut.newValue;
    favoritesShortcut = newShortcut;
    console.log('[收藏快捷键] 快捷键已更新:', favoritesShortcut);
  }
});