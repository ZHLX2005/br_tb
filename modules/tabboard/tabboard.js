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
import BilibiliHistoryModule from '../bilibili-history/index.js';

class AppShell {
  constructor() {
    this.dataManager = new DataManager();
    this.eventBus = new EventBus();
    this.currentModule = null;
    this.currentView = 'timeline';
    this.storageChangeTimer = null;
    this.dropdownOpen = false;
    this.dropdownItems = [
      { viewName: 'leetcode',         label: 'LC',    desc: '150'  },
      { viewName: 'timer',            label: 'Timer', desc: '日志' },
      { viewName: 'bilibili-history', label: 'Bili',  desc: '历史' },
    ];
    // 模块实例缓存：保留有状态模块（bilibili-history 等）的实例，
    // 避免 view 切换时丢失 state / payload / items 等内存数据
    this.modules = {};
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

    const moreBtn = document.getElementById('moreViewBtn');
    moreBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleDropdown();
    });
    this._setupDropdownDismiss();
  }

  _setupDropdownDismiss() {
    document.addEventListener('click', (e) => {
      if (!this.dropdownOpen) return;
      if (e.target.closest('#moreViewBtn, .nav-dropdown')) return;
      this._closeDropdown();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.dropdownOpen) this._closeDropdown();
    });
  }

  _toggleDropdown() {
    this.dropdownOpen ? this._closeDropdown() : this._openDropdown();
  }

  _openDropdown() {
    if (this.dropdownOpen) return;
    const moreBtn = document.getElementById('moreViewBtn');
    if (!moreBtn) return;

    const activeView = this.currentView;
    const html = `<div class="nav-dropdown" role="menu">${
      this.dropdownItems.map(it => `
        <button class="nav-dropdown-item ${activeView === it.viewName ? 'active' : ''}"
                data-view="${it.viewName}" role="menuitem">
          <span class="nav-dropdown-label">${it.label}</span>
          <span class="nav-dropdown-desc">${it.desc}</span>
        </button>`).join('')
    }</div>`;

    document.body.insertAdjacentHTML('beforeend', html);
    const dd = document.querySelector('.nav-dropdown');
    if (dd) {
      const rect = moreBtn.getBoundingClientRect();
      dd.style.top  = `${rect.bottom + 6}px`;
      dd.style.right = `${window.innerWidth - rect.right}px`;
    }

    document.querySelectorAll('.nav-dropdown-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const view = el.getAttribute('data-view');
        if (view) this.switchView(view);
      });
    });

    this.dropdownOpen = true;
    moreBtn.setAttribute('aria-expanded', 'true');
  }

  _closeDropdown() {
    if (!this.dropdownOpen) return;
    document.querySelectorAll('.nav-dropdown').forEach(el => el.remove());
    this.dropdownOpen = false;
    document.getElementById('moreViewBtn')?.setAttribute('aria-expanded', 'false');
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

    // 缓存命中：复用已构造的模块实例，避免破坏有状态模块（bilibili-history）的内存数据。
    // 各模块的 destroy() 通常只做 container = null / 清理副作用，并不销毁内存中的 state/items/payload，
    // 因此把 cached 实例重新挂回原 <div> 容器并 render() 即可恢复视图。
    if (this.modules[viewName]) {
      this.currentModule = this.modules[viewName];
      this.currentView = viewName;
      this._updateViewUI(viewName);
      this._reattachModule(this.currentModule, viewName);
      const data = initialData || await this.dataManager.loadData();
      this.currentModule.render(data);
      this.currentModule.bindEvents();
      this._closeDropdown();
      await this.dataManager.sendMessage('updateSettings', {
        settings: { lastView: viewName }
      });
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
      case 'bilibili-history':
        container = document.getElementById('bilibiliHistoryPanel');
        ModuleClass = BilibiliHistoryModule;
        break;
      case 'timeline':
      default:
        container = document.getElementById('timelineView');
        ModuleClass = TimelineModule;
        break;
    }

    this.currentModule = new ModuleClass(container, this.dataManager, this.eventBus);
    this.modules[viewName] = this.currentModule; // 进入缓存
    this.currentModule.init();
    this.currentModule.render(data);
    this.currentModule.bindEvents();

    this._closeDropdown();
    await this.dataManager.sendMessage('updateSettings', {
      settings: { lastView: viewName }
    });
  }

  /**
   * 把缓存中的模块实例重新挂回到对应的 <div> 容器。
   * 不同模块的 setContainer 形态：
   *   - BilibiliHistoryModule.init() 调用 view.setContainer
   *   - LeetCodeModule.init()   调用 view.setContainer
   *   - TimerModule.init()      调用 view.setContainer
   *   - TimelineModule.init()   仅初始化搜索输入（不依赖 container）
   *   - GroupModule.init()      no-op
   * 因此这里统一通过模块自身暴露的 _reattach(container) 钩子挂回；若不存在则直接调用 view.setContainer。
   */
  _reattachModule(module, viewName) {
    const containerMap = {
      'timeline': 'timelineView',
      'group': 'groupView',
      'leetcode': 'leetcodePanel',
      'timer': 'timerPanel',
      'bilibili-history': 'bilibiliHistoryPanel',
    };
    const el = document.getElementById(containerMap[viewName]);
    if (!el) return;
    module.container = el;
    if (typeof module.view?.setContainer === 'function') {
      module.view.setContainer(el);
    }
    if (typeof module._reattach === 'function') {
      module._reattach(el);
    }
  }

  _updateViewUI(viewName) {
    document.getElementById('timelineViewBtn')?.classList.toggle('active', viewName === 'timeline');
    document.getElementById('groupViewBtn')?.classList.toggle('active', viewName === 'group');
    document.getElementById('recordingViewBtn')?.classList.toggle('active', viewName === 'recording');
    document.getElementById('videoProgressViewBtn')?.classList.toggle('active', viewName === 'videoProgress');

    document.getElementById('timelineView').style.display = viewName === 'timeline' ? 'block' : 'none';
    document.getElementById('groupView').style.display = viewName === 'group' ? 'block' : 'none';
    document.getElementById('leetcodeView').style.display = viewName === 'leetcode' ? 'block' : 'none';
    document.getElementById('timerView').style.display = viewName === 'timer' ? 'block' : 'none';
    document.getElementById('bilibiliHistoryView').style.display = viewName === 'bilibili-history' ? 'block' : 'none';

    // More 按钮 active 状态：当前 view 属于 dropdown items 时高亮
    const inDropdown = this.dropdownItems.some(it => it.viewName === viewName);
    document.getElementById('moreViewBtn')?.classList.toggle('active', inDropdown);
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
