/**
 * Popup Solution Module
 * 自动录制功能的 Popup 界面逻辑
 * 与 popup.js 隔离，独立管理解决方案录制相关 UI
 */

class PopupSolution {
  constructor() {
    this.container = document.getElementById('solutionContainer');
    this.recordingState = {
      isRecording: false,
      recordingId: null,
      recordingName: '',
      startTime: null,
      tabCount: 0
    };
    this.elapsedTimer = null;
  }

  /**
   * 初始化
   */
  async init() {
    await this.loadRecordingState();
    this.render();
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
   * 启动录制
   */
  async startRecording() {
    // 询问用户分组名称
    const defaultName = `录制 ${new Date().toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`;

    const groupName = await window.modal.prompt('请输入录制分组名称:', {
      title: '开始录制',
      defaultValue: defaultName,
      placeholder: '录制名称',
      confirmText: '开始录制'
    });
    if (!groupName) return; // 用户取消

    const name = groupName.trim();

    const response = await chrome.runtime.sendMessage({
      action: 'startRecording',
      groupName: name
    });

    if (response.success) {
      this.recordingState = response.recordingState;
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
    const confirmed = await window.modal.confirm('确定要停止录制吗？', {
      title: '停止录制',
      type: 'warning',
      confirmText: '停止',
      cancelText: '取消'
    });
    if (!confirmed) return;

    const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });

    if (response.success) {
      this.recordingState = response.recordingState;
      this.render();
      this.showToast(`录制已停止，共记录 ${response.tabCount} 个标签页`, 'info');
    }
  }

  /**
   * 打开录制页面
   */
  async openGroup() {
    await chrome.runtime.sendMessage({ action: 'openRecordingPage' });
    window.close();
  }

  /**
   * 渲染UI
   */
  render() {
    if (!this.container) return;

    const { isRecording, recordingName, startTime, tabCount } = this.recordingState;

    if (isRecording) {
      // 录制中状态
      const elapsed = this.formatElapsedTime(startTime);
      this.container.innerHTML = `
        <div class="solution-recording">
          <div class="recording-header">
            <div class="recording-indicator">
              <span class="recording-dot"></span>
              <span class="recording-text">录制中...</span>
            </div>
            <div class="recording-time" data-start-time="${startTime}">${elapsed}</div>
          </div>
          <div class="recording-info">
            <div class="recording-group">
              <span class="label">录制名称:</span>
              <span class="group-name">${this.escapeHtml(recordingName || '未命名')}</span>
            </div>
            <div class="recording-count">
              <span class="label">已记录:</span>
              <span class="count">${tabCount}</span> 个标签页
            </div>
          </div>
          <div class="recording-actions">
            <button id="stopRecordingBtn" class="btn btn-stop">停止录制</button>
            <button id="openGroupBtn" class="btn btn-secondary">查看录制</button>
          </div>
        </div>
      `;
      this.setupRecordingListeners();
      this.startElapsedTimer();
    } else {
      // 未录制状态
      this.container.innerHTML = `
        <div class="solution-idle">
          <div class="idle-header">
            <div class="idle-icon">🎯</div>
            <div class="idle-title">自动录制标签页</div>
            <div class="idle-desc">启动录制后，所有打开的标签页将自动保存到录制列表</div>
          </div>
          <div class="idle-actions">
            <button id="startRecordingBtn" class="btn btn-primary">开始录制</button>
          </div>
        </div>
      `;
      this.setupIdleListeners();
    }
  }

  /**
   * 设置录制状态事件监听
   */
  setupRecordingListeners() {
    const stopBtn = document.getElementById('stopRecordingBtn');
    const openBtn = document.getElementById('openGroupBtn');

    if (stopBtn) {
      stopBtn.addEventListener('click', () => this.stopRecording());
    }

    if (openBtn) {
      openBtn.addEventListener('click', () => this.openGroup());
    }
  }

  /**
   * 设置空闲状态事件监听
   */
  setupIdleListeners() {
    const startBtn = document.getElementById('startRecordingBtn');
    if (startBtn) {
      startBtn.addEventListener('click', () => this.startRecording());
    }
  }

  /**
   * 启动计时器
   */
  startElapsedTimer() {
    // 清除之前的定时器
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
    }

    this.elapsedTimer = setInterval(() => {
      const timeElement = document.querySelector('.recording-time');
      if (timeElement && this.recordingState.startTime) {
        timeElement.textContent = this.formatElapsedTime(this.recordingState.startTime);
      } else {
        clearInterval(this.elapsedTimer);
      }
    }, 1000);
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
   * HTML转义
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
    toast.className = `popup-toast popup-toast-${type}`;
    toast.textContent = message;

    const bgColor = type === 'success' ? '#66bb6a' :
                    type === 'error' ? '#ef5350' : '#42a5f5';

    toast.style.cssText = `
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      width: auto;
      max-width: calc(100% - 40px);
      padding: 10px 16px;
      background: ${bgColor};
      color: white;
      border-radius: 6px;
      font-size: 13px;
      z-index: 10000;
      animation: slideDown 0.3s ease;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      text-align: center;
      white-space: nowrap;
    `;

    document.querySelector('.container').appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideUp 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  /**
   * 销毁
   */
  destroy() {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
    }
  }
}

// 创建并初始化 PopupSolution
const popupSolution = new PopupSolution();

// 在 DOMContentLoaded 后初始化
document.addEventListener('DOMContentLoaded', () => {
  popupSolution.init();
});
