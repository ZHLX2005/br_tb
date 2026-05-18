/**
 * Utils - 工具函数模块
 * 提供通用的辅助函数
 */

// 默认分组颜色映射
const COLOR_MAP = {
  '#ff6b6b': 'red',
  '#4ecdc4': 'teal',
  '#45b7d1': 'blue',
  '#f9ca24': 'yellow',
  '#6c5ce7': 'purple',
  '#a29bfe': 'purple-light',
  '#fd79a8': 'pink',
  '#00b894': 'green',
  '#e17055': 'orange',
  '#74b9ff': 'sky'
};

/**
 * HTML 转义，防止 XSS
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 格式化时间显示
 * @param {string|number} timestamp - 时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;

  return date.toLocaleDateString('zh-CN');
}

/**
 * 格式化快照时间显示
 * @param {string|number} timestamp - 时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatSnapshotTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;

  // 超过7天显示完整日期时间
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute}`;
}

/**
 * 根据颜色获取 CSS 类名
 * @param {string} color - 颜色值
 * @returns {string} CSS 类名
 */
function getColorClass(color) {
  return COLOR_MAP[color] || 'blue';
}

/**
 * 导出数据为 JSON 文件
 * @param {Object} data - 要导出的数据
 * @param {string} filename - 文件名
 */
function exportData(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导入 JSON 文件
 * @param {Function} callback - 处理导入数据的回调函数
 */
function importData(callback) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await callback(data);
    } catch (error) {
      alert('导入失败：' + error.message);
    }
  };

  input.click();
}

/**
 * 生成唯一 ID
 * @returns {string} 唯一 ID
 */
function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

export {
  escapeHtml,
  formatTime,
  formatSnapshotTime,
  getColorClass,
  exportData,
  importData,
  generateId,
  COLOR_MAP
};
