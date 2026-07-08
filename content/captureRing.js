/**
 * Capture Ring — 当前页视频直接捕获到课程分组
 * 第四个圆环，悬浮在右侧边缘（Timer 下方）
 * 点击展开后：检测当前页面视频 → 列表 → 选择目标课程组 → 一键添加
 * Shadow DOM 隔离宿主 CSS
 */

(function () {
  'use strict';

  const WRAPPER_ID = 'tabboard-capture-sidebar';
  const ACCENT = '#42a5f5';

  // ========== 状态 ==========

  let state = {
    videos: [],          // 当前页检测到的视频
    groups: [],          // 课程组列表
    selectedVideoIdx: 0, // 默认选中第 0 个视频
    selectedGroupId: null,
    loading: false
  };

  // ========== 样式 ==========

  const STYLES = `
    :host {
      position: fixed; top: 50%; right: 0;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --accent: ${ACCENT};
    }
    #${WRAPPER_ID}-trigger {
      width: 40px; height: 40px; border-radius: 50%; background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      position: fixed; top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0)); right: -16px;
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
      position: fixed; top: calc(var(--ring-stack-anchor, 50%) + 52px * var(--ring-order, 0)); right: 8px;
      transform: translate(10px, -50%); width: 280px;
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

    #cr-header {
      padding: 10px 14px; border-bottom: 1px solid #eee;
      display: flex; align-items: center; justify-content: space-between;
    }
    #cr-title { font-size: 12px; font-weight: 600; color: #333; }
    .cr-close-btn {
      background: transparent; border: none; color: #999; font-size: 16px;
      line-height: 1; width: 22px; height: 22px; border-radius: 4px;
      cursor: pointer; padding: 0; font-family: inherit;
    }
    .cr-close-btn:hover { background: #f0f0f0; color: #e53935; }

    #cr-body { padding: 10px 14px 12px; }

    .cr-section-label {
      font-size: 10px; font-weight: 600; color: #999;
      text-transform: uppercase; letter-spacing: 0.5px;
      margin: 8px 0 6px;
    }
    .cr-section-label:first-child { margin-top: 0; }

    /* 视频列表 */
    .cr-video-list {
      max-height: 110px; overflow-y: auto;
      border: 1px solid #eee; border-radius: 6px;
    }
    .cr-video-item {
      padding: 6px 8px; font-size: 11px; color: #333;
      cursor: pointer; display: flex; align-items: center; gap: 6px;
      border-bottom: 1px solid #f5f5f5;
    }
    .cr-video-item:last-child { border-bottom: none; }
    .cr-video-item:hover { background: #f7faff; }
    .cr-video-item.selected { background: #e3f2fd; }
    .cr-video-item.selected::before {
      content: '●'; color: ${ACCENT}; font-size: 10px;
    }
    .cr-video-item:not(.selected)::before {
      content: '○'; color: #ccc; font-size: 10px;
    }
    .cr-video-title {
      flex: 1; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; min-width: 0;
    }
    .cr-video-dur { color: #999; font-size: 10px; flex-shrink: 0; }

    /* 分组下拉 */
    .cr-group-select {
      width: 100%; padding: 7px 9px; font-size: 11px;
      border: 1px solid #ddd; border-radius: 5px;
      background: white; color: #333;
      font-family: inherit; cursor: pointer;
    }
    .cr-group-select:focus { outline: none; border-color: ${ACCENT}; }

    /* 提示/状态行 */
    .cr-empty {
      padding: 14px 4px; font-size: 11px; color: #999;
      text-align: center; line-height: 1.5;
    }
    .cr-loading {
      padding: 14px 4px; font-size: 11px; color: ${ACCENT};
      text-align: center;
    }

    /* 主按钮 */
    #cr-submit {
      width: 100%; margin-top: 10px; padding: 9px 0;
      background: ${ACCENT}; color: white;
      border: none; border-radius: 6px; font-size: 12px;
      font-weight: 600; cursor: pointer;
      font-family: inherit; transition: background 160ms, transform 100ms;
    }
    #cr-submit:hover:not(:disabled) { background: #1976d2; }
    #cr-submit:active:not(:disabled) { transform: scale(0.98); }
    #cr-submit:disabled {
      background: #cfd8dc; color: #fff; cursor: not-allowed;
    }

    /* 内嵌 toast（页面侧反馈，避开依赖） */
    .cr-toast {
      margin-top: 8px; padding: 6px 8px; border-radius: 4px;
      font-size: 11px; text-align: center;
      animation: cr-fade 200ms ease;
    }
    .cr-toast.success { background: #e8f5e9; color: #2e7d32; }
    .cr-toast.warning { background: #fff8e1; color: #f57c00; }
    .cr-toast.error   { background: #ffebee; color: #c62828; }
    @keyframes cr-fade {
      from { opacity: 0; transform: translateY(-2px); }
      to   { opacity: 1; transform: translateY(0); }
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
    trigger.title = '捕获当前视频';
    trigger.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="4" width="16" height="12" rx="2" stroke="${ACCENT}" stroke-width="1.5" fill="none"/>
        <path d="M8 8l4 2-4 2V8z" fill="${ACCENT}"/>
      </svg>
    `;
    shadow.appendChild(trigger);
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      const wasExpanded = wrapper.classList.contains('expanded');
      wrapper.classList.toggle('expanded');
      // 展开时立即刷新检测；收起不做事
      if (!wasExpanded) {
        refreshDetection();
      }
    });

    // 共享近场浮现
    if (!window.__tabboardSideReveal) {
      window.__tabboardSideReveal = true;
      document.addEventListener('mousemove', function (e) {
        if (window.__tabboardRingDragging) return;
        var near = e.clientX > window.innerWidth - 40;
        document.body.classList.toggle('tabboard-side-near', near);
        document.querySelectorAll('[id$="-sidebar"]:not([id$="-panel"]):not([id$="-trigger"])').forEach(function (host) {
          host.classList.toggle('near', near);
        });
      });
    }

    // Panel
    const panel = document.createElement('div');
    panel.id = WRAPPER_ID + '-panel';
    panel.innerHTML = `
      <div id="cr-header">
        <span id="cr-title">捕获当前视频</span>
        <button class="cr-close-btn" id="cr-close-btn" title="收起">×</button>
      </div>
      <div id="cr-body">
        <div class="cr-section-label">当前页面视频</div>
        <div id="cr-video-area">
          <div class="cr-loading">检测中...</div>
        </div>
        <div class="cr-section-label">添加到课程组</div>
        <select id="cr-group-select" class="cr-group-select">
          <option value="">加载中...</option>
        </select>
        <button id="cr-submit" disabled>捕获到课程组</button>
        <div id="cr-toast-host"></div>
      </div>
    `;
    shadow.appendChild(panel);

    // 点击外部收起
    const onDocClick = function (e) {
      if (!wrapper.classList.contains('expanded')) return;
      if (wrapper.contains(e.target)) return;
      wrapper.classList.remove('expanded');
    };
    setTimeout(function () { document.addEventListener('click', onDocClick); }, 0);

    // 关闭按钮
    var closeBtn = shadow.getElementById('cr-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        wrapper.classList.remove('expanded');
      });
    }

    // 提交按钮
    var submitBtn = shadow.getElementById('cr-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        submitCapture();
      });
    }

    document.body.appendChild(wrapper);

    // 启用拖动 + 位置记忆（defaultOrder=3 = 第四个）
    window.__tabboardRingDrag && window.__tabboardRingDrag.attach(
      shadow.getElementById(WRAPPER_ID + '-trigger'),
      shadow.getElementById(WRAPPER_ID + '-panel'),
      wrapper,
      { defaultOrder: 3, ringId: 'capture' }
    );

    // 注册到 ring-order 协调器：参与垂直自动补位
    // isAlive 走协调器缓存的 settings(避免每个 ring 都做 getSettings 走 message passing)
    window.__tabboardRingOrder && window.__tabboardRingOrder.register({
      ringId: 'capture',
      host: wrapper,
      defaultOrder: 3,
      isAlive: function () {
        if (!document.getElementById(WRAPPER_ID)) return false;
        var s = window.__tabboardRingOrder.getLastSettings();
        if (!s) return true; // 还没初始化,保守按"显示"
        return s.ringSidebarEnabled !== false && s.showCaptureRing !== false;
      }
    });
  }

  // ========== 工具 ==========

  function getShadow() {
    var w = document.getElementById(WRAPPER_ID);
    return w && w.shadowRoot;
  }

  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds <= 0) return '--:--';
    var s = Math.floor(seconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(sec);
    return pad(m) + ':' + pad(sec);
  }

  function showInlineToast(msg, type) {
    var shadow = getShadow();
    if (!shadow) return;
    var host = shadow.getElementById('cr-toast-host');
    if (!host) return;
    host.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'cr-toast ' + (type || 'success');
    div.textContent = msg;
    host.appendChild(div);
    setTimeout(function () {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 2500);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function sendMessage(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false });
          }
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  // ========== 业务流程 ==========

  async function refreshDetection() {
    var shadow = getShadow();
    if (!shadow) return;
    if (state.loading) return;

    state.loading = true;
    state.videos = [];
    state.groups = [];
    state.selectedVideoIdx = 0;
    state.selectedGroupId = null;

    var videoArea = shadow.getElementById('cr-video-area');
    var groupSelect = shadow.getElementById('cr-group-select');
    var submitBtn = shadow.getElementById('cr-submit');
    if (videoArea) videoArea.innerHTML = '<div class="cr-loading">检测中...</div>';
    if (groupSelect) groupSelect.innerHTML = '<option value="">加载中...</option>';
    if (submitBtn) submitBtn.disabled = true;

    // 跳过特殊页面（content script 一般进不来这些页，但保险起见）
    var protocol = window.location.protocol;
    if (protocol === 'chrome:' || protocol === 'chrome-extension:' ||
        protocol === 'edge:' || protocol === 'about:') {
      if (videoArea) videoArea.innerHTML = '<div class="cr-empty">当前页面不支持视频检测</div>';
      state.loading = false;
      return;
    }

    // 1) 检测视频（直接复用 videoTracker）
    try {
      var tracker = window.__tabboardVideoTracker;
      if (tracker && typeof tracker.forceDetect === 'function') {
        state.videos = await tracker.forceDetect();
      } else {
        // 兜底：直接 querySelectorAll
        var vids = Array.from(document.querySelectorAll('video'));
        state.videos = vids.map(function (v) {
          return {
            title: document.title || '未命名视频',
            url: window.location.href,
            duration: v.duration || 0,
            watched: v.currentTime || 0,
            favicon: '',
            pageTitle: document.title
          };
        });
      }
    } catch (e) {
      state.videos = [];
    }

    renderVideoList();

    // 2) 加载课程组（与视频并行；视频通常几秒内完成）
    var groupsRes = await sendMessage({ action: 'getVideoGroups' });
    if (groupsRes && groupsRes.success) {
      state.groups = (groupsRes.videoGroups || []).filter(function (g) { return !g.archived; });
    }
    renderGroupSelect();

    // 3) 更新按钮可用性
    updateSubmitState();

    state.loading = false;
  }

  function renderVideoList() {
    var shadow = getShadow();
    if (!shadow) return;
    var videoArea = shadow.getElementById('cr-video-area');
    if (!videoArea) return;

    if (!state.videos || state.videos.length === 0) {
      videoArea.innerHTML = '<div class="cr-empty">未检测到视频<br><span style="font-size:10px;color:#bbb">刷新页面或播放视频后再试</span></div>';
      state.selectedVideoIdx = -1;
      return;
    }

    var html = '<div class="cr-video-list">';
    state.videos.forEach(function (v, idx) {
      var sel = idx === state.selectedVideoIdx ? ' selected' : '';
      var title = v.title || v.pageTitle || '未命名视频';
      var dur = formatDuration(v.duration);
      html += '<div class="cr-video-item' + sel + '" data-idx="' + idx + '">' +
              '<span class="cr-video-title">' + escapeHtml(title) + '</span>' +
              '<span class="cr-video-dur">' + dur + '</span>' +
              '</div>';
    });
    html += '</div>';
    videoArea.innerHTML = html;

    // 绑定选择事件
    videoArea.querySelectorAll('.cr-video-item').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(el.dataset.idx, 10);
        if (isNaN(idx)) return;
        state.selectedVideoIdx = idx;
        renderVideoList();
        updateSubmitState();
      });
    });
  }

  function renderGroupSelect() {
    var shadow = getShadow();
    if (!shadow) return;
    var sel = shadow.getElementById('cr-group-select');
    if (!sel) return;

    if (!state.groups || state.groups.length === 0) {
      sel.innerHTML = '<option value="">暂无课程组（请到 popup 创建）</option>';
      sel.disabled = true;
      state.selectedGroupId = null;
      return;
    }

    sel.disabled = false;
    var html = '';
    state.groups.forEach(function (g) {
      var count = (g.videos || []).length;
      html += '<option value="' + escapeHtml(g.id) + '">' +
              escapeHtml(g.name) + ' (' + count + ' 个视频)' +
              '</option>';
    });
    sel.innerHTML = html;
    state.selectedGroupId = state.groups[0].id;
    sel.value = state.selectedGroupId;

    sel.onchange = function () {
      state.selectedGroupId = sel.value || null;
      updateSubmitState();
    };
  }

  function updateSubmitState() {
    var shadow = getShadow();
    if (!shadow) return;
    var btn = shadow.getElementById('cr-submit');
    if (!btn) return;
    var ready = state.selectedVideoIdx >= 0 &&
                state.videos[state.selectedVideoIdx] &&
                state.selectedGroupId;
    btn.disabled = !ready;
  }

  async function submitCapture() {
    var shadow = getShadow();
    if (!shadow) return;
    var btn = shadow.getElementById('cr-submit');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '捕获中...';
    }

    try {
      var video = state.videos[state.selectedVideoIdx];
      var groupId = state.selectedGroupId;
      if (!video || !groupId) {
        showInlineToast('请选择视频和课程组', 'warning');
        return;
      }

      var res = await sendMessage({
        action: 'addVideoToGroup',
        groupId: groupId,
        video: {
          title: video.title || video.pageTitle || '未命名视频',
          url: video.url,
          duration: video.duration || 0,
          watched: video.watched || 0,
          favicon: video.favicon || '',
          pageTitle: video.pageTitle || ''
        }
      });

      if (res && res.success) {
        var group = state.groups.find(function (g) { return g.id === groupId; });
        showInlineToast('已添加到「' + (group ? group.name : '') + '」', 'success');
        // 重新拉取组列表（更新计数显示）
        var groupsRes = await sendMessage({ action: 'getVideoGroups' });
        if (groupsRes && groupsRes.success) {
          state.groups = (groupsRes.videoGroups || []).filter(function (g) { return !g.archived; });
          renderGroupSelect();
        }
      } else if (res && res.error === 'Video already in group') {
        showInlineToast('该视频已在该课程中', 'warning');
      } else {
        showInlineToast('添加失败: ' + (res && res.error ? res.error : '未知错误'), 'error');
      }
    } finally {
      if (btn) {
        btn.textContent = '捕获到课程组';
        updateSubmitState();
      }
    }
  }

  // ========== 主开关控制 ==========

  function shouldHide(s) {
    return s.ringSidebarEnabled === false || s.showCaptureRing === false;
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
      if (el) el.remove();
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