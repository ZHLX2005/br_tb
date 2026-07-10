/**
 * VideoProgress Sort Dialog - 排序视频弹窗（TabBoard 内嵌化版本）
 * 旧版是 sort-videos.html + sort-videos-shell.js 整页;新版改为 inline 弹窗。
 * 拖拽逻辑 1:1 移植自 sort-videos-shell.js。
 *
 * 用法:
 *   import { openSortDialog } from './sort-dialog.js';
 *   openSortDialog(groupId, dataManager, onSaved);
 *      - groupId: 课程 id
 *      - dataManager: DataManager 实例（已含 videoGroups 缓存）
 *      - onSaved: 保存成功后回调（让宿主刷新列表）
 */

class SortDialog {
  constructor(groupId, dataManager, onSaved) {
    this.groupId = groupId;
    this.dataManager = dataManager;
    this.onSaved = onSaved;
    this.videos = [];
    this.groupName = '';
    this.dragSrcIndex = null;
    this.overlay = null;
    this._escHandler = null;
  }

  async open() {
    const res = await this.dataManager.sendMessage('getVideoGroups');
    if (!res.success || !res.videoGroups) {
      this._renderEmpty('加载失败');
      return;
    }
    const group = res.videoGroups.find(g => g.id === this.groupId);
    if (!group) {
      this._renderEmpty('课程不存在');
      return;
    }
    this.groupName = group.name || '未命名课程';
    this.videos = [...(group.videos || [])];
    this._buildOverlay();
    this._bindOverlayEvents();
  }

  _renderEmpty(text) {
    // 即使加载失败也给个提示 overlay,跟普通 open 流程一致（可关闭）
    this.videos = [];
    this.groupName = text;
    this._buildOverlay();
    this._bindOverlayEvents();
  }

  _buildOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'video-progress-sort-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'video-progress-sort-dialog';
    dialog.innerHTML = `
      <h3>排序：${this.escapeHtml(this.groupName)}</h3>
      <div class="video-progress-sort-actions">
        <button class="btn btn-secondary vp-sort-reverse">翻转顺序</button>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary vp-sort-cancel">取消</button>
          <button class="btn btn-primary vp-sort-save">保存</button>
        </div>
      </div>
      <div class="video-progress-sort-list"></div>
    `;
    this.overlay.appendChild(dialog);
    document.body.appendChild(this.overlay);
    this._renderList(dialog);
  }

  _renderList(dialog) {
    const list = dialog.querySelector('.video-progress-sort-list');
    if (this.videos.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-text">${
        this.videos.length === 0 && this.groupName ? this.escapeHtml(this.groupName) : '暂无视频'
      }</div></div>`;
      return;
    }
    list.innerHTML = this.videos.map((video, index) => `
      <div class="video-progress-sort-item" draggable="true" data-index="${index}">
        <span class="handle">☰</span>
        <span class="index">${index + 1}</span>
        <span class="title">${this.escapeHtml(video.title || '未命名视频')}</span>
      </div>
    `).join('');
  }

  _bindOverlayEvents() {
    const dialog = this.overlay.querySelector('.video-progress-sort-dialog');
    const list = dialog.querySelector('.video-progress-sort-list');

    // drag handlers
    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.video-progress-sort-item');
      if (!item) return;
      this.dragSrcIndex = +item.dataset.index;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    list.addEventListener('dragend', (e) => {
      const item = e.target.closest('.video-progress-sort-item');
      if (item) item.classList.remove('dragging');
      this.dragSrcIndex = null;
    });
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const overItem = e.target.closest('.video-progress-sort-item');
      if (!overItem) return;
      const overIndex = +overItem.dataset.index;
      if (this.dragSrcIndex === null || this.dragSrcIndex === overIndex) return;
      const src = this.videos[this.dragSrcIndex];
      this.videos.splice(this.dragSrcIndex, 1);
      this.videos.splice(overIndex, 0, src);
      this.dragSrcIndex = overIndex;
      this._renderList(dialog);
    });

    // buttons
    dialog.querySelector('.vp-sort-reverse').addEventListener('click', () => {
      this.videos.reverse();
      this._renderList(dialog);
    });
    dialog.querySelector('.vp-sort-cancel').addEventListener('click', () => this.close());
    dialog.querySelector('.vp-sort-save').addEventListener('click', () => this._save());

    // ESC 关闭 + 遮罩点击关闭
    this._escHandler = (e) => {
      if (e.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', this._escHandler);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  async _save() {
    const videoIds = this.videos.map(v => v.id);
    const res = await this.dataManager.sendMessage(
      'reorderGroupVideos',
      { groupId: this.groupId, videoIds }
    );
    if (res.success) {
      this.close();
      if (this.onSaved) await this.onSaved();
    } else {
      alert('保存失败：' + (res.error || '未知错误'));
    }
  }

  close() {
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.remove();
    }
    this.overlay = null;
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }
}

/**
 * 打开排序弹窗 — 对外 API
 */
export function openSortDialog(groupId, dataManager, onSaved) {
  const dlg = new SortDialog(groupId, dataManager, onSaved);
  dlg.open().catch(err => {
    console.error('[video-progress] openSortDialog failed:', err);
    dlg.close();
  });
  return dlg;
}

export default openSortDialog;
