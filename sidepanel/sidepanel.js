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
    this.selectionMode = false;
    this.selectedItems = new Set(); // 存储选中的 (site, index) 元组
    this.saveTimeout = null; // 防抖保存
    this.jsonLibLoaded = false; // JSON 库加载状态
    this.autoDetectJson = true; // 自动检测 JSON
    this.init();
  }

  async init() {
    await this.loadData();
    await this.loadFormData();
    await this.loadSettings();
    this.bindEvents();
    this.bindNavigation();
    this.updateStats();
    this.bindMessageListener();
  }

  // 加载设置
  async loadSettings() {
    const settings = await this.getSettings();
    this.autoDetectJson = settings.autoDetectJson !== false;
    // 更新设置页面开关状态
    const autoDetectCheckbox = document.getElementById('autoDetectJson');
    if (autoDetectCheckbox) {
      autoDetectCheckbox.checked = this.autoDetectJson;
    }
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

  // 保存表单数据（防抖）
  async saveFormData() {
    // 清除之前的定时器
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // 设置新的定时器，300ms 后保存
    this.saveTimeout = setTimeout(async () => {
      await chrome.storage.local.set({ formData: this.formData });
      this.renderFormList();
      this.updateFormSummary();
    }, 300);
  }

  // 立即保存表单数据
  async saveFormDataImmediate() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await chrome.storage.local.set({ formData: this.formData });
    this.renderFormList();
    this.updateFormSummary();
  }

  // 创建数据备份
  async createBackup() {
    const backup = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      formData: this.formData
    };

    // 获取现有备份
    const result = await chrome.storage.local.get(['formDataBackup']);
    let backups = result.formDataBackup || [];

    // 只保留最近5个备份
    backups = [backup, ...backups].slice(0, 5);

    await chrome.storage.local.set({ formDataBackup: backups });
  }

  // 从备份恢复
  async restoreFromBackup(backupIndex = 0) {
    const result = await chrome.storage.local.get(['formDataBackup']);
    const backups = result.formDataBackup || [];

    if (!backups[backupIndex]) {
      this.showToast('没有可用的备份', 'error');
      return false;
    }

    this.formData = backups[backupIndex].formData;
    await this.saveFormDataImmediate();
    this.showToast('已从备份恢复', 'success');
    return true;
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

    // 表单页面 - 手动添加按钮
    document.getElementById('addManualBtn')?.addEventListener('click', () => {
      this.toggleManualAddForm();
    });

    // 表单页面 - 取消添加
    document.getElementById('cancelAddBtn')?.addEventListener('click', () => {
      this.hideManualAddForm();
    });

    // 表单页面 - 确认添加
    document.getElementById('confirmAddBtn')?.addEventListener('click', () => {
      this.addManualEntry();
    });

    // JSON 实时预览
    document.getElementById('manualValue')?.addEventListener('input', (e) => {
      const value = e.target.value;
      const previewEl = document.getElementById('jsonPreview');
      const statusEl = document.getElementById('jsonStatus');
      this.detectAndPreviewJson(value, previewEl, statusEl);
    });

    // 搜索输入
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
      this.filterFormList(e.target.value);
    });

    // 表单页面 - 拾取器按钮
    document.getElementById('startPickerBtn')?.addEventListener('click', () => {
      this.startElementPicker();
    });

    // 表单页面 - 导出按钮
    document.getElementById('exportFormsBtn')?.addEventListener('click', () => {
      this.exportFormData();
    });

    // 表单页面 - 导入按钮
    document.getElementById('importFormsBtn')?.addEventListener('click', () => {
      this.showImportDialog();
    });

    // 表单页面 - 清空按钮
    document.getElementById('clearFormsBtn')?.addEventListener('click', () => {
      this.clearAllFormData();
    });

    // 批量操作 - 全选按钮
    document.getElementById('selectAllBtn')?.addEventListener('click', () => {
      this.toggleSelectionMode();
    });

    // 批量操作 - 批量删除
    document.getElementById('batchDeleteBtn')?.addEventListener('click', () => {
      this.batchDeleteSelected();
    });

    // 批量操作 - 批量导出
    document.getElementById('batchExportBtn')?.addEventListener('click', () => {
      this.batchExportSelected();
    });

    // 批量操作 - 取消选择
    document.getElementById('cancelSelectBtn')?.addEventListener('click', () => {
      this.cancelSelection();
    });

    // 设置页面 - 加载 JSON 增强库
    document.getElementById('loadJsonLibBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('loadJsonLibBtn');
      const statusEl = document.getElementById('libStatus');

      btn.disabled = true;
      btn.textContent = '加载中...';

      const success = await this.loadJsonLib();

      if (success) {
        statusEl.textContent = '✓ 已加载';
        statusEl.style.color = '#4caf50';
        btn.textContent = '✓ 已加载';
        this.showToast('JSON 增强库已加载', 'success');
      } else {
        statusEl.textContent = '✗ 加载失败';
        statusEl.style.color = '#f44336';
        btn.textContent = '📦 加载 JSON 增强库';
        btn.disabled = false;
        this.showToast('使用内置 JSON 解析器', 'info');
      }
    });

    // 设置页面 - JSON 自动检测开关
    document.getElementById('autoDetectJson')?.addEventListener('change', (e) => {
      this.autoDetectJson = e.target.checked;
      this.saveSettings({ autoDetectJson: e.target.checked });
      this.renderFormList();
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

  // JSON 格式检测和渲染
  detectAndPreviewJson(value, previewEl, statusEl) {
    const trimmed = value.trim();

    if (!trimmed) {
      previewEl.classList.remove('show');
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'json-status empty';
      }
      return null;
    }

    // 尝试解析 JSON
    try {
      const parsed = JSON.parse(trimmed);
      // 渲染格式化的 JSON
      const formatted = this.formatJson(parsed);
      previewEl.innerHTML = formatted;
      previewEl.classList.add('show');

      if (statusEl) {
        statusEl.textContent = '✓ 有效 JSON';
        statusEl.className = 'json-status valid';
      }
      return parsed;
    } catch (e) {
      // 不是有效 JSON
      previewEl.classList.remove('show');
      if (statusEl) {
        statusEl.textContent = '✗ 无效 JSON';
        statusEl.className = 'json-status invalid';
      }
      return null;
    }
  }

  // 格式化 JSON 并高亮显示
  formatJson(obj, indent = 0) {
    const spaces = '  '.repeat(indent);

    if (obj === null) {
      return `<span class="json-null">null</span>`;
    }

    if (typeof obj === 'boolean') {
      return `<span class="json-boolean">${obj}</span>`;
    }

    if (typeof obj === 'number') {
      return `<span class="json-number">${obj}</span>`;
    }

    if (typeof obj === 'string') {
      return `<span class="json-string">"${this.escapeHtml(obj)}"</span>`;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';

      const items = obj.map(item => {
        return spaces + '  ' + this.formatJson(item, indent + 1);
      }).join(',\n');

      return `[\n${items}\n${spaces}]`;
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) return '{}';

      const items = keys.map(key => {
        const value = this.formatJson(obj[key], indent + 1);
        return `${spaces}  <span class="json-key">"${this.escapeHtml(key)}"</span>: ${value}`;
      }).join(',\n');

      return `{\n${items}\n${spaces}}`;
    }

    return String(obj);
  }

  // 加载外部 JSON 库 (jsonlint 或 similar)
  async loadJsonLib() {
    if (this.jsonLibLoaded) return true;

    // 尝试从 CDN 加载 JSON 验证/格式化库
    return new Promise((resolve) => {
      // 创建脚本标签
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jsonlint@1.6.3/web/jsonlint.min.js';
      script.onload = () => {
        this.jsonLibLoaded = true;
        console.log('JSON library loaded');
        resolve(true);
      };
      script.onerror = () => {
        // 如果 CDN 加载失败，使用内置功能
        console.warn('Failed to load external JSON library, using built-in parser');
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }

  // 验证 JSON 格式
  validateJson(value) {
    const trimmed = value.trim();
    if (!trimmed) return { valid: false, error: 'Empty value' };

    try {
      const parsed = JSON.parse(trimmed);
      return { valid: true, data: parsed };
    } catch (e) {
      return { valid: false, error: e.message };
    }
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

  // 显示编辑对话框
  showEditDialog(site, index, name, value) {
    // 移除已存在的对话框
    const existing = document.getElementById('editDialog');
    if (existing) existing.remove();

    // 检查是否是 JSON
    const isJson = this.validateJson(value).valid;

    // 创建对话框
    const dialog = document.createElement('div');
    dialog.id = 'editDialog';
    dialog.className = 'edit-dialog-overlay';
    dialog.innerHTML = `
      <div class="edit-dialog">
        <div class="edit-dialog-header">
          <h3>编辑条目</h3>
          <button class="edit-dialog-close">&times;</button>
        </div>
        <div class="edit-dialog-body">
          <div class="edit-field">
            <label>名称</label>
            <input type="text" id="editName" placeholder="名称/标签">
          </div>
          <div class="edit-field">
            <label>内容 ${isJson ? '<span class="json-status valid">✓ JSON</span>' : ''}</label>
            <textarea id="editValue" placeholder="内容"></textarea>
            <div id="editJsonPreview" class="json-preview"></div>
          </div>
        </div>
        <div class="edit-dialog-footer">
          <button class="btn-cancel">取消</button>
          <button class="btn-save">保存</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // 绑定事件
    const closeDialog = () => dialog.remove();
    const editNameEl = document.getElementById('editName');
    const editValueEl = document.getElementById('editValue');
    const editPreviewEl = document.getElementById('editJsonPreview');

    // 设置原始值（使用 value 属性而不是 innerHTML）
    editNameEl.value = name;
    editValueEl.value = value;

    // 初始预览
    if (isJson) {
      this.detectAndPreviewJson(value, editPreviewEl, null);
    }

    // 输入时实时预览
    editValueEl.addEventListener('input', () => {
      this.detectAndPreviewJson(editValueEl.value, editPreviewEl, null);
    });

    dialog.querySelector('.edit-dialog-close').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-save').addEventListener('click', async () => {
      const newName = document.getElementById('editName').value.trim();
      const newValue = editValueEl.value.trim();

      // 更新数据
      const data = this.formData[site];
      if (data && data.pickedElements && data.pickedElements[index]) {
        data.pickedElements[index].name = newName;
        data.pickedElements[index].text = newValue;
        data.pickedElements[index].value = newValue;
        this.saveFormDataDirect(this.formData);
        this.showToast('已更新', 'success');
      }

      closeDialog();
      // 立即保存
      await this.saveFormDataImmediate();
    });

    // 点击遮罩关闭
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });

    // 聚焦内容输入框
    editValueEl.focus();
  }

  // 切换手动添加表单显示
  toggleManualAddForm() {
    const form = document.getElementById('manualAddForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display !== 'none') {
      document.getElementById('manualName').focus();
    }
  }

  // 隐藏手动添加表单
  hideManualAddForm() {
    document.getElementById('manualAddForm').style.display = 'none';
    document.getElementById('manualName').value = '';
    document.getElementById('manualValue').value = '';
  }

  // 添加手动条目
  async addManualEntry() {
    const name = document.getElementById('manualName').value.trim();
    const value = document.getElementById('manualValue').value.trim();

    if (!value) {
      this.showToast('请输入内容', 'error');
      return;
    }

    // 获取当前活动标签页的URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      this.showToast('无法获取当前页面', 'error');
      return;
    }

    const url = new URL(tab.url).origin + new URL(tab.url).pathname;

    // 获取现有数据
    const storage = await chrome.storage.local.get(['formData']);
    const formData = storage.formData || {};

    if (!formData[url]) {
      formData[url] = {
        pickedElements: [],
        timestamp: new Date().toISOString(),
        pageTitle: tab.title,
        fullUrl: tab.url
      };
    }

    if (!formData[url].pickedElements) {
      formData[url].pickedElements = [];
    }

    // 添加新条目
    formData[url].pickedElements.push({
      tagName: 'manual',
      name: name || '手动添加',
      text: value,
      value: value,
      timestamp: new Date().toISOString()
    });

    await chrome.storage.local.set({ formData });
    await this.loadFormData();

    this.hideManualAddForm();
    this.showToast('已添加', 'success');
    // 立即保存
    await this.saveFormDataImmediate();
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
    // 立即保存
    await this.saveFormDataImmediate();
  }

  // 处理拾取取消
  handlePickerCancel() {
    document.getElementById('pickerStatus').style.display = 'none';
    this.showToast('已取消拾取', 'info');
  }

  // 过滤表单列表
  filterFormList(keyword) {
    const items = document.querySelectorAll('.form-item');
    const k = keyword.toLowerCase().trim();

    items.forEach(item => {
      const site = item.querySelector('.form-site')?.textContent.toLowerCase() || '';
      const values = Array.from(item.querySelectorAll('.form-field-value')).map(el => el.textContent.toLowerCase()).join(' ');

      if (!k || site.includes(k) || values.includes(k)) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  }

  // 切换选择模式
  toggleSelectionMode() {
    this.selectionMode = !this.selectionMode;
    this.selectedItems.clear();

    const batchBar = document.getElementById('batchActionsBar');
    const selectAllBtn = document.getElementById('selectAllBtn');

    if (this.selectionMode) {
      batchBar.style.display = 'flex';
      selectAllBtn.style.background = '#e3f2fd';
      selectAllBtn.style.borderRadius = '4px';
      this.renderFormList();
    } else {
      batchBar.style.display = 'none';
      selectAllBtn.style.background = '';
      selectAllBtn.style.borderRadius = '';
      this.cancelSelection();
    }
  }

  // 切换单个项目选择
  toggleItemSelection(site, index) {
    const key = `${site}|||${index}`;
    if (this.selectedItems.has(key)) {
      this.selectedItems.delete(key);
    } else {
      this.selectedItems.add(key);
    }
    this.updateSelectedCount();
    this.updateCheckboxState(site, index);
  }

  // 更新选中计数
  updateSelectedCount() {
    const count = this.selectedItems.size;
    document.getElementById('selectedCount').textContent = `已选择 ${count} 项`;
  }

  // 更新复选框状态
  updateCheckboxState(site, index) {
    const checkbox = document.querySelector(`.field-checkbox[data-site="${CSS.escape(site)}"][data-index="${index}"]`);
    if (checkbox) {
      const key = `${site}|||${index}`;
      checkbox.checked = this.selectedItems.has(key);
    }
  }

  // 批量删除选中项
  async batchDeleteSelected() {
    if (this.selectedItems.size === 0) {
      this.showToast('请先选择要删除的项', 'info');
      return;
    }

    // 从后向前删除，避免索引变化
    const itemsToDelete = Array.from(this.selectedItems).reverse();

    for (const key of itemsToDelete) {
      const [site, indexStr] = key.split('|||');
      const index = parseInt(indexStr);
      const data = this.formData[site];
      if (data && data.pickedElements) {
        data.pickedElements.splice(index, 1);
      }
    }

    // 清理空站点
    for (const site in this.formData) {
      if (!this.formData[site].pickedElements || this.formData[site].pickedElements.length === 0) {
        delete this.formData[site];
      }
    }

    this.saveFormDataDirect(this.formData);
    this.showToast(`已删除 ${itemsToDelete.length} 项`, 'success');
    this.cancelSelection();
    // 立即保存
    await this.saveFormDataImmediate();
  }

  // 批量导出选中项
  batchExportSelected() {
    if (this.selectedItems.size === 0) {
      this.showToast('请先选择要导出的项', 'info');
      return;
    }

    const exportData = {};
    for (const key of this.selectedItems) {
      const [site, indexStr] = key.split('|||');
      const index = parseInt(indexStr);
      const element = this.formData[site]?.pickedElements?.[index];
      if (element) {
        if (!exportData[site]) {
          exportData[site] = { pickedElements: [], pageTitle: this.formData[site].pageTitle };
        }
        exportData[site].pickedElements.push(element);
      }
    }

    const blob = new Blob([JSON.stringify({
      version: '1.0',
      exportTime: new Date().toISOString(),
      formData: exportData,
      count: this.selectedItems.size
    }, null, 2)], { type: 'application/json' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabboard-selected-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.showToast(`已导出 ${this.selectedItems.size} 项`, 'success');
    this.cancelSelection();
  }

  // 取消选择
  cancelSelection() {
    this.selectionMode = false;
    this.selectedItems.clear();

    document.getElementById('batchActionsBar').style.display = 'none';
    document.getElementById('selectAllBtn').style.background = '';
    document.getElementById('selectAllBtn').style.borderRadius = '';

    this.renderFormList();
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

      const fieldPreviews = picked.map((f, idx) => {
        const checkbox = this.selectionMode
          ? `<input type="checkbox" class="field-checkbox" data-site="${this.escapeHtml(site)}" data-index="${idx}">`
          : '';

        const rawValue = f.text || f.value || '';
        const isJson = this.validateJson(rawValue).valid;

        // 如果是 JSON，格式化显示
        let displayValue;
        let jsonBadge = '';
        if (isJson) {
          try {
            const parsed = JSON.parse(rawValue);
            displayValue = this.formatJson(parsed);
            jsonBadge = '<span class="json-badge" style="font-size:9px;background:#e3f2fd;color:#1976d2;padding:1px 4px;border-radius:3px;margin-left:4px;">JSON</span>';
          } catch (e) {
            displayValue = this.escapeHtml(rawValue);
          }
        } else {
          displayValue = this.escapeHtml(rawValue);
        }

        return `
        <div class="form-field" data-site="${this.escapeHtml(site)}" data-index="${idx}">
          <div class="form-field-header">
            ${checkbox}
            <span class="form-field-label">${f.tagName ? `<${f.tagName}>` : ''} ${this.escapeHtml(f.name || '')} ${jsonBadge}</span>
            <div class="form-field-actions" ${this.selectionMode ? 'style="display:none"' : ''}>
              <button class="field-btn copy-btn" data-text="${this.escapeHtml(rawValue)}" title="复制">📋</button>
              <button class="field-btn edit-btn" data-site="${this.escapeHtml(site)}" data-index="${idx}" data-name="${this.escapeHtml(f.name || '')}" data-value="${this.escapeHtml(rawValue)}" title="编辑">✏️</button>
              <button class="field-btn delete-btn" data-site="${this.escapeHtml(site)}" data-index="${idx}" title="删除">🗑️</button>
            </div>
          </div>
          <div class="form-field-value ${isJson ? 'is-json' : ''}" data-site="${this.escapeHtml(site)}" data-index="${idx}">${displayValue}</div>
        </div>
      `}).join('');

      return `
        <div class="form-item">
          <div class="form-item-header">
            <span class="form-site">${this.escapeHtml(site)}</span>
            <span class="form-count">${picked.length} 个</span>
          </div>
          <div class="form-item-content">
            ${fieldPreviews}
            <div class="form-item-actions" ${this.selectionMode ? 'style="display:none"' : ''}>
              <button class="action-btn delete-form-btn" data-url="${this.escapeHtml(site)}">删除全部</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 更新元素总数
    document.getElementById('elementCount').textContent = totalElements;

    // 绑定表单列表事件
    this.bindFormListEvents();
  }

  // 绑定表单列表事件
  bindFormListEvents() {
    const formList = document.getElementById('formList');

    // 复选框事件（选择模式）
    formList.querySelectorAll('.field-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const site = checkbox.dataset.site;
        const index = parseInt(checkbox.dataset.index);
        this.toggleItemSelection(site, index);
      });
    });

    // 复制按钮
    formList.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = btn.dataset.text;
        await navigator.clipboard.writeText(text);
        this.showToast('已复制', 'success');
      });
    });

    // 编辑按钮 - 直接从 formData 获取原始值，避免 dataset 长度限制
    formList.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const site = btn.dataset.site;
        const index = parseInt(btn.dataset.index);
        const field = this.formData[site]?.pickedElements?.[index];
        if (field) {
          this.showEditDialog(site, index, field.name || '', field.text || field.value || '');
        }
      });
    });

    // 双击值编辑，单击复制
    formList.querySelectorAll('.form-field-value').forEach(el => {
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const site = el.dataset.site;
        const index = parseInt(el.dataset.index);
        const field = this.formData[site]?.pickedElements?.[index];
        if (field) {
          this.showEditDialog(site, index, field.name || '', field.text || field.value || '');
        }
      });

      el.addEventListener('click', async (e) => {
        const text = el.textContent;
        await navigator.clipboard.writeText(text);
        this.showToast('已复制', 'success');
      });
    });

    // 删除单个按钮
    formList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const site = btn.dataset.site;
        const index = parseInt(btn.dataset.index);
        this.deleteField(site, index);
      });
    });
  }

  // 删除单个字段
  async deleteField(site, index) {
    const data = this.formData[site];
    if (!data || !data.pickedElements) return;

    data.pickedElements.splice(index, 1);
    this.saveFormDataDirect(this.formData);
    this.showToast('已删除', 'success');
    // 立即保存
    await this.saveFormDataImmediate();
  }

  // 直接保存表单数据
  saveFormDataDirect(formData) {
    chrome.storage.local.set({ formData });
    this.formData = formData;
    this.renderFormList();
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

  // 显示导入对话框
  showImportDialog() {
    // 移除已存在的对话框
    const existing = document.getElementById('importDialog');
    if (existing) existing.remove();

    // 创建对话框
    const dialog = document.createElement('div');
    dialog.id = 'importDialog';
    dialog.className = 'edit-dialog-overlay';
    dialog.innerHTML = `
      <div class="edit-dialog">
        <div class="edit-dialog-header">
          <h3>📥 导入 JSON</h3>
          <button class="edit-dialog-close">&times;</button>
        </div>
        <div class="edit-dialog-body">
          <div class="edit-field">
            <label>粘贴 JSON 数据</label>
            <textarea id="importText" placeholder='{"site.com": {"pickedElements": [...]}}' style="min-height: 150px;"></textarea>
            <div id="importJsonPreview" class="json-preview" style="margin-top: 8px;"></div>
          </div>
          <div class="edit-field">
            <label>或选择文件</label>
            <input type="file" id="importFile" accept=".json" style="margin-top: 4px;">
          </div>
        </div>
        <div class="edit-dialog-footer">
          <button class="btn-cancel">取消</button>
          <button class="btn-save">导入</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // 绑定事件
    const closeDialog = () => dialog.remove();
    const importText = document.getElementById('importText');
    const importPreview = document.getElementById('importJsonPreview');
    const importFile = document.getElementById('importFile');

    // 实时预览 JSON
    importText?.addEventListener('input', () => {
      this.detectAndPreviewJson(importText.value, importPreview, null);
    });

    // 文件选择
    importFile?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        importText.value = text;
        this.detectAndPreviewJson(text, importPreview, null);
      } catch (err) {
        this.showToast('读取文件失败', 'error');
      }
    });

    dialog.querySelector('.edit-dialog-close').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-save').addEventListener('click', async () => {
      const text = importText.value.trim();
      if (!text) {
        this.showToast('请输入或选择要导入的数据', 'error');
        return;
      }

      // 验证 JSON
      const validation = this.validateJson(text);
      if (!validation.valid) {
        this.showToast('无效的 JSON 格式: ' + validation.error, 'error');
        return;
      }

      try {
        // 尝试解析为导出格式
        let importedData;
        try {
          const parsed = JSON.parse(text);
          // 检查是否是导出的格式
          if (parsed.formData) {
            importedData = parsed.formData;
          } else {
            // 可能是原始数据
            importedData = parsed;
          }
        } catch (e) {
          this.showToast('JSON 解析失败', 'error');
          return;
        }

        // 合并数据
        let count = 0;
        for (const site in importedData) {
          if (!this.formData[site]) {
            this.formData[site] = importedData[site];
            count++;
          } else if (importedData[site].pickedElements) {
            // 合并元素
            const existing = this.formData[site].pickedElements || [];
            const newElements = importedData[site].pickedElements || [];
            this.formData[site].pickedElements = [...existing, ...newElements];
            count++;
          }
        }

        await this.saveFormDataImmediate();
        closeDialog();
        this.showToast(`成功导入 ${count} 个站点的数据`, 'success');
      } catch (err) {
        this.showToast('导入失败: ' + err.message, 'error');
      }
    });

    // 点击遮罩关闭
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });

    // 聚焦输入框
    importText.focus();
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
  window.sidebarController = new SidebarController();
});

// 键盘快捷键
document.addEventListener('keydown', (e) => {
  const controller = window.sidebarController;
  if (!controller) return;

  // Escape - 取消选择或关闭对话框
  if (e.key === 'Escape') {
    const editDialog = document.getElementById('editDialog');
    if (editDialog) {
      editDialog.remove();
      return;
    }

    if (controller.selectionMode) {
      controller.cancelSelection();
      return;
    }
  }

  // Ctrl/Cmd + F - 聚焦搜索框
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    document.getElementById('searchInput')?.focus();
  }
});
