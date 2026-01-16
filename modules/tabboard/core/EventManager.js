/**
 * EventManager - 事件管理模块
 * 负责全局事件监听和视图切换
 */

class EventManager {
  constructor(dataManager, timelineView, groupView) {
    this.dataManager = dataManager;
    this.timelineView = timelineView;
    this.groupView = groupView;
    this.currentView = 'timeline';
    this.storageChangeTimer = null;
    this.onViewChange = null;
  }

  /**
   * 设置视图变化回调
   */
  setViewChangeCallback(callback) {
    this.onViewChange = callback;
  }

  /**
   * 初始化所有事件监听器
   */
  init() {
    this._setupViewSwitchButtons();
    this._setupRefreshButton();
    this._setupImageErrorHandling();
    this._setupStorageChangeListener();
  }

  /**
   * 设置视图切换按钮
   */
  _setupViewSwitchButtons() {
    const timelineBtn = document.getElementById('timelineViewBtn');
    const groupBtn = document.getElementById('groupViewBtn');

    if (timelineBtn) {
      timelineBtn.addEventListener('click', () => this.switchToTimelineView());
    }
    if (groupBtn) {
      groupBtn.addEventListener('click', () => this.switchToGroupView());
    }
  }

  /**
   * 设置刷新按钮
   */
  _setupRefreshButton() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await this.dataManager.loadData();
        this._renderCurrentView();
      });
    }
  }

  /**
   * 设置图片加载错误处理 - 使用事件委托
   */
  _setupImageErrorHandling() {
    document.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') {
        e.target.style.display = 'none';
      }
    }, true);
  }

  /**
   * 设置存储变化监听器（带防抖）
   */
  _setupStorageChangeListener() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;

      // 清除之前的定时器
      if (this.storageChangeTimer) {
        clearTimeout(this.storageChangeTimer);
      }

      // 防抖延迟 100ms，避免短时间内多次变化导致重复渲染
      this.storageChangeTimer = setTimeout(async () => {
        await this.dataManager.loadData();
        this._renderCurrentView();
      }, 100);
    });
  }

  /**
   * 更新视图UI显示（按钮状态和可见性）
   */
  _updateViewUI() {
    if (this.currentView === 'timeline') {
      document.getElementById('timelineViewBtn').classList.add('active');
      document.getElementById('groupViewBtn').classList.remove('active');
      document.getElementById('timelineView').style.display = 'block';
      document.getElementById('groupView').style.display = 'none';
    } else {
      document.getElementById('timelineViewBtn').classList.remove('active');
      document.getElementById('groupViewBtn').classList.add('active');
      document.getElementById('timelineView').style.display = 'none';
      document.getElementById('groupView').style.display = 'block';
    }
  }

  /**
   * 渲染当前视图
   */
  _renderCurrentView() {
    if (this.currentView === 'timeline') {
      this.timelineView.render();
    } else {
      this.groupView.render();
    }
  }

  /**
   * 切换到时序视图
   */
  async switchToTimelineView() {
    this.currentView = 'timeline';
    this._updateViewUI();
    this.timelineView.render();
    await this._saveViewState('timeline');

    if (this.onViewChange) {
      this.onViewChange('timeline');
    }
  }

  /**
   * 切换到分组视图
   */
  async switchToGroupView() {
    this.currentView = 'group';
    this._updateViewUI();
    this.groupView.render();
    await this._saveViewState('group');

    if (this.onViewChange) {
      this.onViewChange('group');
    }
  }

  /**
   * 保存视图状态到存储
   */
  async _saveViewState(view) {
    await this.dataManager.sendMessage('updateSettings', {
      settings: { lastView: view }
    });
  }

  /**
   * 设置初始视图
   */
  async setInitialView(view) {
    this.currentView = view || 'timeline';
    this._updateViewUI();
    this._renderCurrentView();
  }
}

export default EventManager;
