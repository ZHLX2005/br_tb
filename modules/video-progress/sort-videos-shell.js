/**
 * SortVideosShell - 视频排序页面
 */

class SortVideosShell {
  constructor() {
    this.groupId = new URLSearchParams(window.location.search).get('groupId');
    this.videos = [];
    this.groupName = '';
    this.dragSrcIndex = null;
  }

  async init() {
    if (!this.groupId) {
      this.showEmpty('缺少课程 ID');
      return;
    }

    const response = await chrome.runtime.sendMessage({ action: 'getVideoGroups' });
    if (!response.success || !response.videoGroups) {
      this.showEmpty('加载失败');
      return;
    }

    const group = response.videoGroups.find(g => g.id === this.groupId);
    if (!group) {
      this.showEmpty('课程不存在');
      return;
    }

    this.groupName = group.name || '未命名课程';
    this.videos = [...group.videos];
    document.getElementById('pageTitle').textContent = `排序：${this.groupName}`;
    this.render();
    this.bindEvents();
  }

  render() {
    const list = document.getElementById('sortList');
    if (this.videos.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-text">暂无视频</div></div>';
      return;
    }

    list.innerHTML = this.videos.map((video, index) => `
      <div class="sort-item" draggable="true" data-index="${index}">
        <span class="sort-handle">☰</span>
        <span class="sort-index">${index + 1}</span>
        <span class="sort-title">${this.escapeHtml(video.title || '未命名视频')}</span>
      </div>
    `).join('');
  }

  bindEvents() {
    const list = document.getElementById('sortList');

    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.sort-item');
      if (!item) return;
      this.dragSrcIndex = +item.dataset.index;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    list.addEventListener('dragend', (e) => {
      const item = e.target.closest('.sort-item');
      if (item) item.classList.remove('dragging');
      this.dragSrcIndex = null;
    });

    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const overItem = e.target.closest('.sort-item');
      if (!overItem) return;
      const overIndex = +overItem.dataset.index;
      if (this.dragSrcIndex === null || this.dragSrcIndex === overIndex) return;

      const src = this.videos[this.dragSrcIndex];
      this.videos.splice(this.dragSrcIndex, 1);
      this.videos.splice(overIndex, 0, src);
      this.dragSrcIndex = overIndex;
      this.render();
    });

    document.getElementById('reverseBtn').addEventListener('click', () => {
      this.videos.reverse();
      this.render();
    });

    document.getElementById('saveBtn').addEventListener('click', () => this.save());
    document.getElementById('cancelBtn').addEventListener('click', () => this.goBack());
  }

  async save() {
    const videoIds = this.videos.map(v => v.id);
    const response = await chrome.runtime.sendMessage({
      action: 'reorderGroupVideos',
      groupId: this.groupId,
      videoIds
    });

    if (response.success) {
      this.goBack();
    } else {
      alert('保存失败：' + (response.error || '未知错误'));
    }
  }

  goBack() {
    window.location.href = chrome.runtime.getURL('modules/video-progress/video-progress.html');
  }

  showEmpty(text) {
    document.getElementById('sortList').innerHTML = `<div class="empty-state"><div class="empty-text">${text}</div></div>`;
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

const shell = new SortVideosShell();
document.addEventListener('DOMContentLoaded', () => shell.init());
