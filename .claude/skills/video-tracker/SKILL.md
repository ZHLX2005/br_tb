# Video Tracker — SPA 视频检测与课程进度追踪

> **参考来源**: 本 skill 合并自 `spa-video-detection`（SPA 路由感知）和 `video-progress-tracker`（课程进度管理），基于真实代码 `content/videoTracker.js`、`background/videoProgress.js` 等实现。

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

### 初始化

```javascript
init() {
  this.findVideos();               // 首次扫描页面 video 元素
  this.setupMutationObserver();    // 监听 DOM 变化，自动探测新增视频
  this.setupUrlChangeListener();  // SPA 路由切换感知
  this.startReporting();           // 每 5s 定时上报进度
}
```

### 视频探测 — findVideos()

```javascript
findVideos() {
  const videos = Array.from(document.querySelectorAll('video'));
  const newVideos = videos.filter(v => !this.trackedVideos.has(v));

  newVideos.forEach(video => {
    this.trackedVideos.set(video, {
      duration: 0,
      watched: 0,
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

**注意**: 使用 `Map` 而非数组 — `Map` 的 key 是 video 元素引用，便于 O(1) 查找和去重。

### URL 变化监听 — SPA 三层防护

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

#### Layer 1 实现

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

#### Layer 2 实现

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

#### Layer 3 实现 — forceDetect()

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

### 进度上报 — reportProgress()

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

**关键**: 上报时使用 `window.location.href`（当前 URL），而非缓存的 `info.url`，防止 SPA 切换后 URL 错误。

### getDetectedVideos() 返回格式

```javascript
getDetectedVideos() {
  const currentUrl = window.location.href;
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
}
```

### 标题获取优先级

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

### updateVideoProgress 消息处理

```javascript
case 'updateVideoProgress': {
  const normalizedReqUrl = normalizeUrl(request.url);
  for (const group of videoGroups) {
    const video = group.videos.find(v => v.url === normalizedReqUrl);
    if (video) {
      video.watched = Math.max(video.watched || 0, request.watched || 0); // 只增不减
      video.duration = request.duration || video.duration || 0;
      break;
    }
  }
  await chrome.storage.local.set({ videoGroups });
  sendResponse({ success: true });
  break;
}
```

### 存储 Schema

```javascript
// chrome.storage.local
{
  videoGroups: [
    {
      id: string,
      name: string,
      color: string,
      createdAt: string,
      archived: boolean,
      archivedAt: string,
      archiveSnapshot: {
        videos: [{ id, title, duration, watched }],
        totalDuration: number,
        totalWatched: number,
        videoCount: number
      },
      videos: [
        {
          id: string,
          title: string,
          url: string,       // normalizeUrl 处理后的 URL
          duration: number,   // 秒
          watched: number,    // 最大观看位置(秒)，只增不减
          favicon: string,
          pageTitle: string,
          addedAt: string
        }
      ]
    }
  ]
}
```

### 消息协议

| Action | 方向 | 参数 | 说明 |
|--------|------|------|------|
| `getVideoGroups` | ← | - | 获取所有课程组 |
| `getCurrentVideoGroup` | ← | url | 获取当前 URL 所在的组 |
| `addVideoGroup` | ← | name, color? | 创建课程组 |
| `deleteVideoGroup` | ← | groupId | 删除课程组 |
| `renameVideoGroup` | ← | groupId, newName | 重命名 |
| `addVideoToGroup` | ← | groupId, video | 添加视频到组（去重） |
| `removeVideoFromGroup` | ← | groupId, videoId | 移除视频 |
| `updateVideoProgress` | ← | url, duration, watched | 进度上报 |
| `updateVideoTitle` | ← | groupId, videoId, newTitle | 更新标题 |
| `openVideoGroup` | ← | groupId | 打开组内所有视频 |
| `archiveVideoGroup` | ← | groupId | 归档课程 |
| `unarchiveVideoGroup` | ← | groupId | 恢复课程 |
| `reorderGroupVideos` | ← | groupId, videoIds[] | 重排视频顺序 |
| `openVideoProgressPage` | ← | - | 打开课程管理页面 |
| `detectVideos` | ←→ | - | 触发 content script 检测（返回视频列表） |

---

## Layer 4 — 前端 UI

### 添加视频流程（modules/video-progress/view.js）

```
用户点击 "+ 添加视频" / "添加当前视频"
  → 输入 URL（或获取当前标签页）
  → chrome.tabs.create({url, active: true})  // 必须前台打开！
  → for (attempt = 0; attempt < 5; attempt++):
       await sleep(2000)
       chrome.tabs.sendMessage(tab.id, {action: 'detectVideos'})
       if (results.videos.length > 0) break  // 提前命中
  → chrome.tabs.update(selfTab.id, {active: true})  // 切回 module 页
  → chrome.tabs.remove(tab.id)  // 关闭视频页
  → chrome.runtime.sendMessage({action: 'addVideoToGroup', ...})
  → 刷新列表
