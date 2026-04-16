/**
 * Popup Utils Module
 * 通用的工具函数
 */

/**
 * HTML转义
 * @param {string} text - 待转义文本
 * @returns {string} 转义后的HTML安全文本
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 显示Toast提示
 * @param {HTMLElement|string} container - 容器元素或选择器
 * @param {string} message - 提示消息
 * @param {string} type - 类型: success|error|info
 * @param {number} duration - 显示时长(ms)
 */
export function showToast(container, message, type = 'info', duration = 2000) {
  const el = typeof container === 'string'
    ? document.querySelector(container)
    : container;

  if (!el) return;

  const toast = document.createElement('div');
  const typeClass = type === 'success' ? 'popup-toast-success' :
                   type === 'error' ? 'popup-toast-error' : 'popup-toast-info';
  toast.className = `popup-toast ${typeClass}`;
  toast.textContent = message;

  el.appendChild(toast);

  // 触发动画
  requestAnimationFrame(() => {
    toast.classList.add('popup-toast-exit');
  });

  setTimeout(() => {
    toast.remove();
  }, duration);
}
