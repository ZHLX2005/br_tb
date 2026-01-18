/**
 * SolutionView - 解决方案录制视图模块
 * 负责自动录制标签页到分组的功能
 */

import { escapeHtml } from './Utils.js';

class SolutionView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.recordingState = {
      isRecording: false,
      groupId: null,
      groupName: '',
      startTime: null,
      tabCount: 0
    };
  }

  /**
   * 更新录制状态数据
   */
  updateData(data) {
    this.recordingState = data.recordingState || {
      isRecording: false,
      groupId: null,
      groupName: '',
      startTime: null,
      tabCount: 0
    };
  }

  /**
   * 启动录制
   */
  async startRecording(groupName = '') {
    const result = await this.dataManager.sendMessage('startRecording', { groupName });
    if (result.success) {
      this.recordingState = result.recordingState;
      this._showToast('开始录制标签页', 'success');
      this.render();
      return true;
    }
    return false;
  }

  /**
   * 停止录制
   */
  async stopRecording() {
    const result = await this.dataManager.sendMessage('stopRecording');
    if (result.success) {
      this.recordingState = result.recordingState;
      this._showToast('录制已停止', 'info');
      this.render();
      return true;
    }
    return false;
  }

  /**
   * 渲染解决方案视图
   */
  render() {
    const solutionSection = document.getElementById('solutionSection');
    if (!solutionSection) return;

    const { isRecording, groupName, startTime, tabCount } = this.recordingState;

    if (isRecording) {
      // 录制中状态
      const elapsed = this._formatElapsedTime(startTime);
      solutionSection.innerHTML = `
        <div class="solution-recording">
          <div class="recording-header">
            <div class="recording-indicator">
              <span class="recording-dot"></span>
              <span class="recording-text">录制中...</span>
            </div>
            <div class="recording-time">${elapsed}</div>
          </div>
          <div class="recording-info">
            <div class="recording-group">
              <span class="label">目标分组:</span>
              <span class="group-name">${escapeHtml(groupName || '未命名')}</span>
            </div>
            <div class="recording-count">
              <span class="label">已记录:</span>
              <span class="count">${tabCount}</span> 个标签页
            </div>
          </div>
          <div class="recording-actions">
            <button id="stopRecordingBtn" class="btn btn-stop">停止录制</button>
            <button id="openGroupBtn" class="btn btn-secondary">查看分组</button>
          </div>
        </div>
      `;
      this._setupRecordingListeners();
    } else {
      // 未录制状态
      solutionSection.innerHTML = `
        <div class="solution-idle">
          <div class="idle-header">
            <div class="idle-icon">🎯</div>
            <div class="idle-title">自动录制标签页</div>
            <div class="idle-desc">启动录制后，所有打开的标签页将自动保存到新分组</div>
          </div>
          <div class="idle-actions">
            <button id="startRecordingBtn" class="btn btn-primary">开始录制</button>
          </div>
        </div>
      `;
      this._setupIdleListeners();
    }
  }

  /**
   * 设置录制状态的事件监听器
   */
  _setupRecordingListeners() {
    const stopBtn = document.getElementById('stopRecordingBtn');
    const openBtn = document.getElementById('openGroupBtn');

    if (stopBtn) {
      stopBtn.addEventListener('click', () => this.stopRecording());
    }

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        if (this.recordingState.groupId) {
          // 跳转到分组视图并高亮对应分组
          this.dataManager.sendMessage('switchToGroupView');
        }
      });
    }

    // 启动定时器更新时间显示
    this._startElapsedTimer();
  }

  /**
   * 设置空闲状态的事件监听器
   */
  _setupIdleListeners() {
    const startBtn = document.getElementById('startRecordingBtn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.startRecording();
      });
    }
  }

  /**
   * 启动计时器更新显示
   */
  _startElapsedTimer() {
    // 清除之前的定时器
    if (this._elapsedTimer) {
      clearInterval(this._elapsedTimer);
    }

    this._elapsedTimer = setInterval(() => {
      const timeElement = document.querySelector('.recording-time');
      if (timeElement && this.recordingState.startTime) {
        timeElement.textContent = this._formatElapsedTime(this.recordingState.startTime);
      } else {
        clearInterval(this._elapsedTimer);
      }
    }, 1000);
  }

  /**
   * 格式化经过的时间
   */
  _formatElapsedTime(startTime) {
    if (!startTime) return '00:00';
    const elapsed = Date.now() - new Date(startTime).getTime();
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * 显示提示消息
   */
  _showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    let bgColor = '#42a5f5';
    if (type === 'success') bgColor = '#66bb6a';
    if (type === 'error') bgColor = '#ef5350';

    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${bgColor};
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  /**
   * 清理资源
   */
  destroy() {
    if (this._elapsedTimer) {
      clearInterval(this._elapsedTimer);
    }
  }
}

export default SolutionView;
