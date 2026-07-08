# SPA URL 劫持三层防护

> 从主 SKILL.md 提取的专项参考：解决 "Bilibili/YouTube 切视频后检测不到" 的核心机制。

## 三层防护概览

```
Layer 1: history.pushState / replaceState 劫持 + popstate 监听
  └─ URL 变化时 → trackedVideos.clear() → findVideos()

Layer 2: loadedmetadata 中检测 duration 显著变化
  └─ diff > 5s && ratio > 10% → 判定换源，重置 watched = 0

Layer 3: forceDetect() 强制重新检测（popup/module 调用）
  └─ 清空 trackedVideos → 重新 findVideos()
  └─ Promise.all 等待所有视频 loadedmetadata
  └─ 最多 3s 超时兜底
```

---

## Layer 1 实现 — 劫持 history.pushState/replaceState

```javascript
setupUrlChangeListener() {
  const handleUrlChange = () => {
    this.trackedVideos.clear();  // 关键：清空旧数据避免张冠李戴
    this.findVideos();
  };

  window.addEventListener('popstate', handleUrlChange);

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);  // 先执行原方法，再通知
    handleUrlChange();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    handleUrlChange();
  };
}
```

**关键**: 必须 `originalPushState.apply(this, args)` 先执行，否则页面自身路由功能被破坏。

---

## Layer 2 实现 — duration 阈值判定换源

```javascript
bindVideoEvents(video) {
  const onLoadedMetadata = () => {
    const info = this.trackedVideos.get(video);
    if (info) {
      const newDuration = video.duration || 0;
      if (info.duration > 0 && newDuration > 0) {
        const diff = Math.abs(info.duration - newDuration);
        const ratio = diff / Math.max(info.duration, newDuration);
        if (diff > 5 && ratio > 0.1) {   // 经验阈值
          info.watched = 0;              // 重置进度，防止溢出
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
      info.watched = Math.max(info.watched, video.currentTime); // 只增不减
      info.duration = video.duration;
    }
  };

  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('timeupdate', onTimeUpdate);

  if (video.duration) onLoadedMetadata();
}
```

---

## Layer 3 实现 — forceDetect() 强制重新检测

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
    new Promise(resolve => setTimeout(resolve, 3000))  // 3s 超时兜底
  ]);

  return this.getDetectedVideos();
}
```

---

## 关键 anti-pattern

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 只监听 `MutationObserver` 不监听 URL 变化 | SPA 路由切换后旧数据残留，新视频检测不到 | 劫持 `history.pushState` + 监听 `popstate` |
| `history.pushState` 劫持后没保存原始引用 | 页面自身路由功能被破坏 | `const original = history.pushState; history.pushState = function(...){ original.apply(this, args); ... }` |
| 劫持顺序写反（先通知再调原始方法） | 页面自身状态先变了再被劫持，可能死循环 | 必须 `originalPushState.apply(this, args)` 先执行 |
| 切换页面（非 SPA）时不清状态 | content script 销毁时 `trackedVideos` 仍持有旧元素引用 | SPA 内切换靠 URL 监听；跨页切换靠 content script 自然销毁 |
| duration 阈值写死 5s & 10% | YouTube 广告插片误触发换源判定 | 经验值，可按场景调整（详见 errors-and-pitfalls） |
| `loadedmetadata` 中忘了移除监听 | 同一视频多次触发，watched 被反复重置 | 单次监听 + cleanup，或仅在 diff 触发时重置 |

---

## 与其他模块的接口

```
content/videoTracker.js
  └─ setupUrlChangeListener() → history.pushState 劫持
  └─ bindVideoEvents(video) → loadedmetadata + timeupdate
  └─ forceDetect() → Promise.race(loadedmetadata, 3s)

content/content.js (Layer 2 桥接)
  └─ chrome.runtime.onMessage({action: 'detectVideos'})
  └─ tracker.forceDetect().then(videos => sendResponse(...))
```

调用方：popup/modules/videoCapture.js、modules/video-progress/view.js

## 与 SPA 切视频相关的旁路（重要）

- `getDetectedVideos` 必须返回 `window.location.href` 当前值，**不能**用 `info.url` 缓存
- 上报进度时也用 `window.location.href`，同上
- SPA 内 `video` 元素可能被复用（如 B 站切 P 集），这时 trackedVideos 命中，duration 检测触发换源重置