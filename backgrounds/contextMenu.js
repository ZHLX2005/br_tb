/**
 * 右键菜单管理模块
 * 负责创建、更新和处理右键菜单
 */

// 菜单ID
export const MENU_ID = 'translateSelection';
export const OCR_MENU_ID = 'ocrSelection';

/**
 * 创建右键菜单项
 */
function createContextMenus() {
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
}

/**
 * 根据设置更新菜单显示状态
 */
export function updateContextMenuVisibility() {
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

/**
 * 处理右键菜单点击事件
 */
function handleContextMenuClick(info, tab) {
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
}

/**
 * 初始化右键菜单模块
 */
export function setupContextMenu() {
  // 监听扩展安装事件，创建右键菜单
  chrome.runtime.onInstalled.addListener(createContextMenus);

  // 监听右键菜单点击事件
  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
}
