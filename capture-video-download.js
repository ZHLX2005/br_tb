/**
 * 视频截屏脚本 - 下载为 PNG 版本
 *
 * 用法:
 *   1. 打开视频页面
 *   2. F12 打开 DevTools → Console
 *   3. 粘贴本脚本全部内容 → 回车
 *
 * 输出: 当前视频帧会被下载为 PNG 文件(video-<时间戳>.png)
 */

(async function captureVideo() {
  // 1) 找视频:优先正在播放 → 视口内最大 → 第一个
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) {
    console.error('❌ 当前页面没找到 <video>');
    return;
  }

  const inViewport = (v) => {
    const r = v.getBoundingClientRect();
    return (
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < window.innerHeight &&
      r.left < window.innerWidth &&
      r.width > 50 &&
      r.height > 50
    );
  };

  const video =
    videos.find((v) => !v.paused && v.readyState >= 2) ||
    videos
      .filter(inViewport)
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return rb.width * rb.height - ra.width * ra.height;
      })[0] ||
    videos[0];

  console.log('🎯 选中视频:', {
    src: video.currentSrc || video.src,
    paused: video.paused,
    readyState: video.readyState,
    size: `${video.videoWidth}×${video.videoHeight}`,
  });

  // 2) 等到有可用帧
  if (video.readyState < 2) {
    console.log('⏳ 等待视频数据...');
    await new Promise((r) =>
      video.addEventListener('loadeddata', r, { once: true })
    );
  }

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) {
    console.error('❌ 视频尺寸无效');
    return;
  }

  // 3) 画到 canvas(原生分辨率,无任何覆盖物)
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);

  // 4) CORS 检测:跨域视频会让 canvas 被污染 → toBlob 会抛错
  try {
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
  } catch (e) {
    console.error(
      '🚫 该视频被跨域保护,纯 Web API 无法截图(canvas 被污染)。\n' +
        '   这种情况只能用扩展的 chrome.tabs.captureVisibleTab。'
    );
    return;
  }

  // 5) 导出 PNG 并下载
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    console.log(`✅ 已下载 video-${Date.now()}.png,${blob.size} 字节`);
  }, 'image/png');
})();