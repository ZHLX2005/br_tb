/**
 * BilibiliHistoryModule - B 站观看历史模块入口
 */

import BilibiliHistoryView from './view.js';

class BilibiliHistoryModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new BilibiliHistoryView(dataManager);
  }

  init() {
    this.view.setContainer(this.container);
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
}

export default BilibiliHistoryModule;
