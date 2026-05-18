/**
 * GroupModule - 分组看板模块入口
 */

import GroupView from './view.js';

class GroupModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new GroupView(dataManager);
  }

  init() {}

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    // 视图内部已绑定事件
  }

  destroy() {
    if (this.view.boardActionsObserver) {
      this.view.boardActionsObserver.disconnect();
    }
    const container = document.getElementById('tabboard');
    if (container) container.innerHTML = '';
    this.view.kanban = null;
  }
}

export default GroupModule;
