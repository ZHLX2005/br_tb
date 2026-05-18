/**
 * SidePanel / Action Click Handler
 * 处理扩展图标点击：优先打开侧边栏，失败则回退到新标签页
 */

export function initActionClickHandler() {
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (error) {
      console.log('sidePanel open failed, fallback to tab:', error);
      await chrome.tabs.create({
        url: chrome.runtime.getURL('sidepanel/sidepanel.html'),
        active: true
      });
    }
  });
}
