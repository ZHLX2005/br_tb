/**
 * Progress Utilities — 共享进度计算
 * 采用 50% 阈值策略：
 * - 单个视频 watched/duration < 50% 时显示 0%
 * - 单个视频 watched/duration >= 50% 时显示实际百分比
 * - 课程整体进度 = 超过 50% 的视频数量 / 总视频数量
 */

/**
 * 计算单个视频的显示进度（带 50% 阈值）
 * @param {Object} video — { watched, duration }
 * @returns {number} 0-100
 */
export function getVideoDisplayProgress(video) {
  const duration = video.duration || 0;
  const watched = video.watched || 0;
  if (duration <= 0) return 0;
  const ratio = watched / duration;
  return ratio > 0.5 ? Math.round(ratio * 100) : 0;
}

/**
 * 计算课程组的整体进度（保守估计）
 * 超过 50% 的视频才算完成，进度 = 完成数 / 总数
 * @param {Object[]} videos
 * @returns {number} 0-100
 */
export function getGroupDisplayProgress(videos) {
  if (!videos || videos.length === 0) return 0;
  const completed = videos.filter(v => {
    const duration = v.duration || 0;
    const watched = v.watched || 0;
    if (duration <= 0) return false;
    return watched / duration > 0.5;
  }).length;
  return Math.round((completed / videos.length) * 100);
}

/**
 * 格式化时长
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * 计算课程组的总时长和总观看时长
 * @param {Object[]} videos
 * @returns {{duration: number, watched: number}}
 */
export function getGroupTotals(videos) {
  return videos.reduce((acc, v) => {
    acc.duration += v.duration || 0;
    acc.watched += v.watched || 0;
    return acc;
  }, { duration: 0, watched: 0 });
}
