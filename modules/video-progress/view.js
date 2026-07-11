/**
 * VideoProgressView - 视频进度聚合视图（TabBoard 内嵌版）
 * 显示课程组、视频列表和观看进度。
 * 旧版用 window.location.href 跳到独立 HTML；内嵌化后改为：
 * - backToTabboard 改为空操作（nav 自身就是返回）
 * - openArchivePage 切 mode='archive'
 * - openSortPage 改为 import openSortDialog 走 in-app 弹窗
 */

import { modal } from '../../../shared/ModalDialog.js';
import { getVideoDisplayProgress, getGroupDisplayProgress, formatDuration, getGroupTotals } from './progress-utils.js';
import { normalizeUrl } from '../../../background/utils.js';
import { openSortDialog } from './sort-dialog.js';

class VideoProgressView {
  constructor(dataManager, mode = 'full') {
    this.dataManager = dataManager;
    this.mode = mode;
    this.videoGroups = [];
    this.storageChangeTimer = null;
    this.isInitialized = false;

    // Phase 7 修复:destroy() 解绑 chrome.storage.onChanged 监听
    this._onStorageChange = null;
    // Phase 7 修复:destroy() 解绑 document 委托
    this._boundContainer = null;
    this._listeners = [];
  }

  /**
   * setContainer - 由 VideoProgressModule / tabboard.js._reattachModule 调用
   * 仅记录容器引用;事件重绑由 bindEvents() 负责(reattach 时 tabboard 会调它)。
   */
  setContainer(container) {
    this.container = container;
  }

  /**
   * updateData - 由 VideoProgressModule.render(data) 调用（tabboard.js 缓存路径）
   * 取代旧的直接 chrome.runtime.sendMessage 拉数据
   * Bug fix: 旧版会判 isInitialized 才 render,但 init() 异步未完成时,
   * render(data) 不会触发 → 白页。现在无条件 render,让 module.render 流程直接画 DOM。
   */
  updateData(data) {
    this.videoGroups = data.videoGroups || [];
    this.render();
  }

  async init() {
    this._wireStorageListener();
    this._wireContainerDelegation();
    await this.loadVideoGroups();
    this.isInitialized = true;
  }

  /**
   * 包装 chrome.storage.onChanged - 幂等,让 destroy 能 removeListener 后由 bindEvents 重绑
   */
  _wireStorageListener() {
    if (this._onStorageChange) return; // 已绑,幂等
    this._onStorageChange = (changes, namespace) => {
      if (namespace !== 'local') return;
      if (this.storageChangeTimer) clearTimeout(this.storageChangeTimer);
      this.storageChangeTimer = setTimeout(async () => {
        if (changes.videoGroups) {
          await this.loadVideoGroups();
          this.render();
        }
      }, 100);
    };
    chrome.storage.onChanged.addListener(this._onStorageChange);
  }

  async loadVideoGroups() {
    const response = await this.dataManager.sendMessage('getVideoGroups');
    if (response.success) {
      this.videoGroups = response.videoGroups || [];
      // 初始化 _expanded 默认值(活跃课程默认展开,归档课程默认折叠)。
      // 后续点击再由 toggleGroup 翻转。只在 undefined 时设一次,保留用户操作。
      this.videoGroups.forEach(g => {
        if (g._expanded === undefined) g._expanded = !g.archived;
      });
    }
  }

  bindEvents() {
    // 幂等:每个 wire 函数自己防重复。tabboard cache-hit 重挂时会调 bindEvents,
    // 此时 destroy 已移除 storage/delegation 监听并清掉 guard,这里重绑。
    // 这修复了"切走再切回 → [data-action] 按钮全失效(归档/展开/删除等都点不动)"。
    this._wireStorageListener();
    this._wireContainerDelegation();
    this._wireHeaderButtons();
  }

