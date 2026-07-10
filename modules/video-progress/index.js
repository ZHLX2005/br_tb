/**
 * VideoProgressModule - 视频进度聚合模块入口
 */

import VideoProgressView from './view.js';

class VideoProgressModule {
  constructor(container, dataManager, eventBus, mode = 'full') {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.mode = mode;
    this.view = new VideoProgressView(dataManager, mode);
    // Skill §3.1:立即把 container 传给 view,让 view 在 init() 之前就能拿到 DOM 引用
    this.view.setContainer(container);
  }

  async init() {
    await this.view.init();
  }

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    this.view.bindEvents();
  }

  destroy() {
    this.view.destroy();
  }

  /**
   * skill §3.2 / tabboard.js._reattachModule 调用,确保 view 重新挂回新 container 后仍可工作
   */
  _reattach(container) {
    this.container = container;
    this.view.setContainer(container);
  }
}

export default VideoProgressModule;
