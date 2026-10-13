/**
 * SyncModule - 数据同步 / native host 管理模块入口
 *
 * 从 popup 迁入：popup 只做轻量快捷操作，数据管理这类"重"交互放到看板页。
 * 承载三块：
 *   1. native host 状态 + 启动/关闭/检查
 *   2. 同步到本地数据湖
 *   3. 全量备份（导出 JSON / 导入还原）
 */
import SyncView from './view.js';

class SyncModule {
  constructor(container, dataManager, eventBus) {
    this.container = container;
    this.dataManager = dataManager;
    this.eventBus = eventBus;
    this.view = new SyncView(dataManager);
  }

  init() {
    this.view.setContainer(this.container);
    this.view.init();
  }

  render(data) {
    this.view.updateData(data);
    this.view.render();
  }

  bindEvents() {
    // 视图内部自绑定（render 时 _bindEvents）
  }

  destroy() {
    this.view.destroy();
  }
}

export default SyncModule;
