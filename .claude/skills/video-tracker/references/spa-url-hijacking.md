# SPA 视频检测 — 视频源变化防护

> 解决 SPA 页面视频切换后检测不到的问题。

## 视频源变化检测

视频源变化（分P切换、视频切换）的检测在 `content/videoTracker.js` 的 `bindVideoEvents` 中实现：

```javascript
const onLoadedMetadata = () => {
  const newDuration = video.duration || 0;
  if (info.duration > 0 && newDuration > 0) {
    const diff = Math.abs(info.duration - newDuration);
    const ratio = diff / Math.max(info.duration, newDuration);
    if (diff > 5 && ratio > 0.1) {
      info.watched = 0;  // 换源重置进度
      info.title = this.getVideoTitle(video);
    }
  }
  info.duration = newDuration;
};
```

**判定条件**：`diff > 5s && ratio > 10%`

---

## 防护机制

| 触发场景 | 检测方式 | 处理 |
|----------|----------|------|
| 视频分P切换 | `loadedmetadata` 中 `duration` 变化 | 重置 `watched = 0` |
| SPA 路由变化 | `MutationObserver` 探测新增 `<video>` | 自动绑定新视频 |
| 强制重新检测 | popup 调用 `forceDetect()` | 清空 trackedVideos + 重新扫描 |

---

## forceDetect() 实现

```javascript
async forceDetect() {
  this.trackedVideos.clear();
  this.findVideos();

  const videos = Array.from(this.trackedVideos.keys());
  if (videos.length === 0) return this.getDetectedVideos();

  await Promise.race([
    Promise.all(
      videos.map(video =>
        new Promise(resolve => {
          if (video.duration && video.duration > 0) return resolve();
          const onLoaded = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); resolve(); };
          const cleanup = () => {
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('error', onError);
          };
          video.addEventListener('loadedmetadata', onLoaded);
          video.addEventListener('error', onError);
        })
      )
    ),
    new Promise(resolve => setTimeout(resolve, 3000))
  ]);

  return this.getDetectedVideos();
}
```

**超时兜底**：最多等 3s，防止视频加载异常卡住。

---

## 关键实现

1. **用 Map 跟踪 video 元素**：`trackedVideos.get(video)` O(1) 查找
2. **用 `window.location.href` 上报**：SPA 切换后 `info.url` 已过期
3. **`watched` 只增不减**：`Math.max(old, new)` 防止进度倒退
4. **`loadedmetadata` 清理监听**：避免同一视频多次触发

---

## 与倍速控制的协同

`content/videoSpeed.js` 有独立的视频源检测：

```javascript
// 检测 video.src 变化
const onLoadedMetadata = () => {
  if (currentSrc !== info.lastSrc) {
    video.playbackRate = globalSpeed;  // 重新应用倍速
  }
};
```

两个脚本独立工作：videoTracker.js 管理进度，videoSpeed.js 管理倍速。
