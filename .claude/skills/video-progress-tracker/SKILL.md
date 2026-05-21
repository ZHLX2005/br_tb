---
name: video-progress-tracker
description: 在 Chrome Extension 中实现跨页面视频检测、时长获取、观看进度追踪和分组聚合。涉及 content script 视频探测、SPA 路由感知、background 数据管理、module 页面聚合展示、批量导入。
---

# Video Progress Tracker — 跨页面视频进度追踪深度实现

## 触发条件

- "追踪视频观看进度"
- "聚合多个页面的视频"
- "检测页面视频并获取时长"
- "视频课程进度管理"
- "跨标签页视频分组"
- "批量导入视频链接"
- "SPA 页面视频检测"

---

## 核心架构（四层）

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Content Script (content/videoTracker.js)          │
│  - IIFE 独立模块，暴露 window.__tabboardVideoTracker          │
│  - MutationObserver 动态探测新增 video 元素                   │
│  - URL Change Listener 劫持 history.pushState/popstate       │
│  - Video Source Change Detection (duration diff > 5s)        │
│  - 每 5s 上报 {url, title, duration, watched} 到 background  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Content Script Proxy (content/content.js)         │
│  - 接收 popup/module 的 detectVideos 消息                    │
│  - 调用 tracker.forceDetect() 异步等待 loadedmetadata        │
│  - 返回标准化后的视频列表给调用方                             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Background (background/videoProgress.js)           │
│  - 接收 detectVideos / updateVideoProgress / CRUD 消息        │
│  - normalizeUrl: Bilibili 去掉 ?spm=... 追踪参数             │
│  - 存储 schema: videoGroups[] → videos[]                     │
│  - 进度更新策略: Math.max(oldWatched, newWatched) 只增不减    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Frontend Module (modules/video-progress/view.js)   │
│  - 聚合展示课程组、视频列表、三级进度条（整体/分组/单项）       │
│  - 添加视频: 输入URL → 前台打开 → 轮询探测 → 切回 → 关闭     │
│  - 批量导入: 顺序任务队列，txt/textarea 输入                  │
│  - Popup 快捷捕获: 向当前标签页 sendMessage 检测              │
└─────────────────────────────────────────────────────────────┘
```

---

## videoTracker.js — 视频探测核心（最稳定的实现）

### 1. 初始化与自动探测

```javascript
init() {
  this.findVideos();
  this.setupMutationObserver();   // DOM 变化自动探测
  this.setupUrlChangeListener();  // SPA 路由切换清空旧数据
  this.startReporting();          // 5s 定时上报
}
```

### 2. URL 规范化（Bilibili 特化）

```javascript
function normalizeUrl(url) {
  const u = new URL(url);
  if (u.hostname.includes('bilibili.com') && u.pathname.startsWith('/video/')) {
    let path = u.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1);
    return `${u.protocol}//${u.hostname}${path}`;  // 去掉 ?spm=... 等追踪参数
  }
  return url;
}
```

**Why:** Bilibili 的 `spm_id_from` 参数会导致同一视频被识别为多个不同 URL。

### 3. SPA 路由感知 — 三层防护架构

```
Layer 1: URL 变化监听
  └─ 劫持 history.pushState / replaceState + popstate 事件
  └─ URL 变化时 → trackedVideos.clear() → findVideos()

Layer 2: 视频源更换检测
  └─ loadedmetadata 中对比新旧 duration
  └─ diff > 5s && ratio > 0.1 → 判定换源
  └─ 重置 watched = 0，更新 title/pageTitle

Layer 3: 强制重新检测 (forceDetect)
  └─ 清空 trackedVideos → 重新 findVideos()
  └─ Promise.all 等待所有视频 loadedmetadata
  └─ 最多等待 3s 超时兜底
```

#### Layer 1: URL 变化监听

```javascript
setupUrlChangeListener() {
  const handleUrlChange = () => {
    this.trackedVideos.clear();  // 关键：清空旧数据避免张冠李戴
    this.findVideos();
  };

  window.addEventListener('popstate', handleUrlChange);

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    handleUrlChange();
  };
  // replaceState 同理
}
```

**关键:** 必须先 `originalPushState.apply(this, args)` 再调用 `handleUrlChange()`，否则页面自身路由功能会被破坏。

#### Layer 2: 视频源更换检测

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
  // ...
}
```

#### Layer 3: forceDetect（Popup/Module 调用）

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

**注意:** `getDetectedVideos()` 返回时**使用当前 URL**（`normalizeUrl(window.location.href)`），而非缓存的 `info.url`，防止 SPA 切换后 URL 错误。

### 4. 视频标题获取优先级

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

## 数据 Schema

```javascript
// chrome.storage.local
{
  videoGroups: [
    {
      id: string,
      name: string,
      color: string,
      createdAt: string,
      videos: [
        {
          id: string,
          title: string,
          url: string,          // normalizeUrl 处理后的 URL
          duration: number,     // 秒
          watched: number,      // 最大观看位置(秒), 只增不减
          favicon: string,
          pageTitle: string,
          addedAt: string
        }
      ]
    }
  ]
}
```

---

## 消息协议 (Background)

| Action | 方向 | 参数 | 说明 |
|--------|------|------|------|
| `getVideoGroups` | ← | - | 获取所有课程组 |
| `addVideoGroup` | ← | name, color? | 创建课程组 |
| `deleteVideoGroup` | ← | groupId | 删除课程组 |
| `renameVideoGroup` | ← | groupId, newName | 重命名 |
| `addVideoToGroup` | ← | groupId, video | 添加视频到组（会去重） |
| `removeVideoFromGroup` | ← | groupId, videoId | 移除视频 |
| `updateVideoProgress` | ← | url, duration, watched | 进度上报 |
| `openVideoGroup` | ← | groupId | 打开组内所有视频 |
| `detectVideos` | ←→ | - | content script 强制检测（返回列表） |

---

## 添加视频流程（Module 页面）

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

**关键细节:**
- 必须先 `tabs.update(selfTab, {active: true})` **再** `tabs.remove(tab)`，否则关闭后浏览器会切换到其他无关标签页
- 轮询探针比固定 10s 等待更高效（视频可能 3s 就加载好了）

---

## 批量导入流程

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

---

## 进度计算（三级）

| 层级 | 计算方式 | 显示位置 |
|------|---------|---------|
| 整体 | `sum(watched) / sum(duration)` | 顶部 stats 区域 |
| 分组 | `group.videos.reduce(watched) / group.videos.reduce(duration)` | group-header 进度条 |
| 单项 | `video.watched / video.duration` | video-item 底部细条 |

```javascript
// 整体进度
const progressPercent = totalDuration > 0
  ? Math.round((totalWatched / totalDuration) * 100)
  : 0;
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
| `getDetectedVideos` 返回缓存的 `info.url` | SPA 切换后上报到错误的视频记录 | 每次上报取 `normalizeUrl(window.location.href)` |
| video 元素复用时不清除旧 `watched` | 新视频 watched > duration，进度溢出 100% | `loadedmetadata` 中检测 duration 变化，重置 watched |
| `history.pushState` 劫持后没保存原始引用 | 页面自身路由功能被破坏 | `const original = history.pushState; history.pushState = function(...){ original.apply(this, args); ... }` |
| 直接拼接 `href` 和 origin | Bilibili href 可能已带 `//www.bilibili.com`，导致双域名 | 正则提取 path：`href.match(/\/video\/BV[a-zA-Z0-9]+/)` |

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
9. **去重用 Set** — 同一页面可能存在多个指向同一视频的 `<a>` 标签（标题 + 缩略图）
