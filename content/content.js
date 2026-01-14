/**
 * TabBoard Content Script
 * 在页面上显示操作提示
 */

// 创建提示框样式
const style = document.createElement('style');
style.textContent = `
  .tabboard-toast {
    position: fixed;
    top: 20px;
    right: 20px;
    background: white;
    border-left: 4px solid #42a5f5;
    padding: 16px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    color: #333;
    opacity: 0;
    transform: translateX(100px);
    transition: all 0.3s ease;
    pointer-events: none;
  }

  .tabboard-toast.show {
    opacity: 1;
    transform: translateX(0);
  }

  .tabboard-toast.success {
    border-left-color: #66bb6a;
  }

  .tabboard-toast.info {
    border-left-color: #42a5f5;
  }

  .tabboard-toast-icon {
    font-size: 20px;
    flex-shrink: 0;
  }

  .tabboard-toast-content {
    flex: 1;
  }

  .tabboard-toast-title {
    font-weight: 600;
    margin-bottom: 2px;
  }

  .tabboard-toast-message {
    color: #666;
    font-size: 13px;
  }

  .tabboard-toast-close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    cursor: pointer;
    color: #999;
    font-size: 16px;
    line-height: 1;
    padding: 0;
    opacity: 0.6;
    transition: opacity 0.2s;
  }

  .tabboard-toast-close:hover {
    opacity: 1;
  }
`;
document.head.appendChild(style);

// 显示提示框
function showToast(options) {
  const { type = 'success', title, message, duration = 3000 } = options;

  // 创建提示框元素
  const toast = document.createElement('div');
  toast.className = `tabboard-toast ${type}`;

  const iconMap = {
    success: '✅',
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌'
  };

  toast.innerHTML = `
    <span class="tabboard-toast-icon">${iconMap[type] || iconMap.success}</span>
    <div class="tabboard-toast-content">
      <div class="tabboard-toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="tabboard-toast-message">${escapeHtml(message)}</div>` : ''}
    </div>
    <button class="tabboard-toast-close">×</button>
  `;

  // 添加到页面
  document.body.appendChild(toast);

  // 触发动画
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // 关闭按钮事件
  const closeBtn = toast.querySelector('.tabboard-toast-close');
  closeBtn.addEventListener('click', () => {
    hideToast(toast);
  });

  // 自动隐藏
  if (duration > 0) {
    setTimeout(() => {
      hideToast(toast);
    }, duration);
  }

  return toast;
}

// 隐藏提示框
function hideToast(toast) {
  toast.classList.remove('show');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showToast') {
    showToast(request);
    sendResponse({ success: true });
  }
  return true;
});
