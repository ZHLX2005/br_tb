/**
 * DataManager - 数据管理模块
 * 负责所有数据的加载、存储和同步
 */

class DataManager {
  constructor() {
    this.data = {
      groups: [],
      tabs: {},
      timelineSnapshots: [],
      recordings: [],
      recordingState: {},
      videoGroups: [],
      leetcodeProgress: {},
      settings: {}
    };
    this.listeners = [];
  }

  /**
   * 加载所有数据
   * 使用 'in' 操作符检查 key，避免空数组被 falsy 判断导致不更新
   */
  async loadData() {
    const data = await chrome.storage.local.get([
      'groups', 'tabs', 'timelineSnapshots', 'recordings', 'recordingState', 'videoGroups', 'leetcodeProgress', 'settings'
    ]);

    if ('groups' in data) {
      this.data.groups = data.groups;
    }
    if ('tabs' in data) {
      this.data.tabs = data.tabs;
    }
    if ('timelineSnapshots' in data) {
      this.data.timelineSnapshots = data.timelineSnapshots;
    }
    if ('recordings' in data) {
      this.data.recordings = data.recordings;
    }
    if ('recordingState' in data) {
      this.data.recordingState = data.recordingState;
    }
    if ('videoGroups' in data) {
      this.data.videoGroups = data.videoGroups;
    }
    if ('leetcodeProgress' in data) {
      this.data.leetcodeProgress = data.leetcodeProgress;
    }
    if ('settings' in data) {
      this.data.settings = data.settings;
    }

    this.notifyListeners();
    return this.data;
  }

  /**
   * 获取数据的 getter 方法
   */
  get groups() { return this.data.groups; }
  get tabs() { return this.data.tabs; }
  get timelineSnapshots() { return this.data.timelineSnapshots; }
  get recordings() { return this.data.recordings; }
  get recordingState() { return this.data.recordingState; }
  get videoGroups() { return this.data.videoGroups; }
  get leetcodeProgress() { return this.data.leetcodeProgress; }
  get settings() { return this.data.settings; }

  /**
   * 注册数据变化监听器
   */
  onDataChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  /**
   * 通知所有监听器数据已更新
   */
  notifyListeners() {
    this.listeners.forEach(callback => callback(this.data));
  }

  /**
   * 通过 background 发送消息
   */
  async sendMessage(action, data = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[DataManager] Message error:', chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: true });
        }
      });
    });
  }
}

export default DataManager;
