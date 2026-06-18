---
name: spa-video-detection-reference
description: Reference — SPA 视频检测三层防护架构（原始版本）
---

# SPA 视频检测 — Content Script 路由感知与视频源识别

## 触发条件

- "SPA 页面视频检测"
- "Bilibili/YouTube 切换视频后检测不到"
- "前端路由切换后视频进度错乱"
- "单页应用视频 duration 为 0"
- "不刷新页面切换视频"

## 核心问题

单页应用（SPA）切换视频时不刷新页面，导致 content script：
1. 不会重新注入，旧数据残留
2. video 元素被复用，但 src/duration 已变
3. URL 通过 history API 变化，传统监听捕获不到
4. 上报时把新视频进度写到旧视频记录上

## 三层防护架构

```
┌─────────────────────────────────────────────┐
│  Layer 1: URL 变化监听                        │
│  - 劫持 history.pushState / replaceState      │
│  - 监听 popstate 事件                         │
│  - URL 变化时 → trackedVideos.clear()         │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  Layer 2: 视频源更换检测                      │
│  - loadedmetadata 中对比新旧 duration         │
│  - diff > 5s 且 ratio > 10% → 判定换源      │
│  - 重置 watched = 0，更新 title               │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  Layer 3: 强制重新检测 (detectVideos)         │
│  - 清空 trackedVideos                         │
│  - 重新 findVideos()                          │
│  - Promise.all 等待 loadedmetadata            │
│  - 最多等待 3s 超时兜底                       │
└─────────────────────────────────────────────┘
```

## 关键代码

### 1. URL 变化监听

```javascript
setupUrlChangeListener() {
  const handleUrlChange = () => {
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
}
```

### 2. 视频源更换检测

```javascript
bindVideoEvents(video) {
  const onLoadedMetadata = () => {
    const info = this.trackedVideos.get(video);
    if (info) {
      const newDuration = video.duration || 0;
      // duration 显著变化 → 视频源已更换
      if (info.duration > 0 && newDuration > 0) {
        const diff = Math.abs(info.duration - newDuration);
        const ratio = diff / Math.max(info.duration, newDuration);
        if (diff > 5 && ratio > 0.1) {
          info.watched = 0;        // 重置进度，防止溢出
          info.title = this.getVideoTitle(video);
          info.pageTitle = document.title;
        }
      }
      info.duration = newDuration;
    }
  };
  // ... timeupdate 监听
}
```

### 3. 强制重新检测（Popup/Bg 调用）

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

### 4. 上报使用当前 URL（不用缓存）

```javascript
reportProgress() {
  const currentUrl = normalizeUrl(window.location.href);
  this.trackedVideos.forEach((info) => {
    if (info.duration > 0) {
      chrome.runtime.sendMessage({
        action: 'updateVideoProgress',
        url: currentUrl,   // 动态获取，不用 info.url
        title: info.title,
        duration: info.duration,
        watched: info.watched
      }).catch(() => {});
    }
  });
}
```

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 只监听 `MutationObserver`，不监听 URL 变化 | SPA 路由切换后旧数据残留，新视频检测不到 | 劫持 `history.pushState` + 监听 `popstate` |
| `getDetectedVideos` 返回缓存的 `info.url` | 上报到错误的视频记录，进度张冠李戴 | 每次上报取 `normalizeUrl(window.location.href)` |
| `detectVideos` 同步调用 `findVideos()` 后立即返回 | 视频还没加载 metadata，duration 为 0 | `forceDetect` 异步等待 `loadedmetadata`（最多 3s） |
| video 元素复用时不清除旧 `watched` | 新视频 watched > duration，进度溢出 100% | `loadedmetadata` 中检测 duration 变化，重置 watched |
| 用原始 URL（带 query string）作为 key | 同一视频不同参数被识别为多个视频 | `normalizeUrl` 截断 tracking 参数（Bilibili 去掉 `?spm=...`） |
| `history.pushState` 劫持后没保存原始引用 | 页面自身路由功能被破坏 | `const original = history.pushState; history.pushState = function(...){ original.apply(this, args); ... }` |

## 坑点速查

1. **劫持顺序**：必须在页面 JS 执行前完成劫持，content script `run_at: "document_start"` 或 `document_end` 都要尽早注入
2. **duration 阈值**：`diff > 5s && ratio > 0.1` 是经验值，YouTube 广告插片可能导致误触发，可根据场景调整
3. **清理时机**：切换页面（非 SPA）时 content script 会销毁，但 SPA 内切换不会，所以 URL 监听是必须的
4. **iframe 视频**：`document.querySelectorAll('video')` 不穿透 iframe，需要额外处理
