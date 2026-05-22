/**
 * Progress Utilities — 共享进度计算
 * 进度按实际观看比例计算，不再使用 50% 阈值
 */

/**
 * 计算单个视频的显示进度
 * @param {Object} video — { watched, duration }
 * @returns {number} 0-100
 */
export function getVideoDisplayProgress(video) {
  const duration = video.duration || 0;
  const watched = video.watched || 0;
  if (duration <= 0) return 0;
  const ratio = watched / duration;
  return Math.round(ratio * 100);
}

/**
 * 计算课程组的整体进度
 * 进度 = 总观看时长 / 总时长
 * @param {Object[]} videos
 * @returns {number} 0-100
 */
export function getGroupDisplayProgress(videos) {
  if (!videos || videos.length === 0) return 0;
  let totalDuration = 0;
  let totalWatched = 0;
  for (const v of videos) {
    const duration = v.duration || 0;
    const watched = v.watched || 0;
    if (duration > 0) {
      totalDuration += duration;
      totalWatched += watched;
    }
  }
  if (totalDuration <= 0) return 0;
  return Math.round((totalWatched / totalDuration) * 100);
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
