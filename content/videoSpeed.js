/**
 * Video Speed Controller Content Script
 * 视频倍速控制 - 全局统一倍速，自动应用到所有视频
 *
 * 功能：
 * - 全局统一的倍速设置，所有站点所有视频共享
 * - SPA 视频源变化检测（loadedmetadata 时检测 video.src 变化）
 * - 页面切换和视频源变化时自动重新应用倍速
 */

(function () {
  'use strict';

  // 全局倍速 - 所有视频共享
  let globalSpeed = 1;
  let globalMuted = false; // 默认不静音
  const STORAGE_KEY = 'tabboard_global_video_speed';
  const MUTED_KEY = 'tabboard_global_video_muted';

  // 视频跟踪
  let trackedVideos = new Map(); // video -> { lastSrc, lastDuration }

  /**
   * 初始化
   */
  async function init() {
    await Promise.all([loadGlobalSpeed(), loadGlobalMuted()]);
    findAndAttachVideos();
    setupMutationObserver();
    console.log('[TabBoard] Video speed controller initialized, global speed:', globalSpeed, 'muted:', globalMuted);
  }

  /**
   * 加载静音状态
   */
  async function loadGlobalMuted() {
    try {
      const result = await chrome.storage.local.get([MUTED_KEY]);
      globalMuted = result[MUTED_KEY] ?? false; // 默认为 false（不静音）
    } catch (e) {
      console.warn('[VideoSpeed] Failed to load muted state:', e);
      globalMuted = false;
    }
  }

  /**
   * 保存静音状态
   */
  async function saveGlobalMuted() {
    try {
      await chrome.storage.local.set({ [MUTED_KEY]: globalMuted });
    } catch (e) {
      console.warn('[VideoSpeed] Failed to save muted state:', e);
    }
  }

  /**
   * 从 storage 加载全局倍速
   */
  async function loadGlobalSpeed() {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY]);
      globalSpeed = result[STORAGE_KEY] ?? 1;
    } catch (e) {
      console.warn('[VideoSpeed] Failed to load speed:', e);
      globalSpeed = 1;
    }
  }

  /**
   * 保存全局倍速到 storage
   */
  async function saveGlobalSpeed() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: globalSpeed });
    } catch (e) {
      console.warn('[VideoSpeed] Failed to save speed:', e);
    }
  }

  /**
   * 设置全局倍速并应用到所有视频
   */
  function setGlobalSpeed(speed) {
    globalSpeed = speed;
    saveGlobalSpeed();
    applySpeedToAllVideos(speed);
    updateAllControlPanels(speed);
    broadcastSpeedChange(speed);
    return speed;
  }

  /**
   * 获取当前全局倍速
   */
  function getGlobalSpeed() {
    return globalSpeed;
  }

  /**
   * 广播速度变化到 popup
   */
  function broadcastSpeedChange(speed) {
    window.postMessage({
      type: 'TABBOARD_VIDEO_SPEED_CHANGED',
      speed: speed
    }, '*');
  }

  /**
   * 设置全局静音并应用到所有视频
   */
  function setGlobalMuted(muted) {
    globalMuted = muted;
    saveGlobalMuted();
    applyMutedToAllVideos(muted);
    window.postMessage({
      type: 'TABBOARD_VIDEO_MUTED_CHANGED',
      muted: muted
    }, '*');
    return muted;
  }

  /**
   * 获取当前静音状态
   */
  function getGlobalMuted() {
    return globalMuted;
  }

  /**
   * 查找并为视频添加控制
   */
  function findAndAttachVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => attachControlToVideo(video));
  }

  /**
   * 为单个视频添加控制面板
   */
  function attachControlToVideo(video) {
    if (video.dataset.tabboardSpeedAttached) return;

    // 标记已处理
    video.dataset.tabboardSpeedAttached = 'true';

    // 初始应用倍速和静音状态
    video.playbackRate = globalSpeed;
    if (globalMuted) {
      video.muted = true;
    }

    // 记录初始状态
    trackedVideos.set(video, {
      lastSrc: video.src || video.currentSrc || '',
      lastDuration: video.duration || 0
    });

    // 监听 loadedmetadata - 检测视频源变化（分P切换等）
    const onLoadedMetadata = () => {
      const info = trackedVideos.get(video) || {};
      const currentSrc = video.src || video.currentSrc || '';

      // 检测视频源是否变化
      if (currentSrc && currentSrc !== info.lastSrc) {
        console.log('[VideoSpeed] Video source changed:', info.lastSrc, '->', currentSrc);
        info.lastSrc = currentSrc;
        info.lastDuration = video.duration || 0;
        trackedVideos.set(video, info);

        // 重新应用倍速
        video.playbackRate = globalSpeed;
        if (globalMuted) {
          video.muted = true;
        }
      } else {
        info.lastDuration = video.duration || 0;
        trackedVideos.set(video, info);
      }
    };

    // 监听播放 - 如果倍速被重置则恢复
    const onPlay = () => {
      if (video.playbackRate !== globalSpeed) {
        video.playbackRate = globalSpeed;
      }
      // 如果需要静音则确保静音
      if (globalMuted && !video.muted) {
        video.muted = true;
      }
    };

    // 监听 timeupdate - 检测 duration 大幅变化（视频切换）
    const onTimeUpdate = () => {
      const info = trackedVideos.get(video);
      if (info && video.duration > 0) {
        // duration 变化超过 10% 且绝对值超过 5s，判定为视频切换
        const diff = Math.abs(video.duration - info.lastDuration);
        const ratio = diff / Math.max(video.duration, info.lastDuration || 1);
        if (info.lastDuration > 0 && diff > 5 && ratio > 0.1) {
          console.log('[VideoSpeed] Video duration changed significantly, reapplying speed');
          info.lastDuration = video.duration;
          trackedVideos.set(video, info);
          video.playbackRate = globalSpeed;
        }
      }
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', onTimeUpdate);

    // 立即尝试应用（视频可能已加载）
    if (video.readyState >= 1) {
      video.playbackRate = globalSpeed;
    }
  }

  /**
   * 应用倍速到所有视频
   */
  function applySpeedToAllVideos(speed) {
    document.querySelectorAll('video').forEach(video => {
      video.playbackRate = speed;
    });
  }

  /**
   * 应用静音到所有视频
   */
  function applyMutedToAllVideos(muted) {
    document.querySelectorAll('video').forEach(video => {
      video.muted = muted;
    });
  }

  /**
   * 查找视频的容器元素
   */
  function findVideoContainer(video) {
    let el = video.parentElement;
    let depth = 0;
    while (el && depth < 5) {
      const style = window.getComputedStyle(el);
      if (style.position === 'relative' || style.position === 'absolute' ||
          el.classList.contains('video') || el.classList.contains('player') ||
          el.classList.contains('播放器') || el.id?.includes('player')) {
        return el;
      }
      el = el.parentElement;
      depth++;
    }
    return video.parentElement;
  }

  /**
   * 创建速度控制面板
   */
  function createSpeedControlPanel() {
    const panel = document.createElement('div');
    panel.className = 'tabboard-speed-control';

    // 当前速度显示
    const display = document.createElement('div');
    display.className = 'tabboard-speed-display';
    display.textContent = '1x';
    display.title = '点击展开速度选项';
    display.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSpeedMenu(panel);
    });

    // 速度菜单
    const menu = document.createElement('div');
    menu.className = 'tabboard-speed-menu';
    menu.style.display = 'none';

    const presets = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    presets.forEach(speed => {
      const item = document.createElement('button');
      item.className = 'tabboard-speed-item';
      item.textContent = speed === 1 ? '正常' : `${speed}x`;
      item.dataset.speed = speed;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectSpeed(speed, panel);
      });
      menu.appendChild(item);
    });

    // 减速/加速按钮
    const controls = document.createElement('div');
    controls.className = 'tabboard-speed-controls';

    const slowBtn = document.createElement('button');
    slowBtn.className = 'tabboard-speed-btn';
    slowBtn.textContent = '−';
    slowBtn.title = '减速';
    slowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      adjustSpeed(-0.25, panel);
    });

    const fastBtn = document.createElement('button');
    fastBtn.className = 'tabboard-speed-btn';
    fastBtn.textContent = '+';
    fastBtn.title = '加速';
    fastBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      adjustSpeed(0.25, panel);
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'tabboard-speed-btn tabboard-speed-reset';
    resetBtn.textContent = '⟲';
    resetBtn.title = '恢复默认 (1x)';
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectSpeed(1, panel);
    });

    controls.appendChild(slowBtn);
    controls.appendChild(resetBtn);
    controls.appendChild(fastBtn);

    panel.appendChild(display);
    panel.appendChild(controls);
    panel.appendChild(menu);

    // 点击外部关闭菜单
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target)) {
        menu.style.display = 'none';
      }
    });

    return panel;
  }

  /**
   * 切换速度菜单显示
   */
  function toggleSpeedMenu(panel) {
    const menu = panel.querySelector('.tabboard-speed-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }

  /**
   * 选择速度
   */
  function selectSpeed(speed, panel) {
    setGlobalSpeed(speed);
    updateControlDisplay(panel, speed);
    const menu = panel.querySelector('.tabboard-speed-menu');
    menu.style.display = 'none';
  }

  /**
   * 调整速度
   */
  function adjustSpeed(delta, panel) {
    let newSpeed = globalSpeed + delta;
    newSpeed = Math.max(0.25, Math.min(5, newSpeed));
    newSpeed = Math.round(newSpeed * 4) / 4;
    selectSpeed(newSpeed, panel);
  }

  /**
   * 更新控制面板显示
   */
  function updateControlDisplay(panel, speed) {
    const display = panel.querySelector('.tabboard-speed-display');
    display.textContent = speed === 1 ? '1x' : `${speed}x`;

    const items = panel.querySelectorAll('.tabboard-speed-item');
    items.forEach(item => {
      item.classList.toggle('active', parseFloat(item.dataset.speed) === speed);
    });
  }

  /**
   * 更新单个视频的控制面板
   */
  function updateControlPanelsForVideo(video, speed) {
    const container = findVideoContainer(video);
    const panels = container.querySelectorAll('.tabboard-speed-control');
    panels.forEach(panel => updateControlDisplay(panel, speed));
  }

  /**
   * 更新所有控制面板
   */
  function updateAllControlPanels(speed) {
    document.querySelectorAll('.tabboard-speed-control').forEach(panel => {
      updateControlDisplay(panel, speed);
    });
  }

  /**
   * 设置 MutationObserver 监听视频新增
   */
  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'VIDEO') {
              attachControlToVideo(node);
            }
            node.querySelectorAll?.('video').forEach(video => {
              attachControlToVideo(video);
            });
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * 为视频注入控制面板
   */
  function injectControlToVideo(video) {
    if (video.dataset.tabboardControlInjected) return;
    video.dataset.tabboardControlInjected = 'true';

    const container = findVideoContainer(video);
    const panel = createSpeedControlPanel();

    if (container) {
      container.style.position = 'relative';
      container.appendChild(panel);
    }
  }

  // 注入样式
  function injectStyles() {
    if (document.getElementById('tabboard-speed-styles')) return;

    const style = document.createElement('style');
    style.id = 'tabboard-speed-styles';
    style.textContent = `
      .tabboard-speed-control {
        position: absolute;
        bottom: 10px;
        right: 10px;
        display: flex;
        align-items: center;
        gap: 4px;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .tabboard-speed-display {
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
        user-select: none;
      }

      .tabboard-speed-display:hover {
        background: rgba(0, 0, 0, 0.85);
      }

      .tabboard-speed-controls {
        display: flex;
        gap: 2px;
      }

      .tabboard-speed-btn {
        background: rgba(0, 0, 0, 0.6);
        color: white;
        border: none;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }

      .tabboard-speed-btn:hover {
        background: rgba(0, 0, 0, 0.85);
      }

      .tabboard-speed-reset {
        font-size: 12px;
      }

      .tabboard-speed-menu {
        position: absolute;
        bottom: 100%;
        right: 0;
        background: rgba(30, 30, 30, 0.95);
        border-radius: 6px;
        padding: 4px;
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        min-width: 150px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .tabboard-speed-item {
        background: transparent;
        color: white;
        border: none;
        padding: 6px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
        flex: 1;
        text-align: center;
      }

      .tabboard-speed-item:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      .tabboard-speed-item.active {
        background: #42a5f5;
        color: white;
      }
    `;

    document.head.appendChild(style);
  }

  // 监听来自 popup 的消息
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'TABBOARD_SET_VIDEO_SPEED') {
      setGlobalSpeed(event.data.speed);
    }

    if (event.data.type === 'TABBOARD_SET_VIDEO_MUTED') {
      setGlobalMuted(event.data.muted);
    }

    if (event.data.type === 'TABBOARD_GET_VIDEO_SPEED') {
      event.source.postMessage({
        type: 'TABBOARD_VIDEO_SPEED',
        speed: globalSpeed
      }, event.origin);
    }
  });

  // 监听来自扩展的消息
  chrome.runtime?.onMessage?.addListener((request, sender, sendResponse) => {
    if (request.action === 'getVideoSpeed') {
      sendResponse({ success: true, speed: globalSpeed });
      return true;
    }

    if (request.action === 'setVideoSpeed') {
      const speed = setGlobalSpeed(request.speed);
      sendResponse({ success: true, speed });
      return true;
    }

    if (request.action === 'setVideoMuted') {
      const muted = setGlobalMuted(request.muted);
      sendResponse({ success: true, muted });
      return true;
    }
  });

  // 暴露到全局
  window.__tabboardVideoSpeed = {
    setSpeed: setGlobalSpeed,
    getSpeed: getGlobalSpeed,
    setMuted: setGlobalMuted,
    getMuted: getGlobalMuted
  };

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
    });
  } else {
    init();
  }
})();