  /**
   * Header 按钮一次性绑定（用 this.container.onscroll 之类的 frequency 通常不高,
   * 一次性绑即可，因为 #videoProgressView 不会重渲染 header 部分——render() 只更 stats/list。
   */
  _wireHeaderButtons() {
    const root = this.container || document;
    const map = {
      'vpBatchImportBtn':   () => this.openBatchImportDialog(),
      'vpAddGroupBtn':      () => this.createGroup(),
      'vpArchiveToggleBtn': () => this.toggleArchiveMode(true),
      'vpBackToActiveBtn':  () => this.toggleArchiveMode(false),
    };
    Object.entries(map).forEach(([id, handler]) => {
      const btn = root.querySelector(`#${id}`) || document.getElementById(id);
      if (btn && !btn.__vpBound) {
        btn.addEventListener('click', handler);
        btn.__vpBound = true;
      }
    });

    const cancel = document.getElementById('batchCancelBtn');
    if (cancel && !cancel.__vpBound) {
      cancel.addEventListener('click', () => this.closeBatchImportDialog());
      cancel.__vpBound = true;
    }
    const confirm = document.getElementById('batchConfirmBtn');
    if (confirm && !confirm.__vpBound) {
      confirm.addEventListener('click', () => this.startBatchImport());
      confirm.__vpBound = true;
    }
    const fileInput = document.getElementById('batchFileInput');
    if (fileInput && !fileInput.__vpBound) {
      fileInput.addEventListener('change', (e) => this.handleBatchFile(e));
      fileInput.__vpBound = true;
    }
    const dialog = document.getElementById('batchImportDialog');
    if (dialog && !dialog.__vpBound) {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) this.closeBatchImportDialog();
      });
      dialog.__vpBound = true;
    }
  }

  /**
   * 一次性绑 4 个 document 委托监听,并把引用记到 this._listeners,
   * destroy() 里 removeEventListener 解绑。
   * 内部 data-action dispatch 也走同一个 handler。
   */
  _wireContainerDelegation() {
    if (!this._boundDocument) {
      const root = document;

      const onClickAction = (e) => {
        // 点击标题输入框时不触发 data-action
        if (e.target.closest('.video-title-input')) return;
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const groupId = btn.dataset.groupId;
        const videoId = btn.dataset.videoId;
        switch (action) {
          case 'toggle-group':      this.toggleGroup(groupId); break;
          case 'rename-group':      this.renameGroup(groupId); break;
          case 'delete-group':      this.deleteGroup(groupId); break;
          case 'sort-group':        this.openSortPage(groupId); break;
          case 'archive-group':     this.archiveGroup(groupId); break;
          case 'unarchive-group':   this.unarchiveGroup(groupId); break;
          case 'open-group':        this.openGroup(groupId); break;
          case 'open-video':        this.openVideo(btn.dataset.url); break;
          case 'remove-video':      this.removeVideo(groupId, videoId); break;
          case 'add-to-group':      this.addDetectedVideoToGroup(groupId); break;
        }
      };

      const onClickInput = (e) => {
        const input = e.target.closest('.video-title-input');
        if (!input) return;
        if (input.readOnly) {
          input.readOnly = false;
          input.select();
        }
      };

      const onKeydownInput = (e) => {
        if (!e.target.classList.contains('video-title-input')) return;
        if (e.key === 'Enter') {
          e.target.blur();
        } else if (e.key === 'Escape') {
          const original = e.target.dataset.originalTitle || '';
          e.target.value = original;
          e.target.readOnly = true;
        }
      };

      const onBlurInput = (e) => {
        if (!e.target.classList.contains('video-title-input')) return;
        this._saveVideoTitle(e.target);
      };

      root.addEventListener('click', onClickAction);
      root.addEventListener('click', onClickInput);
      root.addEventListener('keydown', onKeydownInput);
      root.addEventListener('blur', onBlurInput, true);

      this._listeners = [
        [root, 'click', onClickAction],
        [root, 'click', onClickInput],
        [root, 'keydown', onKeydownInput],
        [root, 'blur', onBlurInput, /* capture */ true],
      ];
      this._boundDocument = root;
    }
  }

  /**
   * 切换归档 / 活跃模式
   */
  toggleArchiveMode(toArchive) {
    this.mode = toArchive ? 'archive' : 'full';
    this.render();
  }

  /**
   * 旧 redirect 兼容—— video-progress-shell.js 仍可能在 redirect 后 import 此模块
   */
  backToTabboard() {
    if (window.parent !== window) return;
    window.location.href = chrome.runtime.getURL('modules/tabboard/tabboard.html');
  }

  backToVideoProgress() {
    if (this.mode === 'archive') this.toggleArchiveMode(false);
  }

  openArchivePage() {
    this.toggleArchiveMode(true);
  }

  openSortPage(groupId) {
    // 内嵌化后改走 in-app 弹窗
    openSortDialog(groupId, this.dataManager, async () => {
      await this.loadVideoGroups();
      this.render();
    });
  }

  async createGroup() {
    const name = await modal.prompt('请输入课程名称:', {
      title: '新建课程',
      defaultValue: `课程 ${this.videoGroups.length + 1}`,
      placeholder: '课程名称',
      confirmText: '创建'
    });
    if (!name || !name.trim()) return;

    const response = await this.dataManager.sendMessage(
      'addVideoGroup',
      { name: name.trim() }
    );

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

    const response = await this.dataManager.sendMessage(
      'renameVideoGroup',
      { groupId, newName: newName.trim() }
    );

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

    const response = await this.dataManager.sendMessage(
      'deleteVideoGroup',
      { groupId }
    );

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

    const response = await this.dataManager.sendMessage(
      'archiveVideoGroup',
      { groupId }
    );

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

    const response = await this.dataManager.sendMessage(
      'unarchiveVideoGroup',
      { groupId }
    );

    if (response.success) {
      await this.loadVideoGroups();
      this.render();
      this.showToast('课程已恢复', 'success');
    }
  }

  async openGroup(groupId) {
    const response = await this.dataManager.sendMessage(
      'openVideoGroup',
      { groupId }
    );

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

    const response = await this.dataManager.sendMessage(
      'removeVideoFromGroup',
      { groupId, videoId }
    );

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
      const response = await this.dataManager.sendMessage(
        'addVideoToGroup',
        {
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
    const response = await this.dataManager.sendMessage(
      'addVideoToGroup',
      {
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
      const response = await this.dataManager.sendMessage(
        'updateVideoTitle',
        { groupId, videoId, newTitle }
      );
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
    // skill §4: 每个 view.render() 必须主动更新 #stats,避免残留其他视图数据
    this._renderHeaderStats();

    // skill 错误案例:view.css 改名后 .dialog → .video-progress-dialog;批量导入 dialog 同时在两个模式都需要
    const dialog = document.getElementById('batchImportDialog');
    if (dialog) dialog.classList.remove('video-progress-dialog-active');

    // 归档模式 toggle 同步
    const archiveBtn = document.getElementById('vpArchiveToggleBtn');
    const backBtn = document.getElementById('vpBackToActiveBtn');
    if (archiveBtn && backBtn) {
      const isArchive = this.mode === 'archive';
      archiveBtn.style.display = isArchive ? 'none' : '';
      backBtn.style.display = isArchive ? '' : 'none';
    }

    // 归档区域在 active 模式下整体隐藏（用户反馈"始终显示已归档的视频"——）
    // 之前默认 visible 是老 standalone 页面的 UX,内嵌入 tabboard shell 后不合适
    const archiveSection = document.getElementById('archiveSection');
    const groupsSection = document.querySelector('#videoProgressView .groups-section');

    if (this.mode === 'archive') {
      // archive mode:只渲染归档 + 显示归档 section + 隐藏活跃列表区域
      if (archiveSection) archiveSection.style.display = '';
      if (groupsSection) groupsSection.style.display = 'none';
      this.renderStats();
      this.renderArchivedGroups();
      return;
    }

    // full mode:只渲染活跃 + 隐藏归档 section
    if (archiveSection) archiveSection.style.display = 'none';
    if (groupsSection) groupsSection.style.display = '';
    this.renderStats();
    this.renderGroupsList();
  }

  /**
   * 更新顶部 #stats + 内嵌头部 #vpPageTitle / #vpSubtitle
   */
  _renderHeaderStats() {
    const stats = document.getElementById('stats');
    if (stats) {
      const active = this.videoGroups.filter(g => !g.archived);
      const archived = this.videoGroups.filter(g => g.archived);
      const totalVideos = active.reduce((sum, g) => sum + g.videos.length, 0);
      stats.textContent =
        `${active.length} 课程 · ${totalVideos} 视频` +
        (archived.length ? ` · ${archived.length} 已归档` : '');
    }
  }

  renderStats() {
    const statsEl = document.getElementById('videoStats');
    if (!statsEl) return;

    // archive mode 下统计卡片显示归档数据(用 archiveSnapshot 冻结数,因为原 videos 可能已被清空)
    const isArchive = this.mode === 'archive';
    const targetGroups = isArchive
      ? this.videoGroups.filter(g => g.archived)
      : this.videoGroups.filter(g => !g.archived);
    let totalVideos = 0;
    let totalDuration = 0;
    let totalWatched = 0;

    targetGroups.forEach(g => {
      const snap = g.archiveSnapshot;
      if (isArchive && snap) {
        // 优先用 archiveSnapshot 冻结的总数(归档后原 videos 可能被改动)
        totalVideos += snap.videoCount || 0;
        totalDuration += snap.totalDuration || 0;
        totalWatched += snap.totalWatched || 0;
      } else {
        g.videos.forEach(v => {
          totalVideos++;
          totalDuration += v.duration || 0;
          totalWatched += v.watched || 0;
        });
      }
    });

    // 归档页只显示一个"累计已观看时长"卡片(简洁);活跃页保留完整 4 卡片 + 进度
    if (isArchive) {
      statsEl.innerHTML = `
        <div class="stats-grid" style="grid-template-columns: 1fr; max-width: 320px;">
          <div class="stat-card">
            <div class="stat-value">${formatDuration(totalWatched)}</div>
            <div class="stat-label">累计已观看</div>
          </div>
        </div>
      `;
      return;
    }

    // 保守进度:超过 50% 的视频数 / 总视频数
    const allVideos = targetGroups.flatMap(g => g.videos);
    const progressPercent = getGroupDisplayProgress(allVideos);

    statsEl.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${targetGroups.length}</div>
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
      const isExpanded = group._expanded === true || (group._expanded === undefined && !group.archived); // 活跃默认展开/归档默认折叠;_expanded 已明确时尊重用户 // default expanded

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
    const listContainer = document.getElementById('archivedGroupsList');
    if (!listContainer) return;

    const archivedGroups = this.videoGroups.filter(g => g.archived);

    if (archivedGroups.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"></div>
          <div class="empty-text">暂无归档课程</div>
          <div class="empty-desc">归档的课程将在这里留下足迹</div>
        </div>
      `;
      return;
    }
    listContainer.innerHTML = archivedGroups.map(group => {
      const snap = group.archiveSnapshot || {};
      const videoCount = snap.videoCount || group.videos.length || 0;
      const totalDuration = snap.totalDuration || group.videos.reduce((s, v) => s + (v.duration || 0), 0);
      const totalWatched = snap.totalWatched || group.videos.reduce((s, v) => s + (v.watched || 0), 0);
      const progressPercent = totalDuration > 0 ? Math.round((totalWatched / totalDuration) * 100) : 0;
      const archivedDate = group.archivedAt
        ? new Date(group.archivedAt).toLocaleDateString('zh-CN')
        : '';
      const isExpanded = group._expanded === true || (group._expanded === undefined && !group.archived); // 活跃默认展开/归档默认折叠;_expanded 已明确时尊重用户
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
      // 严格布尔切换。_expanded 默认由 loadVideoGroups 设置(活跃=true / 归档=false)。
      group._expanded = group._expanded !== true;
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
    toast.className = `video-progress-toast toast-${type}`;
    toast.textContent = message;
    // 不再 append 到 document.body（全局元素会在 view 销毁后残留），
    // 而是挂到 this.container 或退回到 document.body
    const host = this.container || document.body;
    host.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'video-progress-slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  destroy() {
    // Phase 7 / skill §10.4: 解绑 storage listener
    if (this._onStorageChange) {
      chrome.storage.onChanged.removeListener(this._onStorageChange);
      this._onStorageChange = null; // 清 guard,让下次 bindEvents 能重绑
    }

    // 解绑 document 委托
    if (this._listeners && this._listeners.length) {
      for (const entry of this._listeners) {
        const [target, type, handler, capture] = entry;
        target.removeEventListener(type, handler, capture);
      }
      this._listeners = [];
    }
    this._boundDocument = null; // 清 guard,让下次 bindEvents → _wireContainerDelegation 能重绑

    // 清定时器
    if (this.storageChangeTimer) {
      clearTimeout(this.storageChangeTimer);
      this.storageChangeTimer = null;
    }

    // ⚠️ 不要清 this.container.innerHTML!
    // #videoProgressView 下的 #videoStats / #videoGroupsList / header / batchDialog
    // 都是 tabboard.html 的静态 HTML,清掉后下次 mount 时 renderStats()/renderGroupsList()
    // 找不到这些 element,会静默早退 → "nav 切到 video 白页,只有 F5 才行"。
    // 动态内容由各 render* 方法自己 innerHTML= 清空。
    //
    // ⚠️ header 按钮(vpBatchImportBtn 等)的监听不加进 _listeners,因此 destroy 不解绑;
    // 它们挂在静态 DOM 上,跨 mount 持续有效,__vpBound guard 防重复绑。无需在此处理。
  }
}

export default VideoProgressView;
