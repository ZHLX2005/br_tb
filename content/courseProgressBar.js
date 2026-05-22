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
  let showOnUnrelatedTabs = false;

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

  function hideBar() {
    const bar = document.getElementById(BAR_ID);
    if (bar) bar.remove();
    const tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) tooltip.remove();
    currentGroup = null;
    currentVideoIndex = -1;
  }

  async function showTooltip(segment, groupId, videoIndex, currentIdx) {
    let tooltip = document.getElementById(TOOLTIP_ID);
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = TOOLTIP_ID;
      document.body.appendChild(tooltip);
    }

    let video = { title: '未命名视频', duration: 0, watched: 0 };
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getVideoGroups' });
      if (response.success && response.videoGroups) {
        const group = response.videoGroups.find(g => g.id === groupId);
        if (group && group.videos[videoIndex]) {
          video = group.videos[videoIndex];
        }
      }
    } catch {
      // Extension 可能未启用
    }

    const percent = getVideoDisplayProgress(video);
    let status;
    if (currentIdx === -1) {
      status = (video.duration > 0 && (video.watched || 0) / video.duration > 0.5) ? '已完成' : '未开始';
    } else {
      status = videoIndex < currentIdx ? '已完成' : (videoIndex === currentIdx ? '当前' : '未开始');
    }

    tooltip.innerHTML = `
      <div style="font-weight:600;font-size:12px;margin-bottom:3px;color:#333;">${video.title}</div>
      <div style="font-size:11px;color:#666;">第 ${videoIndex + 1} 课 · ${status}</div>
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

  function getVideoDisplayProgress(video) {
    const duration = video.duration || 0;
    const watched = video.watched || 0;
    if (duration <= 0) return 0;
    const ratio = watched / duration;
    return ratio > 0.5 ? Math.round(ratio * 100) : 0;
  }

  function getGroupDisplayProgress(videos) {
    if (!videos || videos.length === 0) return 0;
    const completed = videos.filter(v => {
      const duration = v.duration || 0;
      const watched = v.watched || 0;
      if (duration <= 0) return false;
      return watched / duration > 0.5;
    }).length;
    return Math.round((completed / videos.length) * 100);
  }

  function createProgressBar(group, currentIdx) {
    const bar = document.createElement('div');
    bar.id = BAR_ID;

    const totalDuration = group.videos.reduce((s, v) => s + (v.duration || 0), 0);
    if (totalDuration <= 0) return bar;

    const overallPercent = getGroupDisplayProgress(group.videos);
    const hasCurrentVideo = currentIdx >= 0;

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

      // 已完成判断：有当前视频时按位置；无当前视频时按50%阈值
      const isCompleted = hasCurrentVideo
        ? (i < currentIdx)
        : (video.duration > 0 && (video.watched || 0) / video.duration > 0.5);
      const isCurrent = hasCurrentVideo && i === currentIdx;

      let fillPercent = 0;
      if (isCurrent) fillPercent = video.duration > 0 ? ((video.watched || 0) / video.duration) * 100 : 0;

      segment.style.cssText = `
        width: ${widthPercent}%;
        height: 100%;
        position: relative;
        transition: all 0.3s ease;
        border-right: 1px solid rgba(255,255,255,0.25);
      `;

      if (isCompleted || isCurrent) {
        segment.style.background = 'transparent';
      } else {
        segment.style.background = 'rgba(210,210,210,0.88)';
      }

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

      if (isCurrent) {
        segment.style.zIndex = '2';
        segment.style.transform = 'scaleY(1.25)';
        segment.style.filter = 'brightness(1.15) drop-shadow(0 0 4px rgba(255,255,255,0.6))';
      }

      segment.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(video.url, '_blank');
      });

      const defaultFilter = isCurrent
        ? 'brightness(1.15) drop-shadow(0 0 4px rgba(255,255,255,0.6))'
        : '';

      segment.addEventListener('mouseenter', () => {
        segment.style.filter = 'brightness(0.9)';
        showTooltip(segment, group.id, i, currentIdx);
      });
      segment.addEventListener('mouseleave', () => {
        segment.style.filter = defaultFilter;
        hideTooltip();
      });

      track.appendChild(segment);
    });

    trackWrap.appendChild(track);
    bar.appendChild(trackWrap);

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
      const response = await chrome.runtime.sendMessage({
        action: 'getCurrentVideoGroup',
        url: window.location.href
      });

      if (response.success && response.group) {
        // 当前页是课程视频，正常显示
        currentGroup = response.group;
        currentVideoIndex = response.currentIndex;

        const bar = createProgressBar(response.group, response.currentIndex);
        const oldBar = document.getElementById(BAR_ID);
        if (oldBar) {
          oldBar.replaceWith(bar);
        } else {
          document.body.appendChild(bar);
        }
        return;
      }

      // 当前页是无关 tab
      if (!showOnUnrelatedTabs) {
        hideBar();
        return;
      }

      // 获取第一个有视频的课程组来显示
      const groupsRes = await chrome.runtime.sendMessage({ action: 'getVideoGroups' });
      if (groupsRes.success && groupsRes.videoGroups) {
        const group = groupsRes.videoGroups.find(g => g.videos && g.videos.length > 0);
        if (group) {
          currentGroup = group;
          currentVideoIndex = -1;

          const bar = createProgressBar(group, -1);
          const oldBar = document.getElementById(BAR_ID);
          if (oldBar) {
            oldBar.replaceWith(bar);
          } else {
            document.body.appendChild(bar);
          }
          return;
        }
      }

      hideBar();
    } catch (err) {
      // Extension may be disabled or page unloaded
    }
  }

  // SPA 路由变化监听
  let urlListenerSetup = false;

  function setupUrlChangeListener() {
    if (urlListenerSetup) return;
    urlListenerSetup = true;

    let lastUrl = location.href;

    const checkUrlChange = () => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        if (isEnabled) updateBar();
      }
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      checkUrlChange();
    };
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      checkUrlChange();
    };

    window.addEventListener('popstate', checkUrlChange);
  }

  async function init() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      const settings = result.settings || {};
      isEnabled = !!settings.showCourseProgressBar;
      showOnUnrelatedTabs = !!settings.showCourseProgressBarOnUnrelatedTabs;

      if (!isEnabled) return;

      await updateBar();

      if (updateTimer) clearInterval(updateTimer);
      updateTimer = setInterval(updateBar, 5000);

      setupUrlChangeListener();
    } catch (err) {
      console.error('[CourseProgressBar] init failed:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.settings) {
      const newSettings = changes.settings.newValue || {};
      const newEnabled = !!newSettings.showCourseProgressBar;
      const newShowUnrelated = !!newSettings.showCourseProgressBarOnUnrelatedTabs;

      let needUpdate = false;
      if (newEnabled !== isEnabled) {
        isEnabled = newEnabled;
        if (isEnabled) {
          init();
        } else {
          removeBar();
        }
      } else if (newShowUnrelated !== showOnUnrelatedTabs) {
        showOnUnrelatedTabs = newShowUnrelated;
        needUpdate = true;
      }

      if (needUpdate && isEnabled) {
        updateBar();
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
