/**
 * TabBoard Side Panel - 侧边栏控制器
 * 支持多页面：分组、表单收集、设置
 */

class SidebarController {
  constructor() {
    this.groups = [];
    this.tabs = {};
    this.currentGroupId = null;
    this.formData = {}; // 表单数据 { url: { fields: [], checkboxes: [], timestamp: '' } }
    this.currentPage = 'groups';
    this.init();
  }

  async init() {
    await this.loadData();
    await this.loadFormData();
    this.bindEvents();
    this.bindNavigation();
    this.updateStats();
    this.bindMessageListener();
  }

  // 监听来自 content script 的消息
  bindMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'TABBOARD_PICK_RESULT') {
        this.handlePickerResult(message.data);
      } else if (message.type === 'TABBOARD_PICK_CANCEL') {
        this.handlePickerCancel();
      }
    });

    // 监听存储变化，自动刷新
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (changes.formData) {
        this.loadFormData();
      }
    });
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

  // 加载表单数据
  async loadFormData() {
    const result = await chrome.storage.local.get(['formData']);
    this.formData = result.formData || {};
    this.renderFormList();
    this.updateFormSummary();
  }

  // 保存表单数据
  async saveFormData() {
    await chrome.storage.local.set({ formData: this.formData });
    this.renderFormList();
    this.updateFormSummary();
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

  // 绑定导航事件
  bindNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        this.switchPage(page);
      });
    });
  }

  // 切换页面
  switchPage(pageName) {
    // 更新导航按钮
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === pageName);
    });

    // 更新页面显示
    document.querySelectorAll('.page').forEach(page => {
      page.classList.toggle('active', page.id === `page-${pageName}`);
    });

    this.currentPage = pageName;
  }

  // 绑定事件
  bindEvents() {
    // 分组页面 - 刷新按钮
    document.getElementById('refreshGroupsBtn')?.addEventListener('click', () => {
      this.loadData();
    });

    // 分组选择
    document.getElementById('groupSelect')?.addEventListener('change', (e) => {
      this.currentGroupId = e.target.value || null;
      if (this.currentGroupId) {
        this.saveSettings({ lastSelectedGroupId: this.currentGroupId });
      }
      this.renderCurrentGroup();
    });

    // 打开全部按钮
    document.getElementById('openAllBtn')?.addEventListener('click', () => {
      this.openAllTabs();
    });

    // 清空分组按钮
    document.getElementById('clearGroupBtn')?.addEventListener('click', () => {
      this.clearGroup();
    });

    // 标签列表点击事件
    document.getElementById('tabList')?.addEventListener('click', (e) => {
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

    // 表单页面 - 拾取器按钮
    document.getElementById('startPickerBtn')?.addEventListener('click', () => {
      this.startElementPicker();
    });

    // 表单页面 - 导出按钮
    document.getElementById('exportFormsBtn')?.addEventListener('click', () => {
      this.exportFormData();
    });

    // 表单页面 - 清空按钮
    document.getElementById('clearFormsBtn')?.addEventListener('click', () => {
      this.clearAllFormData();
    });

    // 表单列表点击事件（展开/收起）
    document.getElementById('formList')?.addEventListener('click', (e) => {
      const header = e.target.closest('.form-item-header');
      if (header) {
        const item = header.closest('.form-item');
        item.classList.toggle('expanded');
        return;
      }

      // 删除按钮
      const deleteBtn = e.target.closest('.delete-form-btn');
      if (deleteBtn) {
        e.stopPropagation();
        const url = deleteBtn.dataset.url;
        this.deleteFormData(url);
      }
    });
  }

  // 显示Toast提示
  showToast(message, type = 'info') {
    const existing = document.querySelector('.sidebar-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `sidebar-toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // 启动元素拾取器
  async startElementPicker() {
    try {
      const result = await this.sendMessage({ action: 'startElementPicker' });

      if (!result.success) {
        this.showToast(result.error || '无法启动拾取器', 'error');
        return;
      }

      // 显示拾取状态
      document.getElementById('pickerStatus').style.display = 'block';
      this.showToast('点击页面元素捕获', 'success');
    } catch (error) {
      console.error('启动拾取器失败:', error);
      this.showToast('启动拾取器失败', 'error');
    }
  }

  // 处理拾取结果
  async handlePickerResult(data) {
    // 隐藏拾取状态
    document.getElementById('pickerStatus').style.display = 'none';

    // 获取当前标签页的 URL 作为 key
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = new URL(tab.url).origin + new URL(tab.url).pathname;

    // 获取现有数据
    const storage = await chrome.storage.local.get(['formData']);
    const formData = storage.formData || {};

    if (!formData[url]) {
      formData[url] = {
        fields: [],
        checkboxes: [],
        standaloneInputs: [],
        timestamp: new Date().toISOString(),
        pageTitle: tab.title,
        fullUrl: tab.url,
        pickedElements: []
      };
    }

    // 添加拾取的元素
    if (!formData[url].pickedElements) {
      formData[url].pickedElements = [];
    }

    formData[url].pickedElements.push({
      tagName: data.tagName,
      id: data.id,
      name: data.name,
      value: data.value,
      text: data.text,
      placeholder: data.placeholder,
      href: data.href,
      timestamp: data.timestamp
    });

    await chrome.storage.local.set({ formData });
    await this.loadFormData();

    this.showToast(`已捕获: <${data.tagName}>`, 'success');
  }

  // 处理拾取取消
  handlePickerCancel() {
    document.getElementById('pickerStatus').style.display = 'none';
    this.showToast('已取消拾取', 'info');
  }

  // 渲染已捕获的元素列表
  renderFormList() {
    const formList = document.getElementById('formList');
    const sites = Object.keys(this.formData);

    if (sites.length === 0) {
      formList.innerHTML = '<div class="empty-hint">点击 🎯 按钮，在页面上选择元素</div>';
      return;
    }

    let totalElements = 0;

    formList.innerHTML = sites.map(site => {
      const data = this.formData[site];
      const picked = data.pickedElements || [];
      totalElements += picked.length;

      if (picked.length === 0) return '';

      const fieldPreviews = picked.slice(0, 5).map(f => `
        <div class="form-field">
          <div class="form-field-label">${f.tagName ? `<${f.tagName}>` : ''} ${this.escapeHtml(f.name || '')}</div>
          <div class="form-field-value">${this.escapeHtml(String(f.text || f.value || '').slice(0, 100))}</div>
        </div>
      `).join('');

      return `
        <div class="form-item">
          <div class="form-item-header">
            <span class="form-site">${this.escapeHtml(site)}</span>
            <span class="form-count">${picked.length} 个</span>
          </div>
          <div class="form-item-content">
            ${fieldPreviews}
            <div class="form-item-actions">
              <button class="action-btn delete-form-btn" data-url="${this.escapeHtml(site)}">删除</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 更新元素总数
    document.getElementById('elementCount').textContent = totalElements;
  }

  // 更新表单统计
  updateFormSummary() {
    const siteCount = Object.keys(this.formData).length;
    document.getElementById('siteCount').textContent = siteCount;
  }

  // 导出表单数据
  exportFormData() {
    const data = {
      version: '1.0',
      exportTime: new Date().toISOString(),
      formData: this.formData
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabboard-forms-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('已导出数据', 'success');
  }

  // 清空所有表单数据
  async clearAllFormData() {
    if (Object.keys(this.formData).length === 0) {
      this.showToast('没有数据可清空', 'info');
      return;
    }
    this.formData = {};
    await this.saveFormData();
    this.showToast('已清空所有数据', 'success');
  }

  // 删除单个网站的表单数据
  async deleteFormData(url) {
    delete this.formData[url];
    await this.saveFormData();
    this.showToast('已删除', 'success');
  }

  // 渲染分组选择器
  renderGroupSelect() {
    const select = document.getElementById('groupSelect');
    if (!select) return;

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
      tabList.innerHTML = '<div class="empty-hint">请选择一个分组查看标签</div>';
      return;
    }

    const group = this.groups.find(g => g.id === this.currentGroupId);
    const tabs = this.tabs[this.currentGroupId] || [];

    if (!group) {
      groupInfo.style.display = 'none';
      tabList.innerHTML = '<div class="empty-hint">分组不存在</div>';
      return;
    }

    // 显示分组信息
    groupInfo.style.display = 'block';
    document.getElementById('groupColor').style.background = group.color;
    document.getElementById('groupName').textContent = group.name;
    document.getElementById('tabCount').textContent = `${tabs.length} 个标签`;

    // 渲染标签列表
    if (tabs.length === 0) {
      tabList.innerHTML = '<div class="empty-hint">该分组暂无标签</div>';
    } else {
      tabList.innerHTML = tabs.map(tab => {
        const visitCount = tab.visitCount || 0;
        const visitBadge = visitCount > 0 ? `<span class="visit-badge">👁 ${visitCount}</span>` : '';
        return `
        <div class="tab-item" data-url="${this.escapeHtml(tab.url)}">
          <img class="tab-favicon" src="${this.escapeHtml(tab.favicon || '')}" onerror="this.style.display='none'">
          <div class="tab-content">
            <div class="tab-title">${this.escapeHtml(tab.title)} ${visitBadge}</div>
            <div class="tab-url">${this.escapeHtml(tab.url)}</div>
          </div>
          <button class="tab-delete" data-tab-id="${tab.id}">×</button>
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

    await this.sendMessage({ action: 'clearGroup', groupId: this.currentGroupId });
    await this.loadData();
    this.showToast(`已清空 "${group?.name}"`, 'success');
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
