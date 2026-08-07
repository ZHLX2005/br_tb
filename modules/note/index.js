/**
 * NoteModule - 便签页模块入口
 *
 * 结构：
 *   1) 页面列表（侧边） - 所有便签页，支持新建/重命名/删除/绑定 tab
 *   2) 文章编辑器（主区） - 每页一篇完整可编辑文章，自动保存
 */

import NoteView from './view.js';

class NoteModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new NoteView(dataManager);
  }

  init() {
    this.view.setContainer(this.container);
  }

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    // 视图内已通过委托绑定
  }

  destroy() {
    this.view.container = null;
    if (typeof this.view.destroy === 'function') {
      this.view.destroy();
    }
  }
}

export default NoteModule;