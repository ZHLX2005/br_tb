/**
 * Video Frame Capture — 注入页面工具
 *
 * 在 content script 上下文里截取页面视频当前帧 → PNG dataURL
 * 通过 window.__tabboardVideoFrameCapture 暴露给其他 content script 使用
 *
 * 使用:
 *   const dataUrl = await window.__tabboardVideoFrameCapture.capture();
 *   // 或短别名:
 *   const dataUrl = await window.captureVideoFrame();
 *
 * 选择策略:播放中 → 视口内最大 → 第一个 <video>
 * 跨域视频 canvas 污染时返回 null(无 CORS 头 → drawImage 抛错)
 *
 * 不放进 content/content.js:这是个独立工具,可能被 note module / noteRing / popup 复用,
 * 独立文件方便后续抽取到 .tool/ 或扩展为通用模块。
 */

(function () {
  'use strict';

  if (window.__tabboardVideoFrameCapture) return;
  window.__tabboardVideoFrameCapture = true;

  const MAX_FRAME_W = 1920;

  /**
   * 截取当前页一个视频的当前帧,返回 PNG dataURL
   * @returns {Promise<string|null>} PNG dataURL 或 null(无视频/未就绪/跨域污染)
   */
  function capture() {
    return new Promise((resolve) => {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) { resolve(null); return; }

      const inViewport = (v) => {
        const r = v.getBoundingClientRect();
        return r.bottom > 0 && r.right > 0 &&
               r.top < window.innerHeight && r.left < window.innerWidth &&
               r.width > 50 && r.height > 50;
      };

      const video =
        videos.find(v => !v.paused && v.readyState >= 2) ||
        videos.filter(inViewport).sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        })[0] ||
        videos[0];

      const draw = () => {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) { resolve(null); return; }
        const scale = Math.min(1, MAX_FRAME_W / w);
        const cw = Math.round(w * scale), ch = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        try {
          canvas.getContext('2d').drawImage(video, 0, 0, cw, ch);
          resolve(canvas.toDataURL('image/png'));
        } catch (_) {
          // 跨域污染:video 源无 CORS 头,canvas 被污染,toDataURL 会抛
          resolve(null);
        }
      };

      if (video.readyState >= 2) {
        draw();
      } else {
        // 等 loadeddata;2.5s 兜底(可能永远不触发 → draw 失败返回 null)
        let done = false;
        const finish = () => { if (!done) { done = true; draw(); } };
        video.addEventListener('loadeddata', finish, { once: true });
        setTimeout(finish, 2500);
      }
    });
  }

  // 暴露 API
  window.__tabboardVideoFrameCapture = { capture, MAX_FRAME_W };
  // 短别名方便控制台 / 其他脚本直接调用
  window.captureVideoFrame = capture;
})();