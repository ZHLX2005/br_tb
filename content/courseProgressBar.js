/**
 * Course Progress Bar — 课程进度条面板（连续进度条版）
 * 按视频时长比例切割，当前视频之前的默认已完成
 */

(function () {
  'use strict';

  const CONTAINER_ID = 'tabboard-course-progress-container';
  const TOOLTIP_ID = 'tabboard-course-progress-tooltip';
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

  function removeBars() {
    const container = document.getElementById(CONTAINER_ID);
    if (container) container.remove();
    const tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) tooltip.remove();
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
  }

  function hideBars() {
    const container = document.getElementById(CONTAINER_ID);
    if (container) container.remove();
    const tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) tooltip.remove();
  }

  function ensureContainer() {
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = CONTAINER_ID;
      container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
      `;
      document.body.appendChild(container);
    }
    return container;
  }

  let showTooltipSeq = 0;

  async function showTooltip(segment, groupId, videoIndex, currentIdx) {
    const mySeq = ++showTooltipSeq;
    let tooltip = document.getElementById(TOOLTIP_ID);
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = TOOLTIP_ID;
      document.body.appendChild(tooltip);
    }

    let video = { title: '未命名视频', duration: 0, watched: 0 };
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getVideoGroups' });
      // await 后检查：若已有更新的悬停请求，丢弃本次过期结果
      if (mySeq !== showTooltipSeq) return;
      if (response.success && response.videoGroups) {
        const group = response.videoGroups.find(g => g.id === groupId);
        if (group && group.videos[videoIndex]) {
          video = group.videos[videoIndex];
        }
      }
    } catch {
      // Extension 可能未启用
    }

    // 写 DOM 前再次检查，防止鼠标在 await 期间已移出整个进度条
    if (mySeq !== showTooltipSeq) return;

    const duration = video.duration || 0;
    const watched = video.watched || 0;
    let status;
    let percent;

    if (currentIdx >= 0) {
      // === 分支 A：课程视频内部 —— 按位置判断 ===
      if (videoIndex < currentIdx) {
        status = '已完成';
        percent = duration > 0 ? Math.round((watched / duration) * 100) : 0;
      } else if (videoIndex === currentIdx) {
        status = '当前';
        percent = duration > 0 ? Math.round((watched / duration) * 100) : 0;
      } else {
        status = '未开始';
        percent = 0;
      }
    } else {
      // === 分支 B：无关页面 —— 按 50% 阈值判断 ===
      const ratio = duration > 0 ? watched / duration : 0;
      status = ratio > 0.5 ? '已完成' : '未开始';
      percent = duration > 0 ? Math.round((watched / duration) * 100) : 0;
    }

    tooltip.innerHTML = `
      <div style="font-weight:600;font-size:12px;margin-bottom:3px;color:#333;">${video.title}</div>
      <div style="font-size:11px;color:#666;">第 ${videoIndex + 1} 课 · ${status}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;">${formatTime(watched)} / ${formatTime(duration)} · ${percent}%</div>
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
    showTooltipSeq++; // 使进行中的 showTooltip 完成时认为已过期，不再把 tooltip 写回 block
    const tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) tooltip.style.display = 'none';
  }

  function showCourseTooltip(target, name, percent) {
    let tooltip = document.getElementById(TOOLTIP_ID);
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = TOOLTIP_ID;
      document.body.appendChild(tooltip);
    }

    tooltip.innerHTML = `
      <div style="font-weight:600;font-size:12px;margin-bottom:3px;color:#333;">${name}</div>
      <div style="font-size:11px;color:#666;">总进度 · ${percent}%</div>
    `;

    const rect = target.getBoundingClientRect();
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
      top: ${rect.bottom + 6}px;
      left: 0px;
      transform: none;
      display: block;
    `;

    const tooltipWidth = tooltip.offsetWidth;
    const targetX = rect.left + rect.width * 0.25;
    let left = targetX;

    if (left < 8) left = 8;
    if (left + tooltipWidth > window.innerWidth - 8) {
      left = window.innerWidth - tooltipWidth - 8;
      if (left < 8) left = 8;
    }

    tooltip.style.left = `${left}px`;
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
    bar.id = `tabboard-course-progress-bar-${group.id}`;

    const totalDuration = group.videos.reduce((s, v) => s + (v.duration || 0), 0);
    if (totalDuration <= 0) return bar;

    const hasCurrentVideo = currentIdx >= 0;
    const overallPercent = hasCurrentVideo
      ? Math.round(
          (group.videos.slice(0, currentIdx).reduce((s, v) => s + (v.duration || 0), 0) +
            (group.videos[currentIdx]?.watched || 0)) /
            totalDuration *
            100
        )
      : getGroupDisplayProgress(group.videos);

    bar.style.cssText = `
      height: 8px;
      display: flex;
      align-items: center;
      background: rgba(255,255,255,0.9);
      opacity: 0.9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const pillEl = document.createElement('div');
    pillEl.style.cssText = `
      width: 20px;
      height: 8px;
      border-radius: 999px;
      background: #66bb6a;
      flex-shrink: 0;
      cursor: pointer;
    `;
    pillEl.addEventListener('mouseenter', () => {
      showCourseTooltip(track, group.name, overallPercent);
    });
    pillEl.addEventListener('mouseleave', hideTooltip);
    bar.appendChild(pillEl);

    const trackWrap = document.createElement('div');
    trackWrap.style.cssText = `
      flex: 1;
      display: flex;
      align-items: center;
      height: 100%;
      padding-left: 6px;
    `;

    const track = document.createElement('div');
    track.style.cssText = `
      flex: 1;
      height: 8px;
      display: flex;
      border-radius: 999px;
      overflow: hidden;
      background: linear-gradient(90deg, #42a5f5 0%, #4fc3f7 25%, #66bb6a 60%, #81c784 100%);
      cursor: pointer;
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
      }

      segment.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(video.url, '_blank');
      });

      segment.addEventListener('mouseenter', () => {
        segment.style.filter = 'brightness(0.9)';
        showTooltip(segment, group.id, i, currentIdx);
      });
      segment.addEventListener('mouseleave', () => {
        segment.style.filter = '';
        hideTooltip();
      });

      track.appendChild(segment);
    });
    trackWrap.appendChild(track);
    bar.appendChild(trackWrap);

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
        // 当前页是课程视频，只显示当前课程
        const container = ensureContainer();
        container.innerHTML = '';
        const bar = createProgressBar(response.group, response.currentIndex);
        container.appendChild(bar);
        return;
      }

      // 当前页是无关 tab
      if (!showOnUnrelatedTabs) {
        hideBars();
        return;
      }

      // 显示所有课程
      const groupsRes = await chrome.runtime.sendMessage({ action: 'getVideoGroups' });
      if (groupsRes.success && groupsRes.videoGroups) {
        const groupsWithVideos = groupsRes.videoGroups.filter(g => !g.archived && g.videos && g.videos.length > 0);
        if (groupsWithVideos.length > 0) {
          const container = ensureContainer();
          container.innerHTML = '';
          groupsWithVideos.forEach(group => {
            const bar = createProgressBar(group, -1);
            container.appendChild(bar);
          });
          return;
        }
      }

      hideBars();
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
          removeBars();
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

  // === tooltip 防卡住兜底 ===
  // 原因：segment 的 mouseleave 只在鼠标跨越其边界时触发。当鼠标从浏览器窗口外
  // 进入（或窗口失焦后回来）时，segment 的 mouseleave 不触发，tooltip 一直显示。
  // 这里监听视口级事件作为兜底：鼠标离开视口或窗口失焦时强制隐藏 tooltip。
  document.documentElement.addEventListener('mouseleave', hideTooltip);
  window.addEventListener('blur', hideTooltip);
  document.addEventListener('dragend', hideTooltip);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
   init();
  }
})();
