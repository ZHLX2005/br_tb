/**
 * VideoProgressView - 视频进度聚合视图
 * 显示课程组、视频列表和观看进度
 */

import { modal } from '../../shared/ModalDialog.js';
import { getVideoDisplayProgress, getGroupDisplayProgress, formatDuration, getGroupTotals } from './progress-utils.js';
import { normalizeUrl } from '../../background/utils.js';

class VideoProgressView {
  constructor(dataManager, mode = 'full') {
    this.dataManager = dataManager;
    this.mode = mode;
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
    document.getElementById('backToProgressBtn')?.addEventListener('click', () => this.backToVideoProgress());
    document.getElementById('archivePageBtn')?.addEventListener('click', () => this.openArchivePage());
    document.getElementById('addGroupBtn')?.addEventListener('click', () => this.createGroup());
    document.getElementById('batchImportBtn')?.addEventListener('click', () => this.openBatchImportDialog());
    document.getElementById('batchCancelBtn')?.addEventListener('click', () => this.closeBatchImportDialog());
    document.getElementById('batchConfirmBtn')?.addEventListener('click', () => this.startBatchImport());

    const fileInput = document.getElementById('batchFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleBatchFile(e));
    }

    const dialog = document.getElementById('batchImportDialog');
    if (dialog) {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) this.closeBatchImportDialog();
      });
    }

    // Event delegation for dynamically created elements
    document.addEventListener('click', (e) => {
      // 点击标题输入框时不触发 data-action（避免和 open-video 冲突）
      if (e.target.closest('.video-title-input')) return;

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
        case 'sort-group':
          this.openSortPage(groupId);
          break;
        case 'archive-group':
          this.archiveGroup(groupId);
          break;
        case 'unarchive-group':
          this.unarchiveGroup(groupId);
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

    // 视频标题 inline 编辑事件（input 元素不在 [data-action] 体系内）
    document.addEventListener('click', (e) => {
      const input = e.target.closest('.video-title-input');
      if (!input) return;
      if (input.readOnly) {
        input.readOnly = false;
        input.select();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!e.target.classList.contains('video-title-input')) return;
      if (e.key === 'Enter') {
        e.target.blur();
      } else if (e.key === 'Escape') {
        const original = e.target.dataset.originalTitle || '';
        e.target.value = original;
        e.target.readOnly = true;
      }
    });

    document.addEventListener('blur', (e) => {
      if (!e.target.classList.contains('video-title-input')) return;
      this._saveVideoTitle(e.target);
    }, true);
  }

  backToTabboard() {
    window.location.href = chrome.runtime.getURL('modules/tabboard/tabboard.html');
  }

  backToVideoProgress() {
    window.location.href = chrome.runtime.getURL('modules/video-progress/video-progress.html');
  }

  openArchivePage() {
    window.location.href = chrome.runtime.getURL('modules/video-progress/archive.html');
  }

  openSortPage(groupId) {
    window.location.href = chrome.runtime.getURL(`modules/video-progress/sort-videos.html?groupId=${groupId}`);
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

  async archiveGroup(groupId) {
    const group = this.videoGroups.find(g => g.id === groupId);
    if (!group) return;

    const confirmed = await modal.confirm(
      `确定要归档「${group.name}」吗？归档后该课程将从活跃列表移至归档，进度条中不再显示。`,
      {
        title: '归档课程',
        type: 'warning',
        confirmText: '归档',
        cancelText: '取消'
      }
    );
    if (!confirmed) return;

    const response = await chrome.runtime.sendMessage({
      action: 'archiveVideoGroup',
      groupId
    });

    if (response.success) {
      await this.loadVideoGroups();
      this.render();
      this.showToast('课程已归档', 'info');
    }
  }

  async unarchiveGroup(groupId) {
    const confirmed = await modal.confirm('确定要恢复这个课程吗？它将重新出现在活跃列表中。', {
      title: '恢复课程',
      type: 'info',
      confirmText: '恢复',
      cancelText: '取消'
    });
    if (!confirmed) return;

    const response = await chrome.runtime.sendMessage({
      action: 'unarchiveVideoGroup',
      groupId
    });

    if (response.success) {
      await this.loadVideoGroups();
      this.render();
      this.showToast('课程已恢复', 'success');
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

  // ========== 批量导入 ==========

  openBatchImportDialog() {
    const select = document.getElementById('batchGroupSelect');
    if (select) {
      select.innerHTML = this.videoGroups.map((g, i) =>
        `<option value="${i}">${this.escapeHtml(g.name)} (${g.videos.length} 个视频)</option>`
      ).join('');
    }
    document.getElementById('batchUrlInput').value = '';
    document.getElementById('batchFileInput').value = '';
    document.getElementById('batchProgress').innerHTML = '';
    document.getElementById('batchImportDialog').classList.add('active');
  }

  closeBatchImportDialog() {
    document.getElementById('batchImportDialog').classList.remove('active');
  }

  handleBatchFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('batchUrlInput').value = ev.target.result;
    };
    reader.readAsText(file);
  }

  async startBatchImport() {
    const textarea = document.getElementById('batchUrlInput');
    const select = document.getElementById('batchGroupSelect');
    const progressEl = document.getElementById('batchProgress');

    const urls = textarea.value.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (urls.length === 0) {
      this.showToast('请输入至少一个视频链接', 'warning');
      return;
    }

    const groupIndex = parseInt(select.value);
    if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= this.videoGroups.length) {
      this.showToast('请选择目标课程', 'warning');
      return;
    }

    const group = this.videoGroups[groupIndex];
    const confirmBtn = document.getElementById('batchConfirmBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '导入中...';

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (let i = 0; i < urls.length; i++) {
      const rawUrl = urls[i];
      progressEl.innerHTML = `<div class="batch-progress-bar"><div class="batch-progress-fill" style="width:${((i + 1) / urls.length) * 100}%"></div></div>
        <div class="batch-progress-text">处理中 ${i + 1}/${urls.length}: ${this.escapeHtml(rawUrl.substring(0, 60))}...</div>`;

      let videoUrl = rawUrl;
      if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
        videoUrl = 'https://' + videoUrl;
      }

      let tab;
      try {
        tab = await chrome.tabs.create({ url: videoUrl, active: true });
      } catch (err) {
        failCount++;
        continue;
      }

      // 轮询检测，最多 10 秒
      let results = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        await this._sleep(2000);
        try {
          results = await chrome.tabs.sendMessage(tab.id, { action: 'detectVideos' });
          if (results && results.videos && results.videos.length > 0) break;
        } catch (_) {
          // content script not ready
        }
      }

      // 关闭标签页
      try { await chrome.tabs.remove(tab.id); } catch (_) {}

      if (!results || !results.videos || results.videos.length === 0) {
        failCount++;
        continue;
      }

      const video = results.videos[0];
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
        successCount++;
      } else if (response.error === 'Video already in group') {
        skipCount++;
      } else {
        failCount++;
      }
    }

    // 切回当前页面
    try {
      const selfUrl = chrome.runtime.getURL('modules/video-progress/video-progress.html');
      const allTabs = await chrome.tabs.query({});
      const selfTab = allTabs.find(t => t.url === selfUrl);
      if (selfTab) await chrome.tabs.update(selfTab.id, { active: true });
    } catch (_) {}

    progressEl.innerHTML = `<div class="batch-result">
      <span class="batch-success">成功 ${successCount}</span>
      <span class="batch-skip">已存在 ${skipCount}</span>
      <span class="batch-fail">失败 ${failCount}</span>
    </div>`;

    confirmBtn.disabled = false;
    confirmBtn.textContent = '开始导入';

    await this.loadVideoGroups();
    this.render();
    this.showToast(`批量导入完成: 成功 ${successCount}, 已存在 ${skipCount}, 失败 ${failCount}`, 'success');
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

  async _saveVideoTitle(input) {
    const groupId = input.dataset.groupId;
    const videoId = input.dataset.videoId;
    const original = input.dataset.originalTitle || '';
    const newTitle = input.value.trim();

    input.readOnly = true;

    if (!newTitle || newTitle === original) {
      input.value = original;
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'updateVideoTitle',
        groupId,
        videoId,
        newTitle
      });
      if (response.success) {
        input.dataset.originalTitle = newTitle;
        this.showToast('标题已保存', 'success');
      } else {
        input.value = original;
        this.showToast('保存失败', 'error');
      }
    } catch {
      input.value = original;
      this.showToast('保存失败', 'error');
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  render() {
    if (this.mode === 'archive') {
      this.renderArchivedGroups();
      return;
    }
    this.renderStats();
    this.renderGroupsList();
    this.renderArchivedGroups();
  }

  renderStats() {
    const statsEl = document.getElementById('videoStats');
    if (!statsEl) return;

    const activeGroups = this.videoGroups.filter(g => !g.archived);
    let totalVideos = 0;
    let totalDuration = 0;
    let totalWatched = 0;

    activeGroups.forEach(g => {
      g.videos.forEach(v => {
        totalVideos++;
        totalDuration += v.duration || 0;
        totalWatched += v.watched || 0;
      });
    });

    // 保守进度：超过 50% 的视频数 / 总视频数
    const allVideos = activeGroups.flatMap(g => g.videos);
    const progressPercent = getGroupDisplayProgress(allVideos);

    statsEl.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${activeGroups.length}</div>
          <div class="stat-label">课程</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalVideos}</div>
          <div class="stat-label">视频</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${formatDuration(totalDuration)}</div>
          <div class="stat-label">总时长</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${formatDuration(totalWatched)}</div>
          <div class="stat-label">已观看</div>
        </div>
      </div>
      <div class="overall-progress">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </div>
        <span class="progress-text">${progressPercent}% · 剩余 ${formatDuration(totalDuration - totalWatched)}</span>
      </div>
    `;
  }

  renderGroupsList() {
    const listContainer = document.getElementById('videoGroupsList');
    if (!listContainer) return;

    const activeGroups = this.videoGroups.filter(g => !g.archived);

    if (activeGroups.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"></div>
          <div class="empty-text">暂无活跃课程</div>
          <div class="empty-desc">点击上方按钮创建新课程或批量导入</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = activeGroups.map(group => {
      const totalDuration = group.videos.reduce((sum, v) => sum + (v.duration || 0), 0);
      const progressPercent = getGroupDisplayProgress(group.videos);
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
            <button class="btn btn-small btn-icon" data-action="sort-group" data-group-id="${group.id}" title="排序视频" style="background:#e3f2fd;color:#1976d2;">☰</button>
            <button class="btn btn-small btn-icon" data-action="archive-group" data-group-id="${group.id}" title="归档课程" style="background:#fff3e0;color:#ff9800;">⤓</button>
            <button class="btn btn-small btn-icon btn-danger" data-action="delete-group" data-group-id="${group.id}" title="删除">✕</button>
          </div>

          <div class="group-videos" style="display: ${isExpanded ? 'block' : 'none'}">
            ${group.videos.length === 0 ? `
              <div class="group-empty">暂无视频，点击"添加视频"按钮</div>
            ` : group.videos.map(video => {
              const videoProgress = getVideoDisplayProgress(video);
              return `
                <div class="video-item" data-action="open-video" data-url="${this._escapeHtmlAttribute(video.url)}" title="点击打开视频页面">
                  <img class="video-favicon" src="${this._escapeHtmlAttribute(video.favicon || '')}" loading="lazy" onerror="this.style.display='none'">
                  <div class="video-info">
                    <input type="text" class="video-title-input" value="${this._escapeHtmlAttribute(video.title)}" data-original-title="${this._escapeHtmlAttribute(video.title)}" data-group-id="${group.id}" data-video-id="${video.id}" title="点击编辑标题">
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

  renderArchivedGroups() {
    const archiveSection = document.getElementById('archiveSection');
    const listContainer = document.getElementById('archivedGroupsList');
    if (!listContainer) return;

    const archivedGroups = this.videoGroups.filter(g => g.archived);

    if (archivedGroups.length === 0) {
      if (archiveSection) archiveSection.style.display = 'none';
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"></div>
          <div class="empty-text">暂无归档课程</div>
          <div class="empty-desc">归档的课程将在这里留下足迹</div>
        </div>
      `;
      return;
    }

    if (archiveSection) archiveSection.style.display = 'block';
    listContainer.innerHTML = archivedGroups.map(group => {
      const snap = group.archiveSnapshot || {};
      const videoCount = snap.videoCount || group.videos.length || 0;
      const totalDuration = snap.totalDuration || group.videos.reduce((s, v) => s + (v.duration || 0), 0);
      const totalWatched = snap.totalWatched || group.videos.reduce((s, v) => s + (v.watched || 0), 0);
      const progressPercent = totalDuration > 0 ? Math.round((totalWatched / totalDuration) * 100) : 0;
      const archivedDate = group.archivedAt
        ? new Date(group.archivedAt).toLocaleDateString('zh-CN')
        : '';
      const isExpanded = group._expanded !== false;
      const videos = snap.videos || group.videos || [];

      return `
        <div class="video-group archived" data-group-id="${group.id}">
          <div class="group-header" data-action="toggle-group" data-group-id="${group.id}">
            <div class="group-color" style="background: ${group.color || '#42a5f5'}"></div>
            <div class="group-info">
              <div class="group-name">${this.escapeHtml(group.name)}</div>
              <div class="group-meta">
                <span>${videoCount} 个视频</span>
                <span>总时长 ${this.formatDuration(totalDuration)}</span>
                <span>已看 ${this.formatDuration(totalWatched)}</span>
                <span class="group-progress">${progressPercent}%</span>
                ${archivedDate ? `<span style="color:#aaa;margin-left:8px;">归档于 ${archivedDate}</span>` : ''}
              </div>
            </div>
            <div class="group-progress-bar">
              <div class="group-progress-fill" style="width: ${progressPercent}%"></div>
            </div>
            <div class="group-toggle">${isExpanded ? '▼' : '▶'}</div>
          </div>

          <div class="group-actions">
            <button class="btn btn-small" data-action="unarchive-group" data-group-id="${group.id}" title="恢复为活跃课程">↺ 恢复课程</button>
            <button class="btn btn-small" data-action="open-group" data-group-id="${group.id}" title="打开所有视频">打开全部</button>
            <button class="btn btn-small btn-icon btn-danger" data-action="delete-group" data-group-id="${group.id}" title="删除">✕</button>
          </div>

          <div class="group-videos" style="display: ${isExpanded ? 'block' : 'none'}">
            ${videos.length === 0 ? `
              <div class="group-empty">暂无视频记录</div>
            ` : videos.map(video => {
              const videoProgress = video.duration > 0 ? Math.round(((video.watched || 0) / video.duration) * 100) : 0;
              return `
                <div class="video-item" style="cursor: default;">
                  <div class="video-info" style="flex: 1;">
                    <div style="font-size: 14px; color: #666; margin-bottom: 4px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(video.title)}</div>
                    <div class="video-meta">
                      <span>${this.formatDuration(video.duration)}</span>
                      <span>已看 ${this.formatDuration(video.watched || 0)}</span>
                      <span>${videoProgress}%</span>
                    </div>
                    <div class="video-progress-bar">
                      <div class="video-progress-fill" style="width: ${videoProgress}%"></div>
                    </div>
                  </div>
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
      this.render();
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
