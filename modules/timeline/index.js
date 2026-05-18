/**
 * TimelineModule - 时间轴模块入口
 */

import TimelineView from './view.js';

class TimelineModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new TimelineView(dataManager);
  }

  init() {
    this.view.initSearch();
  }

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    // 视图内部已绑定事件
  }

  destroy() {
    this.view._hideSearchDropdown();
    this.view._hideContextMenu();
  }
}

export default TimelineModule;
