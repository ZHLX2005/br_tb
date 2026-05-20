/**
 * VideoProgressShell - 视频进度页面独立入口
 */

import DataManager from '../shared/data-manager.js';
import VideoProgressModule from './index.js';

class VideoProgressShell {
  constructor() {
    this.dataManager = new DataManager();
    this.module = null;
    this.storageChangeTimer = null;
  }

  async init() {
    const data = await this.dataManager.loadData();
    this.module = new VideoProgressModule(document.body, this.dataManager, null);
    await this.module.init();
    this.module.render(data);
    this.module.bindEvents();

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;
      if (this.storageChangeTimer) clearTimeout(this.storageChangeTimer);
      this.storageChangeTimer = setTimeout(async () => {
        const newData = await this.dataManager.loadData();
        this.module.render(newData);
      }, 100);
    });
  }
}

const shell = new VideoProgressShell();
document.addEventListener('DOMContentLoaded', () => shell.init());
