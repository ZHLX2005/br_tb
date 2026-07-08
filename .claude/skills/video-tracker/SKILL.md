---
name: video-tracker
description: 当用户涉及"SPA 页面视频"、"Bilibili/YouTube 切换视频后检测不到"、"追踪视频观看进度"、"课程管理"、"单页应用视频 duration 为 0"、"前端路由切换后视频进度错乱"、"批量导入视频链接"、"视频课程分组"等场景时触发。SPA 视频检测 + 课程进度追踪完整方案，含三层 URL 劫持防护、Bilibili URL 规范化、消息协议、存储 schema。
---

# Video Tracker — SPA 视频检测与课程进度追踪

> **合并来源**: 本 skill 合并自 `spa-video-detection`（SPA 路由感知）和 `video-progress-tracker`（课程进度管理），基于真实代码 `content/videoTracker.js`、`background/videoProgress.js` 等实现。

## 触发条件

- "视频检测"、"SPA 页面视频"
- "Bilibili/YouTube 切换视频后检测不到"
- "追踪视频观看进度"、"课程管理"
- "单页应用视频 duration 为 0"
- "前端路由切换后视频进度错乱"
- "批量导入视频链接"
- "视频课程分组"

---

## 核心架构（四层）

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: Content Script (content/videoTracker.js)                  │
│  - IIFE 独立模块，暴露 window.__tabboardVideoTracker                │
│  - MutationObserver 动态探测新增 video 元素                         │
│  - URL Change Listener 劫持 history.pushState/popstate             │
│  - Video Source Change Detection (duration diff > 5s && ratio > 10%) │
│  - 每 5s 上报 {url, duration, watched} 到 background               │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 2: Content Script Bridge (content/content.js)                │
│  - 接收 popup/module 的 detectVideos 消息                          │
│  - 调用 tracker.forceDetect() 异步等待 loadedmetadata               │
│  - 返回 { success: true, videos } 给调用方                         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 3: Background Storage (background/videoProgress.js)         │
│  - 接收 detectVideos / updateVideoProgress / CRUD 消息               │
│  - normalizeUrl: Bilibili 去掉 ?spm=... 追踪参数                   │
│  - 存储 schema: videoGroups[] → videos[]                          │
│  - 进度更新策略: Math.max(oldWatched, newWatched) 只增不减         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 4: Frontend UI                                               │
│  - popup/modules/videoProgress.js — Popup 快捷 UI                   │
│  - popup/modules/videoCapture.js — Popup 捕获流程                   │
│  - modules/video-progress/view.js — 完整课程管理页面                │
│  - modules/video-progress/progress-utils.js — 进度计算工具          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1 — videoTracker.js 核心实现

### init() — 四步启动

```javascript
init() {
  this.findVideos();               // 首次扫描页面 video 元素
  this.setupMutationObserver();    // 监听 DOM 变化，自动探测新增视频
  this.setupUrlChangeListener();  // SPA 路由切换感知
  this.startReporting();           // 每 5s 定时上报进度
}
```

### findVideos() — Map 选型

```javascript
findVideos() {
  const videos = Array.from(document.querySelectorAll('video'));
  const newVideos = videos.filter(v => !this.trackedVideos.has(v));

  newVideos.forEach(video => {
    this.trackedVideos.set(video, {
      duration: 0, watched: 0,
      title: this.getVideoTitle(video),
      url: window.location.href,
      favicon: this.getFavicon(),
      pageTitle: document.title
    });
    this.bindVideoEvents(video);
  });

  this.videos = videos;
}
```

**注意**: 用 `Map` 而非数组 — key 是 video 元素引用，O(1) 查找 + 去重（同页多个 `<a>` 指向同一视频不会重复绑定）。

### SPA 三层防护（摘要）

| Layer | 触发条件 | 动作 |
|---|---|---|
| 1 | URL 变化（pushState/popstate） | `trackedVideos.clear()` + 重新 findVideos |
| 2 | duration diff > 5s && ratio > 10% | 判定换源，重置 `watched = 0` |
| 3 | popup/module 调 `forceDetect()` | 强制重新检测，Promise.race(loadedmetadata, 3s 超时) |

**完整代码 + 错误案例** 见 `references/spa-url-hijacking.md`。

### reportProgress() — 用当前 URL

```javascript
reportProgress() {
  const currentUrl = window.location.href;  // 用当前 URL，不用缓存
  this.trackedVideos.forEach((info) => {
    if (info.duration > 0) {
      chrome.runtime.sendMessage({
        action: 'updateVideoProgress',
        url: currentUrl,
        duration: info.duration,
        watched: info.watched
      }).catch(() => {});  // 静默处理 extension 未就绪情况
    }
  });
}
```

**关键**: 用 `window.location.href`（当前 URL），**不**用缓存的 `info.url`。SPA 切换后 info.url 已过期。

### getVideoTitle() — 四级优先级

