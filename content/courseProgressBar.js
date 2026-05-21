/**
 * Course Progress Bar — 课程进度条面板（连续进度条版）
 * 按视频时长比例切割，当前视频之前的默认已完成
 */

(function () {
  'use strict';

  const BAR_ID = 'tabboard-course-progress-bar';
  const TOOLTIP_ID = 'tabboard-course-progress-tooltip';
  let currentGroup = null;
  let currentVideoIndex = -1;
  let updateTimer = null;
  let isEnabled = false;

  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('bilibili.com') && u.pathname.startsWith('/video/')) {
        let path = u.pathname;
        if (path.endsWith('/')) path = path.slice(0, -1);
        return `${u.protocol}//${u.hostname}${path}`;
      }
      return url;
    } catch {
      return url;
    }
  }

  function findCurrentVideoIndex(group, currentUrl) {
    const normalized = normalizeUrl(currentUrl);
    return group.videos.findIndex(v => normalizeUrl(v.url) === normalized);
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function removeBar() {
    const bar = document.getElementById(BAR_ID);
    if (bar) bar.remove();
    const tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) tooltip.remove();
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
    currentGroup = null;
    currentVideoIndex = -1;
  }

  function showTooltip(segment, video, index, currentIdx) {
    let tooltip = document.getElementById(TOOLTIP_ID);
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = TOOLTIP_ID;
      document.body.appendChild(tooltip);
    }

    const percent = video.duration > 0 ? Math.round(((video.watched || 0) / video.duration) * 100) : 0;
    const status = index < currentIdx ? '已完成' : (index === currentIdx ? '当前' : '未开始');

    tooltip.innerHTML = `
      <div style="font-weight:600;font-size:12px;margin-bottom:3px;color:#333;">${video.title}</div>
      <div style="font-size:11px;color:#666;">第 ${index + 1} 课 · ${status}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;">${formatTime(video.watched || 0)} / ${formatTime(video.duration)} · ${percent}%</div>
    `;

    const rect = segment.getBoundingClientRect();
    tooltip.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 6px 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      pointer-events: none;
      white-space: nowrap;
      left: ${rect.left + rect.width / 2}px;
      top: ${rect.bottom + 6}px;
      transform: translateX(-50%);
    `;
    tooltip.style.display = 'block';
  }

  function hideTooltip() {
    const tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) tooltip.style.display = 'none';
  }

  function createProgressBar(group, currentIdx) {
    removeBar();

    const bar = document.createElement('div');
    bar.id = BAR_ID;

    const totalDuration = group.videos.reduce((s, v) => s + (v.duration || 0), 0);
    if (totalDuration <= 0) return bar;

    // 计算整体进度：当前视频之前的全部完成 + 当前视频的 watched / duration
    let overallWatched = 0;
    group.videos.forEach((video, i) => {
      if (i < currentIdx) {
        overallWatched += video.duration || 0;
      } else if (i === currentIdx) {
        overallWatched += video.watched || 0;
      }
    });
    const overallPercent = Math.round((overallWatched / totalDuration) * 100);

    bar.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 20px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      background: rgba(255,255,255,0.95);
      border-bottom: 1px solid #e8e8e8;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // 左侧：课程名
    const titleEl = document.createElement('div');
    titleEl.textContent = group.name;
    titleEl.style.cssText = `
      font-size: 10px;
      color: #888;
      font-weight: 500;
      white-space: nowrap;
      padding: 0 8px;
      flex-shrink: 0;
      border-right: 1px solid #eee;
      height: 100%;
      display: flex;
      align-items: center;
    `;
    bar.appendChild(titleEl);

    // 中间：连续进度条
    const trackWrap = document.createElement('div');
    trackWrap.style.cssText = `
      flex: 1;
      display: flex;
      align-items: center;
      padding: 0 8px;
      height: 100%;
      gap: 6px;
    `;

    const track = document.createElement('div');
    track.style.cssText = `
      flex: 1;
      height: 8px;
      display: flex;
      border-radius: 4px;
      overflow: hidden;
      background: linear-gradient(90deg, #42a5f5 0%, #4fc3f7 25%, #66bb6a 60%, #81c784 100%);
      cursor: pointer;
      box-shadow:
        inset 0 1px 2px rgba(0,0,0,0.06),
        0 1px 0 rgba(255,255,255,0.5);
    `;

    group.videos.forEach((video, i) => {
      const segmentDuration = video.duration || 0;
      const widthPercent = (segmentDuration / totalDuration) * 100;
      if (widthPercent <= 0) return;

      const segment = document.createElement('div');
      const isBefore = i < currentIdx;
      const isCurrent = i === currentIdx;

      // 填充比例：之前=100%，当前=watched/duration，之后=0%
      let fillPercent = 0;
      if (isBefore) fillPercent = 100;
      else if (isCurrent) fillPercent = video.duration > 0 ? ((video.watched || 0) / video.duration) * 100 : 0;

      // 默认灰色遮罩（遮住底层统一渐变）
      // 已完成/当前视频移除遮罩，露出 track 的连续渐变
      const maskColor = 'rgba(210,210,210,0.88)';
      const maskColorCurrent = 'rgba(210,210,210,0.6)';

      segment.style.cssText = `
        width: ${widthPercent}%;
        height: 100%;
        position: relative;
        transition: all 0.3s ease;
        border-right: 1px solid rgba(255,255,255,0.25);
      `;

      if (isBefore) {
        segment.style.background = 'transparent';
      } else if (isCurrent) {
        segment.style.background = 'transparent';
      } else {
        segment.style.background = maskColor;
      }

      // 如果当前视频有 watched 但未完成，内部叠加绿色填充层
      if (isCurrent && fillPercent > 0 && fillPercent < 100) {
        const fill = document.createElement('div');
        fill.style.cssText = `
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: ${fillPercent}%;
          background: rgba(102,187,106,0.85);
          transition: width 0.3s ease;
          box-shadow: 1px 0 3px rgba(102,187,106,0.25);
        `;
        segment.appendChild(fill);
      }

      // 当前视频高亮：轻微上浮 + 白色光晕
      if (isCurrent) {
        segment.style.zIndex = '2';
        segment.style.transform = 'scaleY(1.25)';
        segment.style.filter = 'brightness(1.15) drop-shadow(0 0 4px rgba(255,255,255,0.6))';
      }

      segment.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(video.url, '_blank');
      });

      segment.addEventListener('mouseenter', () => {
        segment.style.filter = 'brightness(0.9)';
        showTooltip(segment, video, i, currentIdx);
      });
      segment.addEventListener('mouseleave', () => {
        segment.style.filter = 'none';
        hideTooltip();
      });

      track.appendChild(segment);
    });

    trackWrap.appendChild(track);
    bar.appendChild(trackWrap);

    // 右侧：百分比
    const percentEl = document.createElement('div');
    percentEl.textContent = `${overallPercent}%`;
    percentEl.style.cssText = `
      font-size: 11px;
      color: #666;
      font-weight: 600;
      white-space: nowrap;
      padding: 0 8px;
      flex-shrink: 0;
      border-left: 1px solid #eee;
      height: 100%;
      display: flex;
      align-items: center;
      min-width: 36px;
      justify-content: flex-end;
    `;
    bar.appendChild(percentEl);

    return bar;
  }

  async function updateBar() {
    if (!isEnabled) return;

    try {
      const currentUrl = window.location.href;
      const response = await chrome.runtime.sendMessage({ action: 'getVideoGroups' });
      if (!response.success || !response.videoGroups) return;

      let matchedGroup = null;
      let matchedIndex = -1;

      for (const group of response.videoGroups) {
        const idx = findCurrentVideoIndex(group, currentUrl);
        if (idx !== -1) {
          matchedGroup = group;
          matchedIndex = idx;
          break;
        }
      }

      if (!matchedGroup) {
        removeBar();
        return;
      }

      if (!currentGroup || currentGroup.id !== matchedGroup.id || currentVideoIndex !== matchedIndex) {
        currentGroup = matchedGroup;
        currentVideoIndex = matchedIndex;
        const bar = createProgressBar(matchedGroup, matchedIndex);
        document.body.appendChild(bar);
      } else {
        currentGroup = matchedGroup;
        const bar = createProgressBar(matchedGroup, matchedIndex);
        const oldBar = document.getElementById(BAR_ID);
        if (oldBar) {
          oldBar.replaceWith(bar);
        } else {
          document.body.appendChild(bar);
        }
      }
    } catch (err) {
      // Extension may be disabled or page unloaded
    }
  }

  async function init() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      const settings = result.settings || {};
      isEnabled = !!settings.showCourseProgressBar;

      if (!isEnabled) return;

      await updateBar();

      if (updateTimer) clearInterval(updateTimer);
      updateTimer = setInterval(updateBar, 5000);
    } catch (err) {
      console.error('[CourseProgressBar] init failed:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.settings) {
      const newSettings = changes.settings.newValue || {};
      const newEnabled = !!newSettings.showCourseProgressBar;

      if (newEnabled !== isEnabled) {
        isEnabled = newEnabled;
        if (isEnabled) {
          init();
        } else {
          removeBar();
        }
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isEnabled) {
      updateBar();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
