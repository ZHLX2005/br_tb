/**
 * RecordingModule - 录制回放模块入口
 */

import RecordingView from './view.js';

class RecordingModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new RecordingView(dataManager);
  }

  async init() {
    await this.view.init();
  }

  render(data) {
    this.view.recordingState = data.recordingState || {};
    this.view.recordings = data.recordings || [];
    this.view.render();
  }

  bindEvents() {
    this.view.bindEvents();
  }

  destroy() {
    this.view.destroy();
  }
}

export default RecordingModule;
