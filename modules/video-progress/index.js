/**
 * VideoProgressModule - 视频进度聚合模块入口
 */

import VideoProgressView from './view.js';

class VideoProgressModule {
  constructor(container, dataManager, eventBus, mode = 'full') {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new VideoProgressView(dataManager, mode);
  }

  async init() {
    await this.view.init();
  }

  render(data) {
    this.view.videoGroups = data.videoGroups || [];
    this.view.render();
  }

  bindEvents() {
    this.view.bindEvents();
  }

  destroy() {
    this.view.destroy();
  }
}

export default VideoProgressModule;
