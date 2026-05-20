/**
 * VideoProgressView - 视频进度聚合视图
 * 显示课程组、视频列表和观看进度
 */

import { modal } from '../../shared/ModalDialog.js';

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('bilibili.com') && u.pathname.startsWith('/video/')) {
      let path = u.pathname;
      if (path.endsWith('/')) path = path.slice(0, -1);
      return `${u.protocol}//${u.hostname}${path}`;
    }
    return url;
  } catch {
    return url;
  }
}

class VideoProgressView {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.videoGroups = [];
    this.storageChangeTimer = null;
    this.isInitialized = false;
  }

  async init() {
    this.setupStorageListener();
    await this.loadVideoGroups();
    this.isInitialized = true;
  }

  setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;
      if (this.storageChangeTimer) clearTimeout(this.storageChangeTimer);
      this.storageChangeTimer = setTimeout(async () => {
        if (changes.videoGroups) {
          await this.loadVideoGroups();
          this.render();
        }
      }, 100);
    });
  }

  async loadVideoGroups() {
    const response = await chrome.runtime.sendMessage({ action: 'getVideoGroups' });
    if (response.success) {
      this.videoGroups = response.videoGroups || [];
    }
  }

  bindEvents() {
    document.getElementById('backBtn')?.addEventListener('click', () => this.backToTabboard());
    document.getElementById('addGroupBtn')?.addEventListener('click', () => this.createGroup());
    document.getElementById('addCurrentVideoBtn')?.addEventListener('click', () => this.addCurrentVideo());

    // Event delegation for dynamically created elements
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const groupId = btn.dataset.groupId;
      const videoId = btn.dataset.videoId;

      switch (action) {
        case 'toggle-group':
          this.toggleGroup(groupId);
          break;
        case 'rename-group':
          this.renameGroup(groupId);
          break;
        case 'delete-group':
          this.deleteGroup(groupId);
          break;
        case 'open-group':
          this.openGroup(groupId);
          break;
        case 'open-video':
          this.openVideo(btn.dataset.url);
          break;
        case 'remove-video':
          this.removeVideo(groupId, videoId);
          break;
        case 'add-to-group':
          this.addDetectedVideoToGroup(groupId);
          break;
      }
    });
  }

  backToTabboard() {
    window.location.href = chrome.runtime.getURL('modules/tabboard/tabboard.html');
  }

  async createGroup() {
    const name = await modal.prompt('请输入课程名称:', {
      title: '新建课程',
      defaultValue: `课程 ${this.videoGroups.length + 1}`,
      placeholder: '课程名称',
      confirmText: '创建'
    });
    if (!name || !name.trim()) return;

    const response = await chrome.runtime.sendMessage({
      action: 'addVideoGroup',
      name: name.trim()
    });

    if (response.success) {
      await this.loadVideoGroups();
      this.render();
      this.showToast('课程创建成功', 'success');
    }
  }

  async renameGroup(groupId) {
    const group = this.videoGroups.find(g => g.id === groupId);
    if (!group) return;

    const newName = await modal.prompt('请输入新的课程名称:', {
      title: '重命名课程',
      defaultValue: group.name,
      placeholder: '课程名称',
      confirmText: '保存'
    });
    if (!newName || !newName.trim() || newName === group.name) return;

    const response = await chrome.runtime.sendMessage({
      action: 'renameVideoGroup',
      groupId,
      newName: newName.trim()
    });

    if (response.success) {
      await this.loadVideoGroups();
      this.render();
      this.showToast('课程名称已更新', 'success');
    }
  }

  async deleteGroup(groupId) {
    const confirmed = await modal.confirm('确定要删除这个课程吗？所有视频记录也将被删除。', {
      title: '删除课程',
      type: 'danger',
      confirmText: '删除',
      cancelText: '取消'
    });
    if (!confirmed) return;

    const response = await chrome.runtime.sendMessage({
      action: 'deleteVideoGroup',
      groupId
    });

    if (response.success) {
      await this.loadVideoGroups();
      this.render();
      this.showToast('课程已删除', 'info');
    }
  }

  async openGroup(groupId) {
    const response = await chrome.runtime.sendMessage({
      action: 'openVideoGroup',
      groupId
    });

    if (response.success) {
      this.showToast('正在打开视频页面...', 'success');
    }
  }

  async openVideo(url) {
    if (!url) return;
    await chrome.tabs.create({ url });
  }

  async removeVideo(groupId, videoId) {
    const confirmed = await modal.confirm('确定要移除这个视频吗？', {
      title: '移除视频',
      type: 'warning',
      confirmText: '移除',
      cancelText: '取消'
    });
    if (!confirmed) return;

    const response = await chrome.runtime.sendMessage({
      action: 'removeVideoFromGroup',
      groupId,
      videoId
    });

    if (response.success) {
      await this.loadVideoGroups();
      this.render();
      this.showToast('视频已移除', 'info');
    }
  }

  /**
   * Detect videos in current active tab and show add dialog
   */
  async addCurrentVideo() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab) {
        this.showToast('无法获取当前标签页', 'error');
        return;
      }

      // Skip special pages
      if (!activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://') || activeTab.url.startsWith('edge://')) {
        this.showToast('当前页面不支持视频检测', 'error');
        return;
      }

      // Send message to content script to detect videos
      const results = await chrome.tabs.sendMessage(activeTab.id, { action: 'detectVideos' });

      if (!results || !results.videos || results.videos.length === 0) {
        this.showToast('当前页面未检测到视频', 'warning');
        return;
      }

      if (results.videos.length === 1) {
        // Only one video, directly add it
        await this.showAddVideoDialog(results.videos[0]);
      } else {
        // Multiple videos, let user choose
        await this.showVideoSelectionDialog(results.videos);
      }
    } catch (error) {
      this.showToast('视频检测失败: ' + error.message, 'error');
    }
  }

  async showVideoSelectionDialog(videos) {
    const options = videos.map((v, i) => ({
      value: String(i),
      label: `${v.title || '未命名'} (${this.formatDuration(v.duration)})`
    }));
    const selected = await modal.select(`检测到 ${videos.length} 个视频`, {
      title: '选择视频',
      options,
      confirmText: '选择',
      cancelText: '取消'
    });

    if (selected === null) return;
    const index = parseInt(selected);
    if (isNaN(index) || index < 0 || index >= videos.length) {
      this.showToast('无效的选择', 'error');
      return;
    }

    await this.showAddVideoDialog(videos[index]);
  }

  async showAddVideoDialog(video) {
    if (this.videoGroups.length === 0) {
      const createGroup = await modal.confirm('还没有课程组，是否先创建一个？', {
        title: '创建课程',
        confirmText: '创建',
        cancelText: '取消'
      });
      if (createGroup) {
        await this.createGroup();
      }
      return;
    }

    // Show group selection
    const groupOptions = this.videoGroups.map((g, i) => ({
      value: String(i),
      label: `${g.name} (${g.videos.length} 个视频)`
    }));
    const selected = await modal.select(`选择要添加到的课程`, {
      title: `添加视频: ${video.title || '未命名'}`,
      options: groupOptions,
      confirmText: '添加',
      cancelText: '取消'
    });

    if (selected === null) return;
    const index = parseInt(selected);
    if (isNaN(index) || index < 0 || index >= this.videoGroups.length) {
      this.showToast('无效的选择', 'error');
      return;
    }

    const group = this.videoGroups[index];
    const response = await chrome.runtime.sendMessage({
      action: 'addVideoToGroup',
      groupId: group.id,
      video: {
        title: video.title || video.pageTitle || '未命名视频',
        url: normalizeUrl(video.url),
        duration: video.duration || 0,
        watched: video.watched || 0,
        favicon: video.favicon || '',
        pageTitle: video.pageTitle || ''
      }
    });

    if (response.success) {
      await this.loadVideoGroups();
      this.render();
      this.showToast(`已添加到 "${group.name}"`, 'success');
    } else if (response.error === 'Video already in group') {
      this.showToast('该视频已在课程中', 'warning');
    } else {
      this.showToast('添加失败: ' + (response.error || ''), 'error');
    }
  }

  async addDetectedVideoToGroup(groupId) {
    const url = await modal.prompt('请输入视频页面 URL:', {
      title: '添加视频',
      defaultValue: '',
      placeholder: 'https://...',
      confirmText: '添加',
      cancelText: '取消'
    });
    if (!url || !url.trim()) return;

    let videoUrl = url.trim();
    if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      videoUrl = 'https://' + videoUrl;
    }

    this.showToast('正在打开页面检测视频...', 'info');

    let tab;
    try {
      tab = await chrome.tabs.create({ url: videoUrl, active: true });
    } catch (err) {
      this.showToast('打开页面失败: ' + err.message, 'error');
      return;
    }

    // Poll every 2s, max 10s (5 attempts)
    let results = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await this._sleep(2000);
      try {
        results = await chrome.tabs.sendMessage(tab.id, { action: 'detectVideos' });
        if (results && results.videos && results.videos.length > 0) {
          break; // detected, stop polling
        }
      } catch (err) {
        // content script not ready yet, continue polling
      }
    }

    // Switch back to video-progress page first, then close the tab
    try {
      const selfUrl = chrome.runtime.getURL('modules/video-progress/video-progress.html');
      const allTabs = await chrome.tabs.query({});
      const selfTab = allTabs.find(t => t.url === selfUrl);
      if (selfTab) {
        await chrome.tabs.update(selfTab.id, { active: true });
      }
    } catch (_) {}

    // Close the tab regardless of detection result
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      // Tab may already be closed
    }

    if (!results || !results.videos || results.videos.length === 0) {
      this.showToast('页面未检测到视频', 'warning');
      return;
    }

    const video = results.videos[0];
    const response = await chrome.runtime.sendMessage({
      action: 'addVideoToGroup',
      groupId,
      video: {
        title: video.title || video.pageTitle || '未命名视频',
        url: normalizeUrl(video.url),
        duration: video.duration || 0,
        watched: video.watched || 0,
        favicon: video.favicon || '',
        pageTitle: video.pageTitle || ''
      }
    });

    if (response.success) {
      await this.loadVideoGroups();
      this.render();
      this.showToast(`视频已添加: ${video.title || '未命名'} (${this.formatDuration(video.duration)})`, 'success');
    } else if (response.error === 'Video already in group') {
      this.showToast('该视频已在课程中', 'warning');
    } else {
      this.showToast('添加失败: ' + (response.error || ''), 'error');
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  render() {
    this.renderStats();
    this.renderGroupsList();
  }

  renderStats() {
    const statsEl = document.getElementById('videoStats');
    if (!statsEl) return;

    let totalVideos = 0;
    let totalDuration = 0;
    let totalWatched = 0;

    this.videoGroups.forEach(g => {
      g.videos.forEach(v => {
        totalVideos++;
        totalDuration += v.duration || 0;
        totalWatched += v.watched || 0;
      });
    });

    const progressPercent = totalDuration > 0 ? Math.round((totalWatched / totalDuration) * 100) : 0;

    statsEl.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${this.videoGroups.length}</div>
          <div class="stat-label">课程</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalVideos}</div>
          <div class="stat-label">视频</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this.formatDuration(totalDuration)}</div>
          <div class="stat-label">总时长</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this.formatDuration(totalWatched)}</div>
          <div class="stat-label">已观看</div>
        </div>
      </div>
      <div class="overall-progress">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </div>
        <span class="progress-text">${progressPercent}% · 剩余 ${this.formatDuration(totalDuration - totalWatched)}</span>
      </div>
    `;
  }

  renderGroupsList() {
    const listContainer = document.getElementById('videoGroupsList');
    if (!listContainer) return;

    if (this.videoGroups.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"></div>
          <div class="empty-text">暂无课程</div>
          <div class="empty-desc">点击上方按钮添加当前页面视频或创建新课程</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = this.videoGroups.map(group => {
      const totalDuration = group.videos.reduce((sum, v) => sum + (v.duration || 0), 0);
      const totalWatched = group.videos.reduce((sum, v) => sum + (v.watched || 0), 0);
      const progressPercent = totalDuration > 0 ? Math.round((totalWatched / totalDuration) * 100) : 0;
      const isExpanded = group._expanded !== false; // default expanded

      return `
        <div class="video-group" data-group-id="${group.id}">
          <div class="group-header" data-action="toggle-group" data-group-id="${group.id}">
            <div class="group-color" style="background: ${group.color || '#42a5f5'}"></div>
            <div class="group-info">
              <div class="group-name">${this.escapeHtml(group.name)}</div>
              <div class="group-meta">
                <span>${group.videos.length} 个视频</span>
                <span>${this.formatDuration(totalDuration)}</span>
                <span class="group-progress">${progressPercent}%</span>
              </div>
            </div>
            <div class="group-progress-bar">
              <div class="group-progress-fill" style="width: ${progressPercent}%"></div>
            </div>
            <div class="group-toggle">${isExpanded ? '▼' : '▶'}</div>
          </div>

          <div class="group-actions">
            <button class="btn btn-small" data-action="add-to-group" data-group-id="${group.id}" title="添加当前页面视频">+ 添加视频</button>
            <button class="btn btn-small" data-action="open-group" data-group-id="${group.id}" title="打开所有视频">打开全部</button>
            <button class="btn btn-small btn-icon" data-action="rename-group" data-group-id="${group.id}" title="重命名">✎</button>
            <button class="btn btn-small btn-icon btn-danger" data-action="delete-group" data-group-id="${group.id}" title="删除">✕</button>
          </div>

          <div class="group-videos" style="display: ${isExpanded ? 'block' : 'none'}">
            ${group.videos.length === 0 ? `
              <div class="group-empty">暂无视频，点击"添加视频"按钮</div>
            ` : group.videos.map(video => {
              const videoProgress = video.duration > 0 ? Math.round(((video.watched || 0) / video.duration) * 100) : 0;
              return `
                <div class="video-item" data-action="open-video" data-url="${this._escapeHtmlAttribute(video.url)}" title="点击打开视频页面">
                  <img class="video-favicon" src="${this._escapeHtmlAttribute(video.favicon || '')}" loading="lazy" onerror="this.style.display='none'">
                  <div class="video-info">
                    <div class="video-title" title="${this._escapeHtmlAttribute(video.title)}">${this.escapeHtml(video.title)}</div>
                    <div class="video-meta">
                      <span>${this.formatDuration(video.duration)}</span>
                      <span>已看 ${this.formatDuration(video.watched || 0)}</span>
                      <span>${videoProgress}%</span>
                    </div>
                    <div class="video-progress-bar">
                      <div class="video-progress-fill" style="width: ${videoProgress}%"></div>
                    </div>
                  </div>
                  <button class="btn btn-icon btn-small btn-danger" data-action="remove-video" data-group-id="${group.id}" data-video-id="${video.id}" title="移除" onclick="event.stopPropagation()">✕</button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  toggleGroup(groupId) {
    const group = this.videoGroups.find(g => g.id === groupId);
    if (group) {
      group._expanded = !(group._expanded !== false);
      this.renderGroupsList();
    }
  }

  formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  _escapeHtmlAttribute(str) {
    return String(str)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

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

  destroy() {
    if (this.storageChangeTimer) {
      clearTimeout(this.storageChangeTimer);
    }
  }
}

export default VideoProgressView;
