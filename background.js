// 创建右键菜单项
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translateSelection',
    title: '翻译 "%s"',
    contexts: ['selection']
  });
});

// 处理右键菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translateSelection') {
    const selectedText = info.selectionText;

    // 模拟翻译（在原文后添加x）
    const translatedText = selectedText + 'x';

    // 将翻译结果发送给content script显示
    chrome.tabs.sendMessage(tab.id, {
      action: 'showTranslation',
      originalText: selectedText,
      translatedText: translatedText
    });
  }
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    // 模拟翻译API调用
    const translatedText = request.text + 'x';

    // 发送翻译结果
    sendResponse({
      success: true,
      originalText: request.text,
      translatedText: translatedText
    });
  } else if (request.action === 'addToFavorites') {
    // 添加到收藏列表
    chrome.storage.local.get(['favorites'], (result) => {
      const favorites = result.favorites || [];

      // 检查是否已存在相同的收藏
      const exists = favorites.some(fav => fav.text === request.text && fav.url === request.url);

      if (!exists) {
        favorites.unshift({
          text: request.text,
          url: request.url,
          timestamp: request.timestamp || new Date().toISOString()
        });

        // 保持收藏列表在200条以内
        if (favorites.length > 200) {
          favorites.pop();
        }

        chrome.storage.local.set({ favorites }, () => {
          console.log('收藏已添加，当前收藏数量:', favorites.length);
        });
      } else {
        console.log('收藏已存在，未重复添加');
      }
    });
  } else if (request.action === 'openFavorites') {
    // 打开收藏列表页面
    chrome.tabs.create({
      url: chrome.runtime.getURL('favorites.html')
    });
  }

  // 返回true表示将异步发送响应
  return true;
});

// 存储收藏列表
chrome.storage.local.get(['favorites'], (result) => {
  if (!result.favorites) {
    chrome.storage.local.set({
      favorites: []
    });
  }
});