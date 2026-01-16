/**
 * TabBoard - 标签页看板主入口
 * 模块化架构，功能独立拆分
 *
 * @module TabBoard
 * @description 使用 jKanban 库实现拖拽分组、标签管理
 */

import DataManager from './core/DataManager.js';
import TimelineView from './core/TimelineView.js';
import GroupView from './core/GroupView.js';
import EventManager from './core/EventManager.js';

// 应用状态
class App {
  constructor() {
    this.dataManager = null;
    this.timelineView = null;
    this.groupView = null;
    this.eventManager = null;
  }

  /**
   * 初始化应用
   */
  async init() {
    // 创建数据管理器
    this.dataManager = new DataManager();

    // 创建视图
    this.timelineView = new TimelineView(this.dataManager);
    this.groupView = new GroupView(this.dataManager);

    // 创建事件管理器
    this.eventManager = new EventManager(
      this.dataManager,
      this.timelineView,
      this.groupView
    );

    // 加载数据
    const data = await this.dataManager.loadData();

    // 更新视图数据
    this.timelineView.updateData(data);
    this.groupView.updateData(data);

    // 设置初始视图
    const lastView = data.settings?.lastView || 'timeline';
    await this.eventManager.setInitialView(lastView);

    // 初始化事件监听器
    this.eventManager.init();

    // 监听数据变化，自动更新视图
    this.dataManager.onDataChange((newData) => {
      this.timelineView.updateData(newData);
      this.groupView.updateData(newData);
    });
  }
}

// 创建应用实例并初始化
const app = new App();

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
