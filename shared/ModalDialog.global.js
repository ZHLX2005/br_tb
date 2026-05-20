/**
 * ModalDialog - 统一的模态对话框组件 (全局版本)
 * 替代浏览器原生的 prompt 和 confirm
 * 用于非模块环境（如 popup.html）
 */

(function(window) {
  'use strict';

  class ModalDialog {
    constructor() {
      this.overlay = null;
      this.dialog = null;
      this.onConfirm = null;
      this.onCancel = null;
    }

    /**
     * 创建遮罩层
     */
    _createOverlay() {
      if (this.overlay) return this.overlay;

      this.overlay = document.createElement('div');
      this.overlay.className = 'modal-overlay';
      return this.overlay;
    }

    /**
     * 显示模态框
     */
    _show(content, options = {}) {
      const overlay = this._createOverlay();
      this.dialog = document.createElement('div');
      this.dialog.className = 'modal-dialog';

      if (options.width) {
        this.dialog.style.maxWidth = options.width;
      }

      this.dialog.innerHTML = content;
      overlay.appendChild(this.dialog);
      document.body.appendChild(overlay);

      // 绑定关闭事件
      const closeBtn = this.dialog.querySelector('.modal-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this._cancel());
      }

      // 点击遮罩关闭
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && options.closeOnOverlay !== false) {
          this._cancel();
        }
      });

      // ESC 键关闭
      this._escapeHandler = (e) => {
        if (e.key === 'Escape' && options.closeOnEsc !== false) {
          this._cancel();
        }
      };
      document.addEventListener('keydown', this._escapeHandler);

      // 自动聚焦输入框
      const input = this.dialog.querySelector('input, textarea');
      if (input) {
        setTimeout(() => input.focus(), 100);
        if (input.select) {
          setTimeout(() => input.select(), 150);
        }
      }

      // 确认按钮
      const confirmBtn = this.dialog.querySelector('.modal-confirm');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => this._confirm());
      }

      // 取消按钮
      const cancelBtn = this.dialog.querySelector('.modal-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => this._cancel());
      }

      // 回车键确认（仅当有输入框时）
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            this._confirm();
          }
        });
      }
    }

    /**
     * 确认
     */
    _confirm() {
      if (this.onConfirm) {
        this.onConfirm();
      }
      this._hide();
    }

    /**
     * 取消
     */
    _cancel() {
      if (this.onCancel) {
        this.onCancel();
      }
      this._hide();
    }

    /**
     * 隐藏模态框
     */
    _hide() {
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
      if (this._escapeHandler) {
        document.removeEventListener('keydown', this._escapeHandler);
        this._escapeHandler = null;
      }
      this.dialog = null;
      this.onConfirm = null;
      this.onCancel = null;
    }

    /**
     * 确认对话框
     */
    confirm(message, options = {}) {
      return new Promise((resolve) => {
        const title = options.title || '确认操作';
        const confirmText = options.confirmText || '确定';
        const cancelText = options.cancelText || '取消';
        const type = options.type || 'warning';

        const content = `
          <div class="modal-header">
            <h3 class="modal-title">${this._escapeHtml(title)}</h3>
            <button class="modal-close" type="button">&times;</button>
          </div>
          <div class="modal-body">
            <div class="modal-message modal-type-${type}">${this._escapeHtml(message)}</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary modal-cancel">${cancelText}</button>
            <button class="btn btn-${type === 'danger' ? 'danger' : 'primary'} modal-confirm">${confirmText}</button>
          </div>
        `;

        this.onConfirm = () => resolve(true);
        this.onCancel = () => resolve(false);

        this._show(content, options);
      });
    }

    /**
     * 输入对话框
     */
    prompt(message, options = {}) {
      return new Promise((resolve) => {
        const title = options.title || '输入';
        const defaultValue = options.defaultValue || '';
        const placeholder = options.placeholder || message;
        const confirmText = options.confirmText || '确定';
        const cancelText = options.cancelText || '取消';

        const content = `
          <div class="modal-header">
            <h3 class="modal-title">${this._escapeHtml(title)}</h3>
            <button class="modal-close" type="button">&times;</button>
          </div>
          <div class="modal-body">
            <div class="modal-message">${this._escapeHtml(message)}</div>
            <input
              type="text"
              class="modal-input"
              placeholder="${this._escapeHtmlAttribute(placeholder)}"
              value="${this._escapeHtmlAttribute(defaultValue)}"
              maxlength="${options.maxLength || 200}"
            >
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary modal-cancel">${cancelText}</button>
            <button class="btn btn-primary modal-confirm">${confirmText}</button>
          </div>
        `;

        this.onConfirm = () => {
          const input = this.dialog.querySelector('.modal-input');
          resolve(input ? input.value.trim() : null);
        };
        this.onCancel = () => resolve(null);

        this._show(content, options);
      });
    }

    /**
     * HTML 转义
     */
    _escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    /**
     * 选择对话框（下拉框）
     * @param {string} message - 提示消息
     * @param {Object} options - 选项
     * @param {Array<{value:string,label:string}>} options.options - 选项列表
     * @returns {Promise<string|null>} - 选中的 value 或 null（取消）
     */
    select(message, options = {}) {
      return new Promise((resolve) => {
        const title = options.title || '选择';
        const confirmText = options.confirmText || '确定';
        const cancelText = options.cancelText || '取消';
        const opts = options.options || [];
        const defaultValue = options.defaultValue || (opts[0] ? opts[0].value : '');

        const optionsHtml = opts.map(opt =>
          `<option value="${this._escapeHtmlAttribute(opt.value)}"${opt.value === defaultValue ? ' selected' : ''}>${this._escapeHtml(opt.label)}</option>`
        ).join('');

        const content = `
          <div class="modal-header">
            <h3 class="modal-title">${this._escapeHtml(title)}</h3>
            <button class="modal-close" type="button">&times;</button>
          </div>
          <div class="modal-body">
            <div class="modal-message">${this._escapeHtml(message)}</div>
            <select class="modal-select">${optionsHtml}</select>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary modal-cancel">${cancelText}</button>
            <button class="btn btn-primary modal-confirm">${confirmText}</button>
          </div>
        `;

        this.onConfirm = () => {
          const select = this.dialog.querySelector('.modal-select');
          resolve(select ? select.value : null);
        };
        this.onCancel = () => resolve(null);

        this._show(content, options);
      });
    }

    /**
     * HTML 属性转义
     */
    _escapeHtmlAttribute(str) {
      return str
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    /**
     * 显示提示消息
     */
    static toast(message, type = 'info', duration = 2000) {
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;

      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
  }

  // 创建单例并导出到全局
  window.modal = new ModalDialog();
  window.ModalDialog = ModalDialog;

})(window);
