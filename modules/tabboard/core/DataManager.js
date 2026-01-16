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
      settings: {}
    };
    this.listeners = [];
  }

  /**
   * 加载所有数据
   * 使用 'in' 操作符检查 key，避免空数组被 falsy 判断导致不更新
   */
  async loadData() {
    const data = await chrome.storage.local.get(['groups', 'tabs', 'timelineSnapshots', 'settings']);

    if ('groups' in data) {
      this.data.groups = data.groups;
    }
    if ('tabs' in data) {
      this.data.tabs = data.tabs;
    }
    if ('timelineSnapshots' in data) {
      this.data.timelineSnapshots = data.timelineSnapshots;
    }
    if ('settings' in data) {
      this.data.settings = data.settings;
    }

    this.notifyListeners();
    return this.data;
  }

  /**
   * 获取数据的getter方法
   */
  get groups() { return this.data.groups; }
  get tabs() { return this.data.tabs; }
  get timelineSnapshots() { return this.data.timelineSnapshots; }
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
    return chrome.runtime.sendMessage({ action, ...data });
  }
}

export default DataManager;
