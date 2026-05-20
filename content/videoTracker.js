/**
 * Video Tracker Content Script Module
 * 页面视频检测与观看进度追踪
 * 独立文件，随 content_scripts 注入到所有页面
 */

(function () {
  'use strict';

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

  const videoTracker = {
    videos: [],
    trackedVideos: new Map(), // video element -> { duration, watched, title, url }
    reportInterval: null,
    REPORT_PERIOD_MS: 5000,

    init() {
      this.findVideos();
      this.setupMutationObserver();
      this.setupUrlChangeListener();
      this.startReporting();
      console.log('[TabBoard] Video tracker initialized');
    },

    findVideos() {
      const videos = Array.from(document.querySelectorAll('video'));
      const newVideos = videos.filter(v => !this.trackedVideos.has(v));

      newVideos.forEach(video => {
        this.trackedVideos.set(video, {
          duration: 0,
          watched: 0,
          title: this.getVideoTitle(video),
          url: normalizeUrl(window.location.href),
          favicon: this.getFavicon(),
          pageTitle: document.title
        });

        this.bindVideoEvents(video);
      });

      this.videos = videos;
    },

    getVideoTitle(video) {
      const container = video.closest('figure, .video-container, [class*="video"], [class*="player"]');
      if (container) {
        const titleEl = container.querySelector('h1, h2, h3, .title, [class*="title"]');
        if (titleEl) return titleEl.textContent.trim();
      }

      if (document.title) return document.title.trim();
      if (video.getAttribute('aria-label')) return video.getAttribute('aria-label');
      if (video.title) return video.title;

      return '未命名视频';
    },

    getFavicon() {
      const link = document.querySelector('link[rel*="icon"]');
      return link ? link.href : '';
    },

    bindVideoEvents(video) {
      const onLoadedMetadata = () => {
        const info = this.trackedVideos.get(video);
        if (info) {
          const newDuration = video.duration || 0;
          // 如果 duration 显著变化，说明视频源已更换，重置 watched 避免进度溢出
          if (info.duration > 0 && newDuration > 0) {
            const diff = Math.abs(info.duration - newDuration);
            const ratio = diff / Math.max(info.duration, newDuration);
            if (diff > 5 && ratio > 0.1) {
              info.watched = 0;
              info.title = this.getVideoTitle(video);
              info.pageTitle = document.title;
            }
          }
          info.duration = newDuration;
        }
      };

      const onTimeUpdate = () => {
        const info = this.trackedVideos.get(video);
        if (info && video.duration) {
          info.watched = Math.max(info.watched, video.currentTime);
          info.duration = video.duration;
        }
      };

      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('timeupdate', onTimeUpdate);

      if (video.duration) {
        onLoadedMetadata();
      }
    },

    setupMutationObserver() {
      const observer = new MutationObserver(() => {
        this.findVideos();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },

    setupUrlChangeListener() {
      const handleUrlChange = () => {
        // URL 变化时清空旧数据，避免上报到错误的视频
        this.trackedVideos.clear();
        this.findVideos();
      };

      window.addEventListener('popstate', handleUrlChange);

      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function (...args) {
        originalPushState.apply(this, args);
        handleUrlChange();
      };

      history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        handleUrlChange();
      };
    },

    startReporting() {
      this.reportInterval = setInterval(() => {
        this.reportProgress();
      }, this.REPORT_PERIOD_MS);
    },

    reportProgress() {
      const currentUrl = normalizeUrl(window.location.href);
      this.trackedVideos.forEach((info) => {
        if (info.duration > 0) {
          chrome.runtime.sendMessage({
            action: 'updateVideoProgress',
            url: currentUrl,
            title: info.title,
            duration: info.duration,
            watched: info.watched
          }).catch(() => {
            // Extension may not be ready or page unloaded
          });
        }
      });
    },

    getDetectedVideos() {
      const currentUrl = normalizeUrl(window.location.href);
      const result = [];
      this.trackedVideos.forEach((info, video) => {
        result.push({
          title: info.title,
          url: currentUrl,
          duration: info.duration || video.duration || 0,
          watched: info.watched || 0,
          favicon: info.favicon,
          pageTitle: info.pageTitle
        });
      });
      return result;
    },

    destroy() {
      if (this.reportInterval) {
        clearInterval(this.reportInterval);
        this.reportInterval = null;
      }
    }
  };

  // 暴露到全局，供 content.js 引用
  window.__tabboardVideoTracker = videoTracker;

  // 自动初始化（如果 DOM 已就绪）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => videoTracker.init());
  } else {
    videoTracker.init();
  }
})();
