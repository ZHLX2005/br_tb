/**
 * LeetCodeModule - LeetCode 150 追踪模块入口
 */

import LeetCodeView from './view.js';

class LeetCodeModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new LeetCodeView(dataManager);
  }

  init() {
    this.view.setContainer(this.container);
  }

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    // 视图内部已绑定事件
  }

  destroy() {
    this.view.container = null;
  }
}

export default LeetCodeModule;
