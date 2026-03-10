/**
 * TabBoard Side Panel - 侧边栏控制器
 * 支持选择特定分组并显示其标签
 */

class SidebarController {
  constructor() {
    this.groups = [];
    this.tabs = {};
    this.currentGroupId = null;
    this.init();
  }

  async init() {
    await this.loadData();
    this.bindEvents();
    this.updateStats();
  }

  // 加载数据
  async loadData() {
    try {
      const data = await this.sendMessage({ action: 'getAllData' });
      this.groups = data.groups || [];
      this.tabs = data.tabs || {};

      // 加载上次选择的分组
      const settings = await this.getSettings();
      this.currentGroupId = settings.lastSelectedGroupId || null;

      this.renderGroupSelect();
      if (this.currentGroupId) {
        this.renderCurrentGroup();
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    }
  }

  // 发送消息到 background
  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response || {});
        }
      });
    });
  }

  // 获取设置
  getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {});
      });
    });
  }

  // 保存设置
  async saveSettings(settings) {
    const current = await this.getSettings();
    await chrome.storage.local.set({
      settings: { ...current, ...settings }
    });
  }

  // 绑定事件
  bindEvents() {
    // 刷新按钮
    document.getElementById('refreshBtn').addEventListener('click', () => {
      this.loadData();
    });

    // 分组选择
    document.getElementById('groupSelect').addEventListener('change', (e) => {
      this.currentGroupId = e.target.value || null;
      if (this.currentGroupId) {
        this.saveSettings({ lastSelectedGroupId: this.currentGroupId });
      }
      this.renderCurrentGroup();
    });

    // 打开全部按钮
    document.getElementById('openAllBtn').addEventListener('click', () => {
      this.openAllTabs();
    });

    // 清空分组按钮
    document.getElementById('clearGroupBtn').addEventListener('click', () => {
      this.clearGroup();
    });

    // 使用事件委托处理标签点击和删除
    document.getElementById('tabList').addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.tab-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const tabId = deleteBtn.dataset.tabId;
        this.deleteTab(tabId);
        return;
      }

      const tabItem = e.target.closest('.tab-item');
      if (tabItem) {
        const url = tabItem.dataset.url;
        this.openTab(url);
      }
    });
  }

  // 渲染分组选择器
  renderGroupSelect() {
    const select = document.getElementById('groupSelect');
    const options = this.groups.map(group => {
      const tabCount = this.tabs[group.id]?.length || 0;
      const selected = group.id === this.currentGroupId ? 'selected' : '';
      return `<option value="${group.id}" ${selected}>${group.name} (${tabCount})</option>`;
    }).join('');

    select.innerHTML = `<option value="">-- 选择分组 --</option>${options}`;
  }

  // 渲染当前分组信息
  renderCurrentGroup() {
    const groupInfo = document.getElementById('currentGroupInfo');
    const tabList = document.getElementById('tabList');

    if (!this.currentGroupId) {
      groupInfo.style.display = 'none';
      tabList.innerHTML = '<div class="empty-hint"><p>请选择一个分组查看标签</p></div>';
      return;
    }

    const group = this.groups.find(g => g.id === this.currentGroupId);
    const tabs = this.tabs[this.currentGroupId] || [];

    if (!group) {
      groupInfo.style.display = 'none';
      tabList.innerHTML = '<div class="empty-hint"><p>分组不存在</p></div>';
      return;
    }

    // 显示分组信息
    groupInfo.style.display = 'block';
    document.getElementById('groupColor').style.background = group.color;
    document.getElementById('groupName').textContent = group.name;
    document.getElementById('tabCount').textContent = `${tabs.length} 个标签`;

    // 渲染标签列表
    if (tabs.length === 0) {
      tabList.innerHTML = '<div class="empty-hint"><p>该分组暂无标签</p></div>';
    } else {
      tabList.innerHTML = tabs.map(tab => {
        const visitCount = tab.visitCount || 0;
        const visitBadge = visitCount > 0 ? `<span class="visit-badge" title="访问次数">👁 ${visitCount}</span>` : '';
        return `
        <div class="tab-item" data-url="${this.escapeHtml(tab.url)}">
          <img class="tab-favicon" src="${this.escapeHtml(tab.favicon || '')}" onerror="this.style.display='none'">
          <div class="tab-content">
            <div class="tab-title">${this.escapeHtml(tab.title)} ${visitBadge}</div>
            <div class="tab-url">${this.escapeHtml(tab.url)}</div>
          </div>
          <button class="tab-delete" data-tab-id="${tab.id}" title="删除">×</button>
        </div>
      `}).join('');
    }
  }

  // 更新统计信息
  updateStats() {
    const totalTabs = Object.values(this.tabs).flat().length;
    const groupCount = this.groups.length;
    document.getElementById('stats').textContent = `${groupCount} 个分组 · ${totalTabs} 个标签`;
  }

  // 打开单个标签
  async openTab(url) {
    await this.sendMessage({ action: 'openTab', url });
  }

  // 打开所有标签
  async openAllTabs() {
    if (!this.currentGroupId) return;
    await this.sendMessage({ action: 'openGroup', groupId: this.currentGroupId });
  }

  // 清空分组
  async clearGroup() {
    if (!this.currentGroupId) return;

    const group = this.groups.find(g => g.id === this.currentGroupId);
    const tabs = this.tabs[this.currentGroupId] || [];

    if (tabs.length === 0) return;

    if (!confirm(`确定要清空 "${group?.name}" 分组吗？`)) {
      return;
    }

    await this.sendMessage({ action: 'clearGroup', groupId: this.currentGroupId });
    await this.loadData();
  }

  // 删除单个标签
  async deleteTab(tabId) {
    if (!this.currentGroupId || !tabId) return;

    await this.sendMessage({
      action: 'deleteTab',
      tabId,
      groupId: this.currentGroupId
    });

    await this.loadData();
  }

  // HTML 转义
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new SidebarController();
});
