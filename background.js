// 菜单ID
const MENU_ID = 'translateSelection';
const OCR_MENU_ID = 'ocrSelection';

// 创建右键菜单项
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '翻译 "%s"',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: OCR_MENU_ID,
    title: '📷 OCR 区域识别',
    contexts: ['page', 'image']
  });
});

// 根据设置更新菜单显示状态
function updateContextMenuVisibility() {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || { showContextMenu: true };

    if (settings.showContextMenu) {
      // 显示菜单
      chrome.contextMenus.create({
        id: MENU_ID,
        title: '翻译 "%s"',
        contexts: ['selection']
      }, () => {
        // 忽略菜单已存在的错误
        if (chrome.runtime.lastError) {
          // 菜单可能已存在，这是正常情况
        }
      });
    } else {
      // 隐藏菜单
      chrome.contextMenus.remove(MENU_ID, () => {
        // 忽略菜单不存在的错误
        if (chrome.runtime.lastError) {
          // 菜单可能已被删除，这是正常情况
        }
      });
    }
  });
}

// 处理右键菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) {
    const selectedText = info.selectionText;

    // 模拟翻译（在原文后添加x）
    const translatedText = selectedText + 'x';

    // 将翻译结果发送给content script显示
    chrome.tabs.sendMessage(tab.id, {
      action: 'showTranslation',
      originalText: selectedText,
      translatedText: translatedText
    });
  } else if (info.menuItemId === OCR_MENU_ID) {
    // 启动 OCR 区域选择
    chrome.tabs.sendMessage(tab.id, {
      action: 'startOCRSelection'
    });
  }
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'updateSettings') {
    // 更新右键菜单显示状态
    updateContextMenuVisibility();
    sendResponse({ success: true });
  } else if (request.action === 'translate') {
    // 模拟翻译API调用
    const translatedText = request.text + 'x';

    // 发送翻译结果
    sendResponse({
      success: true,
      originalText: request.text,
      translatedText: translatedText
    });
  } else if (request.action === 'performOCR') {
    // 执行 OCR 识别
    handleOCRRequest(request).then(sendResponse);
    return true; // 异步响应
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
      url: chrome.runtime.getURL('modules/favorites/favorites.html')
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

// 监听storage变化（当popup修改设置时自动更新右键菜单）
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.settings) {
    updateContextMenuVisibility();
  }
});

/**
 * 处理 OCR 请求 - 使用 captureVisibleTab + canvas 裁剪
 * @param {Object} request - 请求对象，包含 rect 区域信息
 * @returns {Promise} OCR 识别结果
 */
async function handleOCRRequest(request) {
  try {
    const { rect } = request;

    // 使用 captureVisibleTab 获取当前窗口的完整截图
    // 注意：captureVisibleTab 第一个参数在 Manifest V3 中应该是 windowId
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

    return {
      success: true,
      dataUrl: dataUrl,
      rect: rect
    };

  } catch (error) {
    console.error('OCR Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