```javascript
getVideoTitle(video) {
  // 1. 容器内的标题元素
  const container = video.closest('figure, .video-container, [class*="video"], [class*="player"]');
  if (container) {
    const titleEl = container.querySelector('h1, h2, h3, .title, [class*="title"]');
    if (titleEl) return titleEl.textContent.trim();
  }
  // 2. 页面标题
  if (document.title) return document.title.trim();
  // 3. aria-label / video.title
  if (video.getAttribute('aria-label')) return video.getAttribute('aria-label');
  if (video.title) return video.title;
  return '未命名视频';
}
```

---

## Layer 2 — content.js 消息桥接

```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'detectVideos') {
    const tracker = window.__tabboardVideoTracker;
    if (tracker) {
      tracker.forceDetect().then(videos => {
        sendResponse({ success: true, videos });
      }).catch(() => {
        sendResponse({ success: true, videos: [] });
      });
    } else {
      sendResponse({ success: true, videos: [] });
    }
    return true;
  }
  // ...
});
```

---

## Layer 3 — background/videoProgress.js 数据层

### normalizeUrl — Bilibili URL 规范化

```javascript
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('bilibili.com') && u.pathname.startsWith('/video/')) {
      let path = u.pathname;
      if (path.endsWith('/')) path = path.slice(0, -1);
      const p = u.searchParams.get('p');
      if (p && p !== '1') {
        return `${u.protocol}//${u.hostname}${path}?p=${p}`;
      }
      return `${u.protocol}//${u.hostname}${path}`;
    }
    return url;
  } catch {
    return url;
  }
}
```

**作用**: 去掉 Bilibili 的 `?spm=...` 等追踪参数，同一视频不同来源参数识别为同一 URL。

### updateVideoProgress — 只增不减

```javascript
case 'updateVideoProgress': {
  const normalizedReqUrl = normalizeUrl(request.url);
  for (const group of videoGroups) {
    const video = group.videos.find(v => v.url === normalizedReqUrl);
    if (video) {
      video.watched = Math.max(video.watched || 0, request.watched || 0);
      video.duration = request.duration || video.duration || 0;
      break;
    }
  }
  await chrome.storage.local.set({ videoGroups });
  sendResponse({ success: true });
  break;
}
```

**完整消息协议 / 存储 schema** 见 `references/message-protocol.md` 和 `references/storage-schema.md`。

---

## Layer 4 — 前端 UI（关键决策摘要）

| 决策 | 关键约束 |
|---|---|
| `chrome.tabs.create({active: true})` | **必须前台打开** — 后台标签 autoplay 被浏览器阻止 |
| 2s 轮询探针 × 5 次 | 提前命中立即退出，比固定 10s 等待更高效 |
| `tabs.update(selfTab)` 先于 `tabs.remove(tab)` | 关闭视频页前先切回 module 页，避免切到无关标签 |

**完整添加视频 / 批量导入流程** 见 `references/ui-flows.md`。

**三级进度计算公式**（单视频 / 分组 / 整体）见 `references/progress-utils.md`。

---

## References 导读（按需深入，不要一次全读）

| 你的任务 | 读这篇 | 这篇讲什么 |
|---------|--------|-----------|
| 实现 SPA 路由感知 / "切视频检测不到" | `references/spa-url-hijacking.md` | history.pushState 劫持 + loadedmetadata 阈值 + forceDetect 超时 |
| 排查 "消息没生效 / 参数对不上" | `references/message-protocol.md` | 15 个 action 的方向/参数/说明 |
| 看 videoGroups / archiveSnapshot 字段含义 | `references/storage-schema.md` | 完整 chrome.storage.local 结构 |
| 实现添加视频 / 批量导入流程 | `references/ui-flows.md` | tabs.create({active:true}) + 2s 轮询 + 关闭前切回 |
| 写进度百分比 / 看进度计算公式 | `references/progress-utils.md` | getVideoDisplayProgress / getGroupDisplayProgress |
| 踩坑查表 / "为什么 X 错" | `references/errors-and-pitfalls.md` | 11 条错误案例 + 10 条坑点速查 |

---

## 文件索引（与文档对应的真实代码）

| 文档章节 | 对应文件 |
|---------|---------|
| Layer 1 | `content/videoTracker.js` |
| Layer 2 | `content/content.js` |
| Layer 3 | `background/videoProgress.js` |
| Layer 3 normalizeUrl | `background/utils.js` |
| Layer 4 Popup UI | `popup/modules/videoProgress.js` |
| Layer 4 Popup 捕获 | `popup/modules/videoCapture.js` |
| Layer 4 完整页面 | `modules/video-progress/view.js` |
| Layer 4 进度工具 | `modules/video-progress/progress-utils.js` |
| Layer 4 HTML | `modules/video-progress/video-progress.html` |
| 入口配置 | `manifest.json` (`content/js: ["content/videoTracker.js", "content/content.js"]`) |