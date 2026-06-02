/**
 * TabBoard 打开逻辑
 * 优先在当前窗口查找；若命中其他窗口已存在的 TabBoard，
 * 必须把对应窗口拉到前台，否则用户看不到任何反应。
 */

async function openTabboard() {
  const meUrl = chrome.runtime.getURL('modules/tabboard/tabboard.html');

  // 并行查：当前窗口 + 全部窗口
  const [curWinTabs, allTabs] = await Promise.all([
    chrome.tabs.query({ currentWindow: true }),
    chrome.tabs.query({})
  ]);

  // 优先当前窗口（避免切到用户背后的窗口）
  const target =
    curWinTabs.find(t => t.url?.includes('modules/tabboard/tabboard.html')) ||
    allTabs.find(t => t.url?.includes('modules/tabboard/tabboard.html'));

  if (target) {
    await chrome.tabs.update(target.id, { active: true });
    if (!target.pinned) {
      await chrome.tabs.update(target.id, { pinned: true });
    }
    // 关键：chrome.tabs.update 不会切窗口，必须显式 focus
    await chrome.windows.update(target.windowId, { focused: true });
  } else {
    // 不传 windowId 时默认进当前窗口，符合用户直觉
    await chrome.tabs.create({
      url: meUrl,
      pinned: true,
      active: true
    });
  }
}

export { openTabboard };
