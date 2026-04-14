/**
 * TabBoard Content Script
 * 内容脚本：随页面注入，提供页面内提示和访问统计功能
 *
 * @module ContentScript
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  模块映射                                                     │
 * ├─────────────────────────────────────────────────────────────┤
 * │  SECTION 1: Toast Notification (第 6-198 行)                │
 * │    功能: 页面内浮动提示框，类似浏览器通知                       │
 * │    样式: 内联 <style> 注入到 document.head                     │
 * │    函数: showToast(), hideToast()                            │
 * │    触发: background/index.js 通过 chrome.runtime.sendMessage   │
 * │          -> { action: 'showToast', title, message, type }    │
 * │                                                             │
 * │  SECTION 2: Page Visit Tracking (第 216-247 行)              │
 * │    功能: 记录用户访问页面的次数                               │
 * │    函数: trackPageVisit()                                   │
 * │    触发: 页面加载时自动执行                                   │
 * │    消息: background/index.js <- { action: 'incrementVisitCount', url } │
 * │    排除: chrome://, chrome-extension://, edge://, about:blank  │
 * └─────────────────────────────────────────────────────────────┘
 */

// ============================================================
// SECTION 1: Toast Notification Module
// ============================================================

/**
 * Toast 提示框样式
 * 内联注入到页面 document.head，不影响主页面样式表
 */
const TOAST_STYLES = `
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
    align-items: flex-start;
    gap: 12px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    color: #333;
    opacity: 0;
    transform: translateX(100px);
    transition: all 0.3s ease;
    pointer-events: none;
    min-width: 280px;
  }
  .tabboard-toast.show {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }
  .tabboard-toast.success { border-left-color: #66bb6a; }
  .tabboard-toast.info    { border-left-color: #42a5f5; }
  .tabboard-toast.warning { border-left-color: #f9ca24; }
  .tabboard-toast.error  { border-left-color: #ef5350; }
  .tabboard-toast-icon {
    font-size: 20px;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .tabboard-toast-content { flex: 1; }
  .tabboard-toast-title {
    font-weight: 600;
    margin-bottom: 2px;
  }
  .tabboard-toast-message {
    color: #666;
    font-size: 13px;
  }
  .tabboard-toast-actions {
    margin-top: 10px;
    display: flex;
    gap: 8px;
  }
  .tabboard-toast-btn {
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    background: #42a5f5;
    color: white;
  }
  .tabboard-toast-btn:hover { background: #1976d2; }
  .tabboard-toast-btn-secondary {
    background: #f0f0f0;
    color: #666;
  }
  .tabboard-toast-btn-secondary:hover { background: #e0e0e0; }
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
  .tabboard-toast-close:hover { opacity: 1; }
`;

/**
 * 注入 Toast 样式到页面
 * @description 仅注入一次，多次调用无副作用
 */
function injectToastStyles() {
  if (document.getElementById('tabboard-toast-styles')) return;
  const style = document.createElement('style');
  style.id = 'tabboard-toast-styles';
  style.textContent = TOAST_STYLES;
  document.head.appendChild(style);
}

/**
 * 显示 Toast 提示框
 * @param {Object} options - 配置项
 * @param {string} [options.type='success'] - 类型: success|info|warning|error
 * @param {string} options.title - 标题
 * @param {string} [options.message] - 描述信息
 * @param {number} [options.duration=3000] - 自动关闭时间(ms)，0=不自动关闭
 * @param {boolean} [options.showOpenButton=false] - 是否显示"打开看板"按钮
 * @returns {HTMLElement} toast 元素
 */
function showToast(options) {
  const {
    type = 'success',
    title,
    message,
    duration = 3000,
    showOpenButton = false
  } = options;

  const iconMap = {
    success: '✅',
    info:    'ℹ️',
    warning: '⚠️',
    error:   '❌'
  };

  const actionsHtml = showOpenButton
    ? `<div class="tabboard-toast-actions">
         <button class="tabboard-toast-btn" id="openTabboardBtn">打开看板</button>
       </div>`
    : '';

  const toast = document.createElement('div');
  toast.className = `tabboard-toast ${type}`;
  toast.innerHTML = `
    <span class="tabboard-toast-icon">${iconMap[type] || iconMap.success}</span>
    <div class="tabboard-toast-content">
      <div class="tabboard-toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="tabboard-toast-message">${escapeHtml(message)}</div>` : ''}
      ${actionsHtml}
    </div>
    <button class="tabboard-toast-close">×</button>
  `;

  document.body.appendChild(toast);

  // 触发动画 (requestAnimationFrame 保证在下一帧应用 CSS transition)
  requestAnimationFrame(() => toast.classList.add('show'));

  // 关闭按钮
  toast.querySelector('.tabboard-toast-close')
    .addEventListener('click', () => hideToast(toast));

  // "打开看板"按钮 -> 发送消息给 background
  if (showOpenButton) {
    toast.querySelector('#openTabboardBtn')
      .addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openTabboard' });
        hideToast(toast);
      });
  }

  // 自动隐藏
  if (duration > 0) {
    const actualDuration = showOpenButton ? duration * 2 : duration;
    setTimeout(() => hideToast(toast), actualDuration);
  }

  return toast;
}

/**
 * 隐藏 Toast 提示框
 * @param {HTMLElement} toast - showToast 返回的元素
 */
function hideToast(toast) {
  toast.classList.remove('show');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300); // 等待 CSS transition 完成
}

/**
 * HTML 转义，防止 XSS
 * @param {string} text - 原始文本
 * @returns {string} 转义后的 HTML 安全文本
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 初始化: 注入样式
injectToastStyles();

// ============================================================
// SECTION 2: Page Visit Tracking Module
// ============================================================

/**
 * 排除的协议列表
 * 这些特殊页面不参与访问统计
 */
const EXCLUDED_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:'
];

/**
 * 检查当前页面是否应被排除
 * @returns {boolean} true = 排除，不统计
 */
function shouldExcludePage() {
  if (EXCLUDED_PROTOCOLS.some(p => window.location.protocol === p)) {
    return true;
  }
  if (window.location.href === 'about:blank') {
    return true;
  }
  return false;
}

/**
 * 跟踪页面访问
 * @description 页面加载时调用，增加当前 URL 的 visitCount
 *                由 background/groups.js 中的 incrementVisitCount 处理
 */
function trackPageVisit() {
  if (shouldExcludePage()) {
    return;
  }

  chrome.runtime.sendMessage({
    action: 'incrementVisitCount',
    url: window.location.href
  }, (response) => {
    // 静默处理 background 未就绪的情况
    if (chrome.runtime.lastError) {
      // chrome.runtime.lastError: "Extension context invalidated" 等
    }
  });
}

// ============================================================
// SECTION 3: Message Listener (Bridge to Background)
// ============================================================

/**
 * 消息监听器：接收来自 background/index.js 的指令
 *
 * 消息格式:
 *   { action: 'showToast', type, title, message, duration, showOpenButton }
 *
 * @param {Object} request - 消息内容
 * @param {Object} sender  - 发送者信息 (unused)
 * @param {Function} sendResponse - 回调函数
 * @returns {boolean} true = 异步响应
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showToast') {
    showToast({
      type:           request.type,
      title:          request.title,
      message:        request.message,
      duration:       request.duration,
      showOpenButton: request.showOpenButton
    });
    sendResponse({ success: true });
  }
  return true; // 保持消息通道开放以支持异步响应
});

// ============================================================
// SECTION 4: Initialization
// ============================================================

/**
 * 页面访问统计初始化
 * 兼容 document.readyState 不同状态
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', trackPageVisit);
} else {
  trackPageVisit();
}
