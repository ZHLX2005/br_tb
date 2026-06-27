/**
 * Timer Sidebar — 计时器圆环
 * 悬浮右侧边缘，hover 近场浮现，点击展开计时面板
 * 支持开始/停止计时，实时显示已用时间，记录时间日志
 * Shadow DOM 隔离宿主 CSS
 */

(function () {
  'use strict';

  const WRAPPER_ID = 'tabboard-timer-sidebar';
  const ACCENT = '#42a5f5';

  // ========== 状态 ==========

  let timerState = { isRunning: false, startTime: null, elapsed: 0 };
  let tickInterval = null;

  // ========== 样式 ==========

  const STYLES = `
    :host {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --accent: ${ACCENT};
    }
    #${WRAPPER_ID}-trigger {
      width: 40px; height: 40px; border-radius: 50%; background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      position: fixed; top: calc(50% + 104px); right: -16px;
      transform: translateY(-50%); opacity: 0; pointer-events: none;
      transition: right 220ms ease, opacity 180ms ease, box-shadow 200ms;
      border: 1px solid rgba(0,0,0,0.06);
    }
    :host(.near) #${WRAPPER_ID}-trigger,
    #${WRAPPER_ID}-trigger:hover {
      right: 8px; opacity: 1; pointer-events: auto;
    }
    #${WRAPPER_ID}-trigger:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.22); }

    #${WRAPPER_ID}-panel {
      position: fixed; top: calc(50% + 104px); right: 8px;
      transform: translate(10px, -50%); width: 220px;
      background: white; border-radius: 10px;
      box-shadow: -2px 4px 20px rgba(0,0,0,0.18);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s linear 240ms;
    }
    :host(.expanded) #${WRAPPER_ID}-panel {
      opacity: 1; visibility: visible; pointer-events: auto;
      transform: translate(-56px, -50%);
      transition: transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms linear, visibility 0s;
    }

    #timer-header {
      padding: 10px 14px; border-bottom: 1px solid #eee;
      display: flex; align-items: center; justify-content: space-between;
    }
    #timer-title { font-size: 12px; font-weight: 600; color: #333; }
    .timer-close-btn {
      background: transparent; border: none; color: #999; font-size: 16px;
      line-height: 1; width: 22px; height: 22px; border-radius: 4px;
      cursor: pointer; padding: 0; font-family: inherit;
    }
    .timer-close-btn:hover { background: #f0f0f0; color: #e53935; }

    #timer-body { padding: 12px 14px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    #timer-display {
      font-size: 36px; font-weight: 700; color: #222;
      font-variant-numeric: tabular-nums;
      letter-spacing: 1px; line-height: 1.2;
    }
    #timer-display.idle { color: #aaa; }
    #timer-display.running { color: #e53935; }
    #timer-display.stopped { color: #43a047; }

    #timer-btn {
      width: 48px; height: 48px; border-radius: 50%; border: none;
      background: var(--accent); color: white; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: background 180ms, transform 120ms;
      display: flex; align-items: center; justify-content: center;
      font-family: inherit; line-height: 1;
    }
    #timer-btn:hover { transform: scale(1.06); }
    #timer-btn:active { transform: scale(0.94); }
    #timer-btn.running { background: #e53935; }
    #timer-btn.running::after { content: '\\25A0'; }
    #timer-btn.stopped,
    #timer-btn.idle { background: #43a047; }
    #timer-btn.idle::after { content: '\\25B6'; }
    #timer-btn.stopped::after { content: '\\25B6'; }

    #timer-state-label {
      font-size: 10px; color: #999; text-align: center; margin-top: 2px;
    }
    #timer-last-session {
      font-size: 9px; color: #bbb; text-align: center; margin-top: -2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
    }
  `;

  // ========== 构建 DOM ==========

  function build() {
    if (document.getElementById(WRAPPER_ID)) return;

    const wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    const shadow = wrapper.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    // Trigger
    const trigger = document.createElement('div');
    trigger.id = WRAPPER_ID + '-trigger';
    trigger.title = '计时器';
    trigger.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 20 20" fill="none">' +
      '<circle cx="10" cy="10" r="7.5" stroke="' + ACCENT + '" stroke-width="1.5" fill="none"/>' +
      '<path d="M10 5v5l4 2" stroke="' + ACCENT + '" stroke-width="1.5" stroke-linecap="round"/>' +
      '</svg>';
    shadow.appendChild(trigger);
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      wrapper.classList.toggle('expanded');
      if (wrapper.classList.contains('expanded')) {
        refreshDisplay();
      }
    });

    // 共享近场浮现
    if (!window.__tabboardSideReveal) {
      window.__tabboardSideReveal = true;
      document.addEventListener('mousemove', function (e) {
        var near = e.clientX > window.innerWidth - 40;
        document.body.classList.toggle('tabboard-side-near', near);
        document.querySelectorAll('[id$="-sidebar"]:not([id$="-panel"]):not([id$="-trigger"])').forEach(function (host) {
          host.classList.toggle('near', near);
        });
      });
    }

    // Panel
    var panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';
    panel.innerHTML =
      '<div id="timer-header">' +
      '<span id="timer-title">时间日志</span>' +
      '<button class="timer-close-btn" id="timer-close-btn">×</button>' +
      '</div>' +
      '<div id="timer-body">' +
      '<div id="timer-display" class="idle">00:00</div>' +
      '<button id="timer-btn" class="idle"></button>' +
      '<div id="timer-state-label">点击开始计时</div>' +
      '<div id="timer-last-session"></div>' +
      '</div>';
    shadow.appendChild(panel);

    // 点击外部收起
    var onDocClick = function (e) {
      if (!wrapper.classList.contains('expanded')) return;
      if (wrapper.contains(e.target)) return;
      wrapper.classList.remove('expanded');
    };
    setTimeout(function () { document.addEventListener('click', onDocClick); }, 0);

    // 关闭按钮
    var closeBtn = shadow.getElementById('timer-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        wrapper.classList.remove('expanded');
      });
    }

    // 计时按钮
    var timerBtn = shadow.getElementById('timer-btn');
    if (timerBtn) {
      timerBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleTimer();
      });
    }

    document.body.appendChild(wrapper);
    loadTimerState();
  }

  // ========== 计时逻辑 ==========

  function loadTimerState() {
    try {
      chrome.storage.local.get(['timerState'], function (result) {
        if (result.timerState) {
          timerState = result.timerState;
          if (timerState.isRunning && timerState.startTime) {
            timerState.elapsed = Date.now() - timerState.startTime;
            startTick();
          }
        }
        if (document.getElementById(WRAPPER_ID)) {
          refreshDisplay();
        }
      });
    } catch (e) {
      // 扩展上下文可能失效
    }
  }

  function saveTimerState() {
    try {
      chrome.storage.local.set({ timerState: timerState });
    } catch (e) {}
  }

  function toggleTimer() {
    if (timerState.isRunning) {
      stopTimer();
    } else {
      startTimer();
    }
  }

  function startTimer() {
    timerState.isRunning = true;
    timerState.startTime = Date.now() - timerState.elapsed; // 保留已累积时间
    saveTimerState();
    startTick();
    refreshDisplay();
  }

  function stopTimer() {
    timerState.isRunning = false;
    var finalElapsed = timerState.elapsed;
    timerState.elapsed = 0;
    timerState.startTime = null;
    stopTick();
    saveTimerState();
    refreshDisplay();
    saveSession(finalElapsed);
  }

  function startTick() {
    stopTick();
    tickInterval = setInterval(function () {
      if (timerState.startTime) {
        timerState.elapsed = Date.now() - timerState.startTime;
        refreshDisplay();
      }
    }, 200);
  }

  function stopTick() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function formatTime(ms) {
    var totalSec = Math.floor(ms / 1000);
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    if (min < 10) min = '0' + min; else min = '' + min;
    if (sec < 10) sec = '0' + sec; else sec = '' + sec;
    return min + ':' + sec;
  }

  function formatDuration(minutes) {
    if (minutes < 60) return minutes + 'm';
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return h + 'h ' + m + 'm';
  }

  function saveSession(elapsed) {
    if (elapsed < 30000) return; // <30s 不记录

    var now = new Date();
    var session = {
      id: 'ts_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      startTime: new Date(timerState.startTime).toISOString(),
      endTime: now.toISOString(),
      duration: Math.round(elapsed / 1000) // seconds
    };

    try {
      chrome.storage.local.get(['timerSessions'], function (result) {
        var sessions = result.timerSessions || [];
        sessions.unshift(session);
        if (sessions.length > 10000) sessions = sessions.slice(0, 10000);
        chrome.storage.local.set({ timerSessions: sessions }, function () {
          updateLastSession(session);
        });
      });
    } catch (e) {}
  }

  function updateLastSession(session) {
    var shadows = document.getElementById(WRAPPER_ID);
    if (!shadows) return;
    var panel = shadows.shadowRoot;
    var label = panel.getElementById('timer-last-session');
    if (label) {
      var d = new Date(session.endTime);
      var timeStr = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' + d.getMinutes() : d.getMinutes());
      var durStr = formatDuration(Math.round(session.duration / 60));
      label.textContent = '已记录: ' + durStr + ' @ ' + timeStr;
    }
  }

  function refreshDisplay() {
    var shadows = document.getElementById(WRAPPER_ID);
    if (!shadows) return;
    var panel = shadows.shadowRoot;

    var display = panel.getElementById('timer-display');
    var btn = panel.getElementById('timer-btn');
    var label = panel.getElementById('timer-state-label');
    var lastLabel = panel.getElementById('timer-last-session');

    if (!display || !btn || !label) return;

    if (timerState.isRunning) {
      var ms = timerState.startTime ? (Date.now() - timerState.startTime) : 0;
      display.textContent = formatTime(ms);
      display.className = 'running';
      btn.className = 'running';
      label.textContent = '点击停止';
    } else if (timerState.elapsed > 0) {
      display.textContent = formatTime(timerState.elapsed);
      display.className = 'stopped';
      btn.className = 'stopped';
      label.textContent = '点击继续';
    } else {
      display.textContent = '00:00';
      display.className = 'idle';
      btn.className = 'idle';
      label.textContent = '点击开始记时';
    }

    // 显示最近一条记录
    if (!timerState.isRunning && lastLabel) {
      try {
        chrome.storage.local.get(['timerSessions'], function (result) {
          var sessions = result.timerSessions || [];
          if (sessions.length > 0) {
            var s = sessions[0];
            var d = new Date(s.endTime);
            var timeStr = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' + d.getMinutes() : d.getMinutes());
            var durStr = formatDuration(Math.round(s.duration / 60));
            lastLabel.textContent = '最近: ' + durStr + ' @ ' + timeStr;
          }
        });
      } catch (e) {}
    }
  }

  // ========== 主开关控制 ==========

  function shouldHide(s) {
    return s.ringSidebarEnabled === false || s.showTimerSidebar === false;
  }

  function init() {
    try {
      chrome.runtime.sendMessage({ action: 'getSettings' }, function (res) {
        var s = res && res.success ? (res.settings || {}) : {};
        if (shouldHide(s)) return;
        build();
      });
    } catch (err) {
      // 扩展上下文可能失效
    }
  }

  chrome.storage.onChanged.addListener(function (changes, ns) {
    if (ns !== 'local' || !changes.settings) return;
    var s = changes.settings.newValue || {};
    var el = document.getElementById(WRAPPER_ID);
    if (shouldHide(s)) {
      if (el) {
        stopTick();
        el.remove();
      }
    } else if (!el) {
      build();
    }
  });

  // ========== 初始化 ==========

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
