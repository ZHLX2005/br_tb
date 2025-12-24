// DOM 元素
const textInput = document.getElementById('textInput');
const translateBtn = document.getElementById('translateBtn');
const resultSection = document.getElementById('resultSection');
const resultText = document.getElementById('resultText');
const copyResultBtn = document.getElementById('copyResultBtn');
const todayCountEl = document.getElementById('todayCount');
const totalCountEl = document.getElementById('totalCount');
const autoTranslateToggle = document.getElementById('autoTranslate');
const showContextMenuToggle = document.getElementById('showContextMenu');
const bookmarksBtn = document.getElementById('bookmarksBtn');
const historyBtn = document.getElementById('historyBtn');
const settingsBtn = document.getElementById('settingsBtn');
const aboutBtn = document.getElementById('aboutBtn');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadStatistics();
  bindEvents();
});

// 绑定事件
function bindEvents() {
  // 翻译按钮点击事件
  translateBtn.addEventListener('click', handleTranslate);

  // 回车键翻译
  textInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      handleTranslate();
    }
  });

  // 复制结果
  copyResultBtn.addEventListener('click', copyResult);

  // 设置项变化
  autoTranslateToggle.addEventListener('change', saveSettings);
  showContextMenuToggle.addEventListener('change', saveSettings);

  // 底部按钮
  bookmarksBtn.addEventListener('click', showBookmarks);
  historyBtn.addEventListener('click', showFavorites);
  settingsBtn.addEventListener('click', showSettings);
  aboutBtn.addEventListener('click', showAbout);
}

// 处理翻译
function handleTranslate() {
  const text = textInput.value.trim();

  if (!text) {
    alert('请输入要翻译的文本');
    return;
  }

  // 显示加载状态
  translateBtn.innerHTML = '<span class="loading"></span> 翻译中...';
  translateBtn.disabled = true;

  // 模拟翻译API调用
  setTimeout(() => {
    const translatedText = text + 'x'; // 模拟翻译，在原文后添加x

    // 显示结果
    showResult(text, translatedText);

    // 更新统计
    updateStatistics();

    // 保存到收藏
    saveToFavorites(text, translatedText);

    // 恢复按钮状态
    translateBtn.innerHTML = '翻译';
    translateBtn.disabled = false;
  }, 500);
}

// 显示翻译结果
function showResult(originalText, translatedText) {
  resultText.textContent = translatedText;
  resultSection.style.display = 'block';

  // 滚动到结果区域
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 复制翻译结果
function copyResult() {
  const text = resultText.textContent;

  navigator.clipboard.writeText(text).then(() => {
    // 显示复制成功提示
    const originalText = copyResultBtn.textContent;
    copyResultBtn.textContent = '已复制';

    setTimeout(() => {
      copyResultBtn.textContent = originalText;
    }, 1000);
  }).catch(err => {
    console.error('复制失败:', err);
    alert('复制失败，请手动复制');
  });
}

// 加载设置
function loadSettings() {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {
      autoTranslate: true,
      showContextMenu: true
    };

    autoTranslateToggle.checked = settings.autoTranslate;
    showContextMenuToggle.checked = settings.showContextMenu;
  });
}

// 保存设置
function saveSettings() {
  const settings = {
    autoTranslate: autoTranslateToggle.checked,
    showContextMenu: showContextMenuToggle.checked
  };

  chrome.storage.local.set({ settings });

  // 通知所有标签页设置已更改
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'updateSettings',
        settings
      }).catch(() => {
        // 忽略无法发送消息的标签页（如chrome://页面）
      });
    });
  });

  // 通知background脚本
  chrome.runtime.sendMessage({
    action: 'updateSettings',
    settings
  });
}

// 加载统计信息
function loadStatistics() {
  chrome.storage.local.get(['statistics'], (result) => {
    const statistics = result.statistics || {
      todayCount: 0,
      totalCount: 0,
      lastUpdateDate: new Date().toDateString()
    };

    // 检查是否是新的一天
    const today = new Date().toDateString();
    if (statistics.lastUpdateDate !== today) {
      statistics.todayCount = 0;
      statistics.lastUpdateDate = today;
    }

    todayCountEl.textContent = statistics.todayCount;
    totalCountEl.textContent = statistics.totalCount;
  });
}

// 更新统计信息
function updateStatistics() {
  chrome.storage.local.get(['statistics'], (result) => {
    const statistics = result.statistics || {
      todayCount: 0,
      totalCount: 0,
      lastUpdateDate: new Date().toDateString()
    };

    const today = new Date().toDateString();

    // 检查是否是新的一天
    if (statistics.lastUpdateDate !== today) {
      statistics.todayCount = 0;
      statistics.lastUpdateDate = today;
    }

    // 更新计数
    statistics.todayCount++;
    statistics.totalCount++;

    // 保存并更新显示
    chrome.storage.local.set({ statistics });
    todayCountEl.textContent = statistics.todayCount;
    totalCountEl.textContent = statistics.totalCount;
  });
}

// 保存到收藏列表（翻译结果）
function saveToFavorites(originalText, translatedText) {
  chrome.storage.local.get(['favorites'], (result) => {
    const favorites = result.favorites || [];

    // 检查是否已存在相同的收藏
    const exists = favorites.some(fav => fav.text === originalText + ' → ' + translatedText);

    if (!exists) {
      favorites.unshift({
        text: originalText + ' → ' + translatedText,
        url: '翻译插件内部',
        timestamp: new Date().toISOString()
      });

      // 保持收藏列表在200条以内
      if (favorites.length > 200) {
        favorites.pop();
      }

      chrome.storage.local.set({ favorites });
    }
  });
}

// 显示浏览器原生书签
function showBookmarks() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('browser-bookmarks/browser-bookmarks.html')
  });
}

// 显示收藏列表
function showFavorites() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('favorites/favorites.html')
  });
}

// 显示设置
function showSettings() {
  alert('设置功能正在开发中...');
}

// 显示关于
function showAbout() {
  alert('划词翻译插件 v1.0\n\n这是一个演示插件，翻译功能为模拟实现。\n\n功能特点：\n• 支持划词翻译\n• 右键菜单翻译\n• 翻译历史记录\n• 自动翻译开关\n\n开发者: Demo');
}

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updatePopupStats') {
    loadStatistics();
  }
});

// 快捷键支持
document.addEventListener('keydown', (e) => {
  // Ctrl+L 清空输入框
  if (e.ctrlKey && e.key === 'l') {
    e.preventDefault();
    textInput.value = '';
    textInput.focus();
  }

  // Ctrl+C 复制结果
  if (e.ctrlKey && e.key === 'c' && resultSection.style.display !== 'none') {
    e.preventDefault();
    copyResult();
  }
});