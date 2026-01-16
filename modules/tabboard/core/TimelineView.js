/**
 * TimelineView - 时序视图模块
 * 负责时序快照的渲染和交互
 */

import { escapeHtml, formatSnapshotTime, exportData, importData } from './Utils.js';

class TimelineView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.snapshots = [];
  }

  /**
   * 更新快照数据
   */
  updateData(data) {
    this.snapshots = data.timelineSnapshots || [];
  }

  /**
   * 渲染时序视图
   */
  render() {
    const emptyState = document.getElementById('emptyState');
    const stats = document.getElementById('stats');
    const timelineList = document.getElementById('timelineList');

    // 计算总快照数和标签数
    const totalSnapshots = this.snapshots.length;
    const totalTabs = this.snapshots.reduce((sum, s) => sum + s.tabs.length, 0);
    stats.textContent = `${totalSnapshots} 个快照 · ${totalTabs} 个标签页`;

    if (this.snapshots.length === 0) {
      timelineList.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    // 渲染快照列表
    timelineList.innerHTML = `
      <div class="timeline-actions-header">
        <button class="timeline-action-btn restore-all-btn" title="恢复所有快照">打开全部</button>
        <button class="timeline-action-btn clear-all-btn" title="清空所有快照">清空</button>
        <button class="timeline-action-btn export-timeline-btn" title="导出快照数据">导出</button>
        <button class="timeline-action-btn import-timeline-btn" title="导入快照数据">导入</button>
      </div>
      <div class="timeline-snapshots-list">
        ${this.snapshots.map(snapshot => this._renderSnapshot(snapshot)).join('')}
      </div>
    `;

    this._setupEventListeners();
  }

  /**
   * 渲染单个快照
   */
  _renderSnapshot(snapshot) {
    const displayTabs = snapshot.tabs.slice(0, 3);
    const hasMore = snapshot.tabs.length > 3;
    const moreCount = snapshot.tabs.length - 3;

    return `
      <div class="timeline-snapshot" data-snapshot-id="${snapshot.id}">
        <div class="snapshot-header">
          <div class="snapshot-info">
            <span class="snapshot-time">${formatSnapshotTime(snapshot.timestamp)}</span>
            <span class="snapshot-count">${snapshot.tabs.length} 个标签</span>
          </div>
          <div class="snapshot-actions">
            <button class="snapshot-action-btn restore-snapshot" data-id="${snapshot.id}" title="恢复此快照">📂 恢复</button>
            <button class="snapshot-action-btn delete-snapshot" data-id="${snapshot.id}" title="删除快照">🗑️</button>
          </div>
        </div>
        <div class="snapshot-tabs">
          ${displayTabs.map(tab => `
            <div class="snapshot-tab-row" data-url="${escapeHtml(tab.url)}">
              <img class="snapshot-tab-favicon" src="${escapeHtml(tab.favicon || '')}" loading="lazy">
              <span class="snapshot-tab-title">${escapeHtml(tab.title)}</span>
            </div>
          `).join('')}
          ${hasMore ? `
            <button class="snapshot-more-btn" data-snapshot-id="${snapshot.id}">
              还有 ${moreCount} 个标签... ▼
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * 设置时序视图事件监听器
   */
  _setupEventListeners() {
    // 点击快照中的标签行打开标签页
    document.querySelectorAll('.snapshot-tab-row').forEach(row => {
      row.addEventListener('click', () => {
        const url = row.dataset.url;
        if (url) {
          this.dataManager.sendMessage('openTab', { url });
        }
      });
    });

    // "更多"按钮 - 展开显示所有标签
    document.querySelectorAll('.snapshot-more-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._expandSnapshot(btn);
      });
    });

    // 恢复单个快照
    document.querySelectorAll('.restore-snapshot').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this._restoreSnapshot(btn.dataset.id);
      });
    });

    // 删除单个快照
    document.querySelectorAll('.delete-snapshot').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this._deleteSnapshot(btn.dataset.id);
      });
    });

    // 恢复所有快照按钮
    const restoreAllBtn = document.querySelector('.restore-all-btn');
    if (restoreAllBtn) {
      restoreAllBtn.addEventListener('click', () => this._restoreAllSnapshots());
    }

    // 清空所有快照按钮
    const clearAllBtn = document.querySelector('.clear-all-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => this._clearAllSnapshots());
    }

    // 导出快照数据按钮
    const exportBtn = document.querySelector('.export-timeline-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this._exportData());
    }

    // 导入快照数据按钮
    const importBtn = document.querySelector('.import-timeline-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this._importData());
    }
  }

  /**
   * 展开显示快照的所有标签
   */
  _expandSnapshot(btn) {
    const snapshotId = btn.dataset.snapshotId;
    const snapshot = this.snapshots.find(s => s.id === snapshotId);
    if (!snapshot) return;

    const tabsContainer = btn.parentElement;
    btn.remove();

    const remainingTabs = snapshot.tabs.slice(3);
    remainingTabs.forEach(tab => {
      const tabRow = document.createElement('div');
      tabRow.className = 'snapshot-tab-row';
      tabRow.dataset.url = tab.url;
      tabRow.innerHTML = `
        <img class="snapshot-tab-favicon" src="${escapeHtml(tab.favicon || '')}" loading="lazy">
        <span class="snapshot-tab-title">${escapeHtml(tab.title)}</span>
      `;
      tabRow.addEventListener('click', () => {
        this.dataManager.sendMessage('openTab', { url: tab.url });
      });
      tabsContainer.appendChild(tabRow);
    });
  }

  /**
   * 恢复单个快照
   */
  async _restoreSnapshot(snapshotId) {
    const result = await this.dataManager.sendMessage('restoreSnapshot', { snapshotId });
    if (result.success) {
      await this.dataManager.loadData();
      this.render();
    }
  }

  /**
   * 删除单个快照
   */
  async _deleteSnapshot(snapshotId) {
    if (!confirm('确定要删除这个快照吗？')) return;

    await this.dataManager.sendMessage('deleteTimelineSnapshot', { snapshotId });
    await this.dataManager.loadData();
    this.render();
  }

  /**
   * 恢复所有快照
   */
  async _restoreAllSnapshots() {
    const totalTabs = this.snapshots.reduce((sum, s) => sum + s.tabs.length, 0);
    if (!confirm(`确定要恢复所有 ${this.snapshots.length} 个快照吗？这将打开 ${totalTabs} 个标签页。`)) {
      return;
    }

    for (const snapshot of this.snapshots) {
      for (const tab of snapshot.tabs) {
        await this.dataManager.sendMessage('openTab', { url: tab.url });
      }
    }
  }

  /**
   * 清空所有快照
   */
  async _clearAllSnapshots() {
    if (!confirm(`确定要清空所有 ${this.snapshots.length} 个快照吗？`)) return;

    for (const snapshot of this.snapshots) {
      await this.dataManager.sendMessage('deleteTimelineSnapshot', { snapshotId: snapshot.id });
    }
    await this.dataManager.loadData();
    this.render();
  }

  /**
   * 导出快照数据
   */
  _exportData() {
    const data = {
      version: '1.0',
      exportTime: new Date().toISOString(),
      snapshots: this.snapshots
    };
    const filename = `tabboard-timeline-${new Date().toISOString().slice(0, 10)}.json`;
    exportData(data, filename);
  }

  /**
   * 导入快照数据
   */
  _importData() {
    importData(async (data) => {
      if (!data.snapshots || !Array.isArray(data.snapshots)) {
        alert('无效的数据格式');
        return;
      }

      const importCount = data.snapshots.length;
      if (!confirm(`确定要导入 ${importCount} 个快照吗？这将添加到现有快照中。`)) {
        return;
      }

      const importResult = await this.dataManager.sendMessage('importTimelineSnapshots', {
        snapshots: data.snapshots
      });

      if (importResult.success) {
        const totalImported = importResult.imported || 0;
        const totalSnapshots = importResult.total || 0;
        alert(`成功导入 ${totalImported} 个快照，当前共有 ${totalSnapshots} 个快照。`);
      } else {
        alert('导入失败，请重试。');
        return;
      }

      await this.dataManager.loadData();
      this.render();
    });
  }
}

export default TimelineView;
