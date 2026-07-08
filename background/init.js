/**
 * 初始化模块
 */

import { generateId, DEFAULT_COLORS } from './utils.js';

// 初始化默认数据
export async function initializeDefaultData() {
  // 一次性获取所有需要初始化的数据
  const result = await chrome.storage.local.get([
    'groups',
    'tabs',
    'timelineSnapshots',
    'settings',
    'recordings',
    'recordingState'
  ]);

  if (!result.groups) {
    const defaultGroups = [
      { id: generateId(), name: '工作', color: DEFAULT_COLORS[0], isDefault: true, goto: false },
      { id: generateId(), name: '学习', color: DEFAULT_COLORS[1], isDefault: false, goto: false },
      { id: generateId(), name: '娱乐', color: DEFAULT_COLORS[2], isDefault: false, goto: false }
    ];
    await chrome.storage.local.set({ groups: defaultGroups });
  }

  if (!result.tabs) {
    await chrome.storage.local.set({ tabs: {} });
  }

  // Timeline 存储 - 快照列表
  if (!result.timelineSnapshots) {
    await chrome.storage.local.set({ timelineSnapshots: [] });
  }

  if (!result.settings) {
    await chrome.storage.local.set({
      settings: {
        closeAfterCollect: false,
        closeAfterRestore: false,
        excludeEdgeUrls: false,
        lastView: 'timeline',
        visibleGroups: result.groups ? result.groups.map(g => g.id) : [],
        showCourseProgressBar: false,
        showCourseProgressBarOnUnrelatedTabs: false,
        showGotoRing: false,
        ringSidebarEnabled: true,
        showVpSidebar: true,
        theme: 'neo-brutalism'
      }
    });
  } else {
    // 为旧设置迁移新字段
    let needUpdate = false;
    const updatedSettings = { ...result.settings };

    if (updatedSettings.showCourseProgressBar === undefined) {
      updatedSettings.showCourseProgressBar = false;
      needUpdate = true;
    }
    if (updatedSettings.showCourseProgressBarOnUnrelatedTabs === undefined) {
      updatedSettings.showCourseProgressBarOnUnrelatedTabs = false;
      needUpdate = true;
    }
    if (updatedSettings.showLcSidebar === undefined) {
      updatedSettings.showLcSidebar = false;
      needUpdate = true;
    }
    if (updatedSettings.showGotoRing === undefined) {
      updatedSettings.showGotoRing = false;
      needUpdate = true;
    }
    if (updatedSettings.ringSidebarEnabled === undefined) {
      updatedSettings.ringSidebarEnabled = true;
      needUpdate = true;
    }
    if (updatedSettings.showVpSidebar === undefined) {
      updatedSettings.showVpSidebar = true;
      needUpdate = true;
    }
    if (updatedSettings.showTimerSidebar === undefined) {
      updatedSettings.showTimerSidebar = true;
      needUpdate = true;
    }
    if (updatedSettings.showCaptureRing === undefined) {
      updatedSettings.showCaptureRing = true;
      needUpdate = true;
    }
    if (updatedSettings.lastView === undefined) {
      updatedSettings.lastView = 'timeline';
      needUpdate = true;
    }
    if (updatedSettings.theme === undefined) {
      updatedSettings.theme = 'neo-brutalism';
      needUpdate = true;
    }
    if (!updatedSettings.visibleGroups) {
      updatedSettings.visibleGroups = result.groups ? result.groups.map(g => g.id) : [];
      needUpdate = true;
    }
    if (needUpdate) {
      await chrome.storage.local.set({ settings: updatedSettings });
    }
  }

  // 初始化录制状态（独立存储，与分组分离）
  if (!result.recordingState) {
    await chrome.storage.local.set({
      recordingState: {
        isRecording: false,
        recordingId: null,
        recordingName: '',
        startTime: null,
        tabCount: 0
      }
    });
  }

  // 初始化录制列表存储（独立于 groups 和 tabs）
  if (!result.recordings) {
    await chrome.storage.local.set({ recordings: [] });
  }

  // 初始化 LeetCode 150 进度
  const lcResult = await chrome.storage.local.get(['leetcodeProgress']);
  if (!lcResult.leetcodeProgress) {
    await chrome.storage.local.set({ leetcodeProgress: {} });
  }

  // 初始化计时器存储
  const timerResult = await chrome.storage.local.get(['timerSessions', 'timerState']);
  if (!timerResult.timerSessions) {
    await chrome.storage.local.set({ timerSessions: [] });
  }
  if (!timerResult.timerState) {
    await chrome.storage.local.set({
      timerState: { isRunning: false, startTime: null, elapsed: 0 }
    });
  }

  // 初始化 goto 圆环：检查是否存在 goto=true 的 group，若无则创建"📄 面包"分组
  const finalGroups = (await chrome.storage.local.get(['groups'])).groups || result.groups || [];
  const hasGotoGroup = finalGroups.some(g => g.goto === true);

  if (!hasGotoGroup) {
    // 创建一个新的"面包"分组,并把 6 个示例 URL 作为初始 tabs
    const breadGroup = {
      id: generateId(),
      name: '📄 面包',
      color: '#f9ca24',
      isDefault: false,
      goto: true
    };
    finalGroups.push(breadGroup);

    const finalTabs = (await chrome.storage.local.get(['tabs'])).tabs || result.tabs || {};
    finalTabs[breadGroup.id] = [
      { id: generateId(), title: '上海演唱会', url: 'https://www.bilibili.com/video/BV1L48qzsESK?spm_id_from=333.788.videopod.sections', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '宁波演唱会', url: 'https://www.bilibili.com/video/BV1pca3zPECZ/?spm_id_from=333.337.search-card.all.click&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '北京演唱会', url: 'https://www.bilibili.com/video/BV13hSzYfEfD?spm_id_from=333.788.videopod.sections&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '广州演唱会', url: 'https://www.bilibili.com/video/BV1g2oiYqEiM?spm_id_from=333.788.videopod.sections&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '成都演唱会', url: 'https://www.bilibili.com/video/BV1dUjkzqEUj/?spm_id_from=333.788.videopod.sections&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2', favicon: '', timestamp: new Date().toISOString() },
      { id: generateId(), title: '天津演唱会', url: 'https://www.bilibili.com/video/BV1hNq1BTEG8/?spm_id_from=333.337.search-card.all.click', favicon: '', timestamp: new Date().toISOString() },
    ];

    await chrome.storage.local.set({ groups: finalGroups, tabs: finalTabs });
  } else {
    // 为旧 group 补 goto 字段(迁移)
    let needUpdate = false;
    for (const g of finalGroups) {
      if (g.goto === undefined) {
        g.goto = false;
        needUpdate = true;
      }
    }
    if (needUpdate) {
      await chrome.storage.local.set({ groups: finalGroups });
    }
  }
}

// 设置相关的消息监听器
export function setupSettingsListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSettings' || request.action === 'updateSettings') {
      (async () => {
        try {
          if (request.action === 'getSettings') {
            const settingsResult = await chrome.storage.local.get(['settings']);
            sendResponse({ success: true, settings: settingsResult.settings || {} });
          } else {
            const currentSettings = await chrome.storage.local.get(['settings']);
            const newSettings = { ...currentSettings.settings, ...request.settings };
            await chrome.storage.local.set({ settings: newSettings });
            sendResponse({ success: true });
          }
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }
    return false;
  });
}
