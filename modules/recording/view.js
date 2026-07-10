/**
 * 录制页面逻辑
 * 独立管理标签录制功能
 * 使用 chrome.storage 监听实现状态同步
 */

import { modal } from '../../shared/ModalDialog.js';

class RecordingView {
  constructor() {
    this.recordingState = {
      isRecording: false,
      recordingId: null,
      recordingName: '',
      startTime: null,
      tabCount: 0
    };
    this.recordings = [];
    this.elapsedTimer = null;
    this.storageChangeTimer = null;
    this.isInitialized = false;
  }

  /**
   * 初始化 - 先设置监听器再加载数据，避免遗漏变化
   */
  async init() {
    // 先设置存储监听器，确保不会错过任何变化
    this.setupStorageListener();

    // 然后加载数据
    await this.loadRecordingState();
    await this.loadRecordings();

    // 绑定事件
    this.bindEvents();

    // 最后渲染
    this.render();

    // 标记为已初始化
    this.isInitialized = true;
  }

  /**
   * 设置存储变化监听器（实现状态同步）
   */
  setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;

      // 清除之前的定时器
      if (this.storageChangeTimer) {
        clearTimeout(this.storageChangeTimer);
      }

      // 防抖延迟 100ms
      this.storageChangeTimer = setTimeout(async () => {
        let needsRender = false;

        // 检查录制状态变化 - 使用 'in' 检查避免数据丢失
        if (changes.recordingState) {
          const { oldValue: oldState, newValue: newState } = changes.recordingState;
          // 检查是否真正发生了变化（不仅仅是引用变化）
          const stateChanged = !this.isInitialized ||
            JSON.stringify(oldState) !== JSON.stringify(newState);

          if (stateChanged && newState) {
            this.recordingState = newState;
            needsRender = true;
            console.log('[RecordingPage] recordingState changed:', newState);
          }
        }

        // 检查录制列表变化 - 使用 'in' 检查避免数据丢失
        if (changes.recordings) {
          const { oldValue: oldRecs, newValue: newRecs } = changes.recordings;
          // 确保使用新值（即使是空数组）
          const newRecordings = Array.isArray(newRecs) ? newRecs : [];

          // 检查是否真正发生了变化
          const recordingsChanged = !this.isInitialized ||
            JSON.stringify(oldRecs) !== JSON.stringify(newRecs);

          if (recordingsChanged) {
            this.recordings = newRecordings;
            needsRender = true;
            console.log('[RecordingPage] recordings changed:', newRecordings.length, 'items');
          }
        }

        if (needsRender) {
          this.render();
        }
      }, 100);
    });
  }

  /**
   * 加载录制状态
   */
  async loadRecordingState() {
    const response = await chrome.runtime.sendMessage({ action: 'getRecordingState' });
    if (response.success) {
      this.recordingState = response.recordingState || {
        isRecording: false,
        recordingId: null,
        recordingName: '',
        startTime: null,
        tabCount: 0
      };
    }
  }

  /**
   * 加载录制列表
   */
  async loadRecordings() {
    const response = await chrome.runtime.sendMessage({ action: 'getRecordings' });
    if (response.success) {
      this.recordings = response.recordings || [];
    }
  }

  /**
   * 启动录制
   */
  async startRecording() {
    const defaultName = `录制 ${new Date().toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`;

    const name = await modal.prompt('请输入录制名称:', {
      title: '开始录制',
      defaultValue: defaultName,
      placeholder: '录制名称',
      confirmText: '开始录制'
    });
    if (!name) return;

    const recordingName = name.trim();

    const response = await chrome.runtime.sendMessage({
      action: 'startRecording',
      groupName: recordingName
    });

    if (response.success) {
      this.recordingState = response.recordingState;
      await this.loadRecordings();
      this.render();
      this.showToast('开始录制标签页', 'success');
    } else {
      this.showToast('启动录制失败', 'error');
    }
  }

  /**
   * 停止录制
   */
  async stopRecording() {
    const confirmed = await modal.confirm('确定要停止录制吗？', {
      title: '停止录制',
      type: 'warning',
      confirmText: '停止',
      cancelText: '取消'
    });
    if (!confirmed) return;

    const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });

    if (response.success) {
      this.recordingState = response.recordingState;
      await this.loadRecordings();
      this.render();
      this.showToast(`录制已停止，共记录 ${response.tabCount} 个标签页`, 'info');
    }
  }

  /**
   * 重命名录制
   */
  async renameRecording(recordingId, currentName) {
    const newName = await modal.prompt('请输入新的录制名称:', {
      title: '重命名录制',
      defaultValue: currentName,
      placeholder: '新名称',
      confirmText: '保存',
      cancelText: '取消'
    });
    if (!newName || newName.trim() === '' || newName === currentName) return;

    const response = await chrome.runtime.sendMessage({
      action: 'renameRecording',
      recordingId,
      newName: newName.trim()
    });

    if (response.success) {
      await this.loadRecordings();
      this.render();
      this.showToast('录制名称已更新', 'success');
    } else {
      this.showToast('重命名失败', 'error');
    }
  }

  /**
   * 删除录制
   */
  async deleteRecording(recordingId) {
    const confirmed = await modal.confirm('确定要删除这个录制吗？删除后无法恢复。', {
      title: '删除录制',
      type: 'danger',
      confirmText: '删除',
      cancelText: '取消'
    });
    if (!confirmed) return;

    const response = await chrome.runtime.sendMessage({
      action: 'deleteRecording',
      recordingId
    });

    if (response.success) {
      await this.loadRecordings();
      this.render();
      this.showToast('录制已删除', 'info');
    }
  }

  /**
   * 打开录制
   */
  async openRecording(recordingId) {
    const response = await chrome.runtime.sendMessage({
      action: 'openRecording',
      recordingId
    });

    if (response.success) {
      this.showToast('正在打开标签页...', 'success');
    }
  }

  /**
   * 打开单个标签
   */
  async openTab(url) {
    await chrome.runtime.sendMessage({
      action: 'openTab',
      url
    });
  }

  /**
   * 绑定事件
   * 注:作为 TabBoard 内嵌视图运行后,"返回看板"按钮取消,统一使用顶部 nav。
   * 录制状态的开始/停止按钮采用一次性绑定,见 render() 内部。
   */
  bindEvents() {
    // 已通过 render() 内 addEventListener 完成事件绑定
  }

  /**
   * 渲染页面
   */
  render() {
    // 更新顶部统计条,避免残留其他视图信息
    const stats = document.getElementById('stats');
    if (stats) {
      const totalTabs = this.recordings.reduce((sum, r) => sum + (r.tabs?.length || 0), 0);
      stats.textContent = `${this.recordings.length} 个录制 · ${totalTabs} 个标签页`;
    }

    // 列表容器由 tabboard.html 的 #recordingView 提供,若无说明该视图未在当前页面
    if (!document.getElementById('recordingStatus')) return;

    this.renderRecordingStatus();
    this.renderRecordingsList();
  }

  /**
   * 渲染录制状态区
   */
  renderRecordingStatus() {
    const statusSection = document.getElementById('recordingStatus');

    // 验证录制状态的完整性
    const isValidRecording = this.recordingState &&
      this.recordingState.isRecording === true &&
      this.recordingState.recordingId &&
      this.recordingState.startTime;

    if (isValidRecording) {
      // 录制中
      const elapsed = this.formatElapsedTime(this.recordingState.startTime);
      statusSection.innerHTML = `
        <div class="recording-state">
          <div class="recording-header">
            <div class="recording-indicator">
              <span class="recording-dot"></span>
              <span class="recording-text">录制中...</span>
            </div>
            <div class="recording-time" id="recordingTime">${elapsed}</div>
          </div>
          <div class="recording-info">
            <div class="info-item">
              <span class="info-label">录制名称:</span>
              <span class="info-value">${this.escapeHtml(this.recordingState.recordingName || '未命名')}</span>
            </div>
            <div class="info-item">
              <span class="info-label">已记录:</span>
              <span class="info-value">${this.recordingState.tabCount || 0} 个标签页</span>
            </div>
          </div>
          <div class="recording-actions">
            <button id="stopRecordingBtn" class="btn btn-stop">停止录制</button>
          </div>
        </div>
      `;
      document.getElementById('stopRecordingBtn').addEventListener('click', () => this.stopRecording());
      this.startElapsedTimer();
    } else {
      // 未录制
      statusSection.innerHTML = `
        <div class="idle-state">
          <div class="idle-icon"></div>
          <div class="idle-title">自动录制标签页</div>
          <div class="idle-desc">启动录制后，所有打开的标签页将自动保存到录制列表</div>
          <button id="startRecordingBtn" class="btn btn-primary">开始录制</button>
        </div>
      `;
      document.getElementById('startRecordingBtn').addEventListener('click', () => this.startRecording());
      this.stopElapsedTimer();
    }
  }

  /**
   * 渲染录制列表
   */
  renderRecordingsList() {
    const listContainer = document.getElementById('recordingsList');
    const countBadge = document.getElementById('recordingCount');

    countBadge.textContent = this.recordings.length;

    if (this.recordings.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"></div>
          <div class="empty-text">暂无录制记录</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = this.recordings.map(recording => {
      const startDate = new Date(recording.startTime);
      const endDate = recording.endTime ? new Date(recording.endTime) : null;
      const tabCount = recording.tabs?.length || 0;

      const dateStr = startDate.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const durationStr = endDate
        ? `${Math.round((endDate - startDate) / 60000)} 分钟`
        : '进行中';

      // 显示前3个标签
      const displayTabs = recording.tabs?.slice(0, 3) || [];
      const hasMore = tabCount > 3;

      return `
        <div class="recording-item" data-id="${recording.id}">
          <div class="recording-header">
            <div class="recording-main">
              <div class="recording-name">${this.escapeHtml(recording.name)}</div>
              <div class="recording-meta">
                <span>${dateStr}</span>
                <span class="recording-count">
                  <span class="count-number">${tabCount}</span> 个标签页
                </span>
                <span>${durationStr}</span>
              </div>
            </div>
            <div class="recording-actions">
              <button class="btn edit-btn" data-id="${recording.id}" data-name="${this._escapeHtmlAttribute(recording.name)}">重命名</button>
              <button class="btn open-btn" data-id="${recording.id}">打开</button>
              <button class="btn btn-danger delete-btn" data-id="${recording.id}">删除</button>
            </div>
          </div>
          <div class="recording-tabs">
            ${displayTabs.map(tab => this._renderTabRow(tab)).join('')}
            ${hasMore ? `
              <button class="recording-more-btn" data-recording-id="${recording.id}">
                还有 ${tabCount - 3} 个标签... ▼
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    // 绑定事件
    listContainer.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renameRecording(btn.dataset.id, btn.dataset.name);
      });
    });

    listContainer.querySelectorAll('.open-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openRecording(btn.dataset.id);
      });
    });

    listContainer.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteRecording(btn.dataset.id);
      });
    });

    // 点击标签行打开标签
    listContainer.querySelectorAll('.recording-tab-row').forEach(row => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openTab(row.dataset.url);
      });
    });

    // "更多"按钮 - 展开显示所有标签
    listContainer.querySelectorAll('.recording-more-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._expandRecording(btn);
      });
    });
  }

  /**
   * 渲染单个标签行
   */
  _renderTabRow(tab) {
    return `
      <div class="recording-tab-row" data-url="${this._escapeHtmlAttribute(tab.url)}">
        <img class="recording-tab-favicon" src="${this._escapeHtmlAttribute(tab.favicon || '')}" loading="lazy">
        <span class="recording-tab-title">${this.escapeHtml(tab.title)}</span>
      </div>
    `;
  }

  /**
   * 转义 HTML 属性值
   */
  _escapeHtmlAttribute(str) {
    return str
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * 展开显示录制的所有标签
   */
  _expandRecording(btn) {
    const recordingId = btn.dataset.recordingId;
    const recording = this.recordings.find(r => r.id === recordingId);
    if (!recording) return;

    const tabsContainer = btn.parentElement;
    btn.remove();

    const remainingTabs = recording.tabs?.slice(3) || [];
    remainingTabs.forEach(tab => {
      const tabRow = document.createElement('div');
      tabRow.className = 'recording-tab-row';
      tabRow.dataset.url = tab.url;
      tabRow.innerHTML = `
        <img class="recording-tab-favicon" src="${this._escapeHtmlAttribute(tab.favicon || '')}" loading="lazy">
        <span class="recording-tab-title">${this.escapeHtml(tab.title)}</span>
      `;

      tabRow.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openTab(tab.url);
      });

      tabsContainer.appendChild(tabRow);
    });
  }

  /**
   * 启动计时器
   */
  startElapsedTimer() {
    this.stopElapsedTimer();

    this.elapsedTimer = setInterval(() => {
      const timeElement = document.getElementById('recordingTime');
      if (timeElement && this.recordingState.startTime) {
        timeElement.textContent = this.formatElapsedTime(this.recordingState.startTime);
      }
    }, 1000);
  }

  /**
   * 停止计时器
   */
  stopElapsedTimer() {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  /**
   * 格式化经过的时间
   */
  formatElapsedTime(startTime) {
    if (!startTime) return '00:00';
    const elapsed = Date.now() - new Date(startTime).getTime();
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * HTML 转义
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 显示提示消息
   */
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  /**
   * 销毁
   */
  destroy() {
    this.stopElapsedTimer();
    if (this.storageChangeTimer) {
      clearTimeout(this.storageChangeTimer);
    }
  }
}

export default RecordingView;
