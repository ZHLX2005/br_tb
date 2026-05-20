---
name: video-progress-tracker
description: 在 Chrome Extension 中实现跨页面视频检测、时长获取、观看进度追踪和分组聚合。涉及 content script 视频探测、background 数据管理、module 页面聚合展示。
---

# Video Progress Tracker — 跨页面视频进度追踪架构

## 触发条件

- "追踪视频观看进度"
- "聚合多个页面的视频"
- "检测页面视频并获取时长"
- "视频课程进度管理"
- "跨标签页视频分组"

## 核心架构（三层）

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Content Script (content/content.js)               │
│  - 扫描页面 video 元素                                       │
│  - 绑定 timeupdate 事件追踪 watched                           │
│  - 每 5s 上报 {url, title, duration, watched} 到 background   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Background (background/videoProgress.js)           │
│  - 接收 detectVideos / updateVideoProgress / CRUD 消息        │
│  - 存储 schema: videoGroups[] → videos[]                     │
│  - 进度更新策略: Math.max(oldWatched, newWatched) 只增不减    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Frontend Module (modules/video-progress/)          │
│  - 聚合展示课程组、视频列表、完成百分比                        │
│  - 添加视频: 输入URL → 前台打开 → 轮询探测 → 切回 → 关闭       │
│  - Popup 快捷捕获: 向当前标签页 sendMessage 检测               │
└─────────────────────────────────────────────────────────────┘
```

## 数据 Schema

```javascript
// chrome.storage.local
{
  videoGroups: [
    {
      id: string,           // generateId()
      name: string,         // "React 教程"
      color: string,        // "#42a5f5"
      createdAt: string,    // ISO 8601
      videos: [
        {
          id: string,
          title: string,    // 视频标题 (优先 video.title, 其次 pageTitle)
          url: string,      // 页面 URL (视频所在页面)
          duration: number, // 视频总时长(秒)
          watched: number,  // 最大观看位置(秒), 只增不减
          favicon: string,
          pageTitle: string,
          addedAt: string
        }
      ]
    }
  ]
}
```

## 消息协议 (Background)

| Action | 方向 | 参数 | 说明 |
|--------|------|------|------|
| `getVideoGroups` | ← | - | 获取所有课程组 |
| `addVideoGroup` | ← | name, color? | 创建课程组 |
| `deleteVideoGroup` | ← | groupId | 删除课程组 |
| `renameVideoGroup` | ← | groupId, newName | 重命名 |
| `addVideoToGroup` | ← | groupId, video | 添加视频到组 |
| `removeVideoFromGroup` | ← | groupId, videoId | 移除视频 |
| `updateVideoProgress` | ← | url, duration, watched | 进度上报 |
| `openVideoGroup` | ← | groupId | 打开组内所有视频 |
| `detectVideos` | ←→ | - | content script 检测视频 |

## Content Script 视频检测

```javascript
const videoTracker = {
  videos: [],
  trackedVideos: new Map(), // videoElement -> {duration, watched, title, url}
  REPORT_PERIOD_MS: 5000,

  findVideos() {
    const videos = Array.from(document.querySelectorAll('video'));
    videos.forEach(video => {
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
  },

  bindVideoEvents(video) {
    video.addEventListener('loadedmetadata', () => {
      info.duration = video.duration || 0;
    });
    video.addEventListener('timeupdate', () => {
      info.watched = Math.max(info.watched, video.currentTime);
      info.duration = video.duration;
    });
  },

  startReporting() {
    setInterval(() => {
      this.trackedVideos.forEach((info) => {
        if (info.duration > 0) {
          chrome.runtime.sendMessage({
            action: 'updateVideoProgress',
            url: info.url,
            title: info.title,
            duration: info.duration,
            watched: info.watched
          });
        }
      });
    }, this.REPORT_PERIOD_MS);
  }
};
```

## 添加视频流程（Module 页面）

```
用户点击 "+ 添加视频"
  → 输入 URL
  → chrome.tabs.create({url, active: true})  // 必须前台打开！
  → for (attempt = 0; attempt < 5; attempt++):
       sleep(2000)
       chrome.tabs.sendMessage(tab.id, {action: 'detectVideos'})
       if (results.videos.length > 0) break  // 提前命中
  → chrome.tabs.query 找到 module 页面并 activate
  → chrome.tabs.remove(tab.id)  // 关闭视频页
  → chrome.runtime.sendMessage({action: 'addVideoToGroup', ...})
  → 刷新列表
```

## 添加视频流程（Popup）

```
用户点击 "捕获当前视频"
  → chrome.tabs.query({active: true, currentWindow: true})
  → chrome.tabs.sendMessage(activeTab.id, {action: 'detectVideos'})
  → 若多个视频，prompt 让用户选择编号
  → prompt 让用户选择课程组编号
  → sendMessage({action: 'addVideoToGroup', ...})
```

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `chrome.tabs.create({active: false})` 后台静默打开 | 浏览器策略阻止视频自动播放和 content script 部分功能，检测失败 | 必须 `active: true` 前台打开 |
| 固定等待 10s 后单次检测 | 视频已提前加载完仍白白等待，或网络慢 10s 不够 | 2s 轮询探针，最多 10s，提前命中立即退出 |
| 关闭视频页后未切回 module 页 | 用户留在其他标签页，体验断裂 | 关闭前先 `tabs.update(moduleTab.id, {active: true})` |
| 用 `video.currentTime` 直接赋值 watched | 用户拖拽进度条会导致 watched 倒退 | `Math.max(oldWatched, currentTime)` 只增不减 |
| popup 中调用 `window.modal.custom()` | ModalDialog 无 custom 方法，抛异常 | 只使用 `modal.prompt()` / `modal.confirm()` |
| 同一页面多个视频共用 URL 作为 key | 后上报的视频覆盖前一个的进度 | 需改用 video.src / currentSrc 作为唯一标识 |
| content script 在特殊页面执行 | `chrome://`, `edge://` 等页面无法注入 content script | 检测 URL 协议，提前排除 |

## 坑点速查

1. **Manifest V3 限制**: content script 通过 `chrome.runtime.sendMessage` 通信，background 必须用 `onMessage.addListener` 接收
2. **视频标题获取优先级**: `video.title` → `aria-label` → 容器内 `h1/h2/h3` → `document.title`
3. **duration 为 NaN/0**: 视频未加载完成时 `duration` 可能为 `NaN`，需 `> 0` 才上报
4. **存储空间**: chrome.storage.local 单个 key 限制约 5MB，大量视频课程需考虑分页或清理策略
5. **iframe 内视频**: `document.querySelectorAll('video')` 不会穿透 iframe，如需支持需递归遍历 `iframes`