```

**关键细节**:
- 必须先 `tabs.update(selfTab, {active: true})` **再** `tabs.remove(tab)`，否则关闭后浏览器会切换到其他无关标签页
- 轮询探针比固定 10s 等待更高效（视频可能 3s 就加载好了）

### 批量导入流程

```
用户打开批量导入对话框
  → 选择目标课程（下拉框）
  → 输入链接（一行一个）或上传 .txt 文件
  → 点击开始导入
  → for (i = 0; i < urls.length; i++):
       更新进度条
       chrome.tabs.create({url, active: true})
       轮询检测（2s × 5 次）
       chrome.tabs.remove(tab.id)
       sendMessage({action: 'addVideoToGroup'})
       success/skip/fail 计数
  → 全部完成后：
       切回 module 页
       显示统计结果（成功/已存在/失败）
       刷新列表
```

### 进度计算（三级）

| 层级 | 计算方式 | 显示位置 |
|------|---------|---------|
| 整体 | `sum(watched) / sum(duration)` | 顶部 stats 区域 |
| 分组 | `group.videos.reduce(watched) / group.videos.reduce(duration)` | group-header 进度条 |
| 单项 | `video.watched / video.duration` | video-item 底部细条 |

```javascript
// 单视频进度
export function getVideoDisplayProgress(video) {
  const duration = video.duration || 0;
  const watched = video.watched || 0;
  if (duration <= 0) return 0;
  return Math.round((watched / duration) * 100);
}

// 组/整体进度
export function getGroupDisplayProgress(videos) {
  if (!videos || videos.length === 0) return 0;
  let totalDuration = 0, totalWatched = 0;
  for (const v of videos) {
    if ((v.duration || 0) > 0) {
      totalDuration += v.duration;
      totalWatched += v.watched || 0;
    }
  }
  if (totalDuration <= 0) return 0;
  return Math.round((totalWatched / totalDuration) * 100);
}
```

---

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `chrome.tabs.create({active: false})` 后台静默打开 | 浏览器 autoplay 策略阻止视频加载，content script 检测不到 video 元素 | 必须 `active: true` 前台打开 |
| 固定等待 10s 后单次检测 | 视频已提前加载完仍白白等待，或网络慢 10s 不够 | 2s 轮询探针，最多 10s，提前命中立即退出 |
| 关闭视频页后未切回 module 页 | 浏览器切换到其他标签页，用户体验断裂 | 关闭前先 `tabs.update(moduleTab.id, {active: true})` |
| 用 `video.currentTime` 直接赋值 watched | 用户拖拽进度条会导致 watched 倒退 | `Math.max(oldWatched, currentTime)` 只增不减 |
| popup 中调用 `window.modal.custom()` | ModalDialog 无 custom 方法，抛异常 | 只使用 `modal.prompt()` / `modal.confirm()` / `modal.select()` |
| 同一页面多个视频共用 URL 作为 key | 后上报的视频覆盖前一个的进度 | 需用 normalizeUrl 后的 URL + 必要时区分 video.src |
| content script 在特殊页面执行 | `chrome://`, `edge://` 等页面无法注入 content script | Module/Popup 中检测 URL 协议，提前排除 |
| 只监听 `MutationObserver` 不监听 URL 变化 | SPA 路由切换后旧数据残留，新视频检测不到 | 劫持 `history.pushState` + 监听 `popstate` |
| `getDetectedVideos` 返回缓存的 `info.url` | SPA 切换后上报到错误的视频记录 | 每次上报取 `window.location.href` |
| video 元素复用时不清除旧 `watched` | 新视频 watched > duration，进度溢出 100% | `loadedmetadata` 中检测 duration 变化，重置 watched |
| `history.pushState` 劫持后没保存原始引用 | 页面自身路由功能被破坏 | `const original = history.pushState; history.pushState = function(...){ original.apply(this, args); ... }` |

---

## 坑点速查

1. **劫持顺序** — `history.pushState` 劫持必须在页面 JS 执行前完成，content script `run_at: "document_start"` 或 `document_end` 都要尽早注入
2. **duration 阈值** — `diff > 5s && ratio > 0.1` 是经验值，YouTube 广告插片可能导致误触发，可根据场景调整
3. **清理时机** — 切换页面（非 SPA）时 content script 会销毁，但 SPA 内切换不会，所以 URL 监听是必须的
4. **iframe 视频** — `document.querySelectorAll('video')` 不穿透 iframe，需要额外处理
5. **Manifest V3 限制** — content script 通过 `chrome.runtime.sendMessage` 通信，background 必须用 `onMessage.addListener` 接收
6. **duration 为 NaN/0** — 视频未加载完成时 `duration` 可能为 `NaN`，需 `> 0` 才上报
7. **存储空间** — chrome.storage.local 单个 key 限制约 5MB，大量视频课程需考虑分页或清理策略
8. **sleep 是必要等待** — SPA 页面、XHR 请求、懒加载都需要显式 sleep，不要依赖 `wait_for_load()` alone
9. **去重用 Map** — 同一页面可能存在多个指向同一视频的 `<a>` 标签（标题 + 缩略图），用 video 元素引用做 key 去重
10. **progress-utils 是纯函数** — `getVideoDisplayProgress` / `getGroupDisplayProgress` 不修改原对象，可安全用于渲染

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

---

## 参考资料

原始 skill 文档（已归档至 `references/` 目录）：

| 文件 | 内容 |
|------|------|
| `references/spa-video-detection.md` | SPA 路由感知三层防护架构原始版本 |
| `references/video-progress-tracker.md` | 视频课程进度追踪完整实现原始版本 |

**说明**：主文档基于真实代码重新编写，合并了两个原始 skill 的核心概念，并更正了与实际代码的差异。原始文档保留作为历史参考。
