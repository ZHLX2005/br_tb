/**
 * 录制页面逻辑
 * 独立管理标签录制功能
 */

class RecordingPage {
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
  }

  /**
   * 初始化
   */
  async init() {
    await this.loadRecordingState();
    await this.loadRecordings();
    this.render();
    this.bindEvents();
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

    const name = prompt('请输入录制名称:', defaultName);
    if (name === null) return;

    const recordingName = (name || defaultName).trim();

    const response = await chrome.runtime.sendMessage({
      action: 'startRecording',
      groupName: recordingName
    });

    if (response.success) {
      this.recordingState = response.recordingState;
      await this.loadRecordings(); // 重新加载列表
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
    if (!confirm('确定要停止录制吗？')) return;

    const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });

    if (response.success) {
      this.recordingState = response.recordingState;
      await this.loadRecordings(); // 重新加载列表
      this.render();
      this.showToast(`录制已停止，共记录 ${response.tabCount} 个标签页`, 'info');
    }
  }

  /**
   * 删除录制
   */
  async deleteRecording(recordingId) {
    if (!confirm('确定要删除这个录制吗？')) return;

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
   * 返回看板
   */
  backToTabboard() {
    window.location.href = chrome.runtime.getURL('modules/tabboard/tabboard.html');
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    document.getElementById('backBtn').addEventListener('click', () => this.backToTabboard());
  }

  /**
   * 渲染页面
   */
  render() {
    this.renderRecordingStatus();
    this.renderRecordingsList();
  }

  /**
   * 渲染录制状态区
   */
  renderRecordingStatus() {
    const statusSection = document.getElementById('recordingStatus');

    if (this.recordingState.isRecording) {
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
              <span class="info-value">${this.recordingState.tabCount} 个标签页</span>
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
          <div class="idle-icon">🎯</div>
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
          <div class="empty-icon">📁</div>
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

      return `
        <div class="recording-item" data-id="${recording.id}">
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
            <button class="btn btn-secondary open-btn" data-id="${recording.id}">打开</button>
            <button class="btn btn-danger delete-btn" data-id="${recording.id}">删除</button>
          </div>
        </div>
      `;
    }).join('');

    // 绑定事件
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

    listContainer.querySelectorAll('.recording-item').forEach(item => {
      item.addEventListener('click', () => {
        this.openRecording(item.dataset.id);
      });
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
  }
}

// 创建并初始化页面
const recordingPage = new RecordingPage();

document.addEventListener('DOMContentLoaded', () => {
  recordingPage.init();
});
