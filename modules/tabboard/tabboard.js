/**
 * TabBoard - 标签页看板主入口（Shell）
 * 负责模块生命周期管理和视图切换
 */

import DataManager from '../shared/data-manager.js';
import EventBus from '../shared/event-bus.js';
import TimelineModule from '../timeline/index.js';
import GroupModule from '../group/index.js';
import LeetCodeModule from '../leetcode/index.js';
import TimerModule from '../timer/index.js';

class AppShell {
  constructor() {
    this.dataManager = new DataManager();
    this.eventBus = new EventBus();
    this.currentModule = null;
    this.currentView = 'timeline';
    this.storageChangeTimer = null;
  }

  async init() {
    const data = await this.dataManager.loadData();
    const lastView = data.settings?.lastView || 'timeline';

    this._setupViewSwitchButtons();
    this._setupRefreshButton();
    this._setupImageErrorHandling();
    this._setupStorageChangeListener();

    await this.switchView(lastView, data);
  }

  _setupViewSwitchButtons() {
    document.getElementById('timelineViewBtn')?.addEventListener('click', () => this.switchView('timeline'));
    document.getElementById('groupViewBtn')?.addEventListener('click', () => this.switchView('group'));
    document.getElementById('recordingViewBtn')?.addEventListener('click', () => this._openRecordingPage());
    document.getElementById('videoProgressViewBtn')?.addEventListener('click', () => this._openVideoProgressPage());
    document.getElementById('leetcodeViewBtn')?.addEventListener('click', () => this.switchView('leetcode'));
    document.getElementById('timerViewBtn')?.addEventListener('click', () => this.switchView('timer'));
  }

  _setupRefreshButton() {
    document.getElementById('refreshBtn')?.addEventListener('click', async () => {
      const data = await this.dataManager.loadData();
      if (this.currentModule) this.currentModule.render(data);
    });
  }

  _setupImageErrorHandling() {
    document.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.style.display = 'none';
    }, true);
  }

  _setupStorageChangeListener() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;
      if (this.storageChangeTimer) clearTimeout(this.storageChangeTimer);
      this.storageChangeTimer = setTimeout(async () => {
        const data = await this.dataManager.loadData();
        if (this.currentModule) this.currentModule.render(data);
      }, 100);
    });
  }

  async switchView(viewName, initialData = null) {
    if (viewName === 'recording') {
      this._openRecordingPage();
      return;
    }

    if (this.currentModule) {
      this.currentModule.destroy();
      this.currentModule = null;
    }

    this.currentView = viewName;
    this._updateViewUI(viewName);

    const data = initialData || await this.dataManager.loadData();

    let container;
    let ModuleClass;

    switch (viewName) {
      case 'group':
        container = document.getElementById('groupView');
        ModuleClass = GroupModule;
        break;
      case 'leetcode':
        container = document.getElementById('leetcodePanel');
        ModuleClass = LeetCodeModule;
        break;
      case 'timer':
        container = document.getElementById('timerPanel');
        ModuleClass = TimerModule;
        break;
      case 'timeline':
      default:
        container = document.getElementById('timelineView');
        ModuleClass = TimelineModule;
        break;
    }

    this.currentModule = new ModuleClass(container, this.dataManager, this.eventBus);
    this.currentModule.init();
    this.currentModule.render(data);
    this.currentModule.bindEvents();

    await this.dataManager.sendMessage('updateSettings', {
      settings: { lastView: viewName }
    });
  }

  _updateViewUI(viewName) {
    document.getElementById('timelineViewBtn')?.classList.toggle('active', viewName === 'timeline');
    document.getElementById('groupViewBtn')?.classList.toggle('active', viewName === 'group');
    document.getElementById('recordingViewBtn')?.classList.toggle('active', viewName === 'recording');
    document.getElementById('videoProgressViewBtn')?.classList.toggle('active', viewName === 'videoProgress');
    document.getElementById('leetcodeViewBtn')?.classList.toggle('active', viewName === 'leetcode');
    document.getElementById('timerViewBtn')?.classList.toggle('active', viewName === 'timer');

    document.getElementById('timelineView').style.display = viewName === 'timeline' ? 'block' : 'none';
    document.getElementById('groupView').style.display = viewName === 'group' ? 'block' : 'none';
    document.getElementById('leetcodeView').style.display = viewName === 'leetcode' ? 'block' : 'none';
    document.getElementById('timerView').style.display = viewName === 'timer' ? 'block' : 'none';
  }

  _openRecordingPage() {
    window.location.href = chrome.runtime.getURL('modules/recording/recording.html');
  }

  _openVideoProgressPage() {
    window.location.href = chrome.runtime.getURL('modules/video-progress/video-progress.html');
  }
}

const app = new AppShell();
document.addEventListener('DOMContentLoaded', () => app.init());
