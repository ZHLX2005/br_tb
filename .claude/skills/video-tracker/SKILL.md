---
name: video-tracker
description: 当用户涉及"视频检测"、"SPA 页面视频"、"追踪视频观看进度"、"课程管理"、"批量导入视频"、"视频倍速控制"、"全局倍速"等场景时触发。视频检测 + 进度追踪 + 全局倍速控制完整方案。
---
# Video Tracker — 视频检测与进度追踪 + 全局倍速

> 基于真实代码实现。核心模块：`content/videoTracker.js`（进度追踪）、`content/videoSpeed.js`（全局倍速）、`background/videoProgress.js`（存储层）。

## 触发条件

- "视频检测"、"SPA 页面视频"
- "追踪视频观看进度"、"课程管理"
- "批量导入视频链接"
- "视频倍速"、"全局倍速"

---

## 核心架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  content/videoTracker.js — 进度追踪                                   │
│  - MutationObserver 探测 video 元素                                   │
│  - 每 5s 上报 {url, duration, watched} 到 background                │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  content/videoSpeed.js — 全局倍速                                    │
│  - 全局统一倍速，所有视频共享                                         │
│  - 检测 video.src 变化 → 重新应用倍速                               │
│  - 注入浮动控制面板到视频容器                                         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  background/videoProgress.js — 数据层                                 │
│  - videoGroups CRUD                                                 │
│  - updateVideoProgress (只增不减)                                    │
│  - getVideoSpeed / setVideoSpeed (全局倍速)                         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  前端 UI                                                           │
│  - popup/modules/videoProgress.js — 进度管理                        │
│  - popup/modules/videoSpeed.js — 倍速控制                           │
│  - modules/video-progress/view.js — 完整管理页面                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 进度追踪 — videoTracker.js

### 初始化

```javascript
init() {
  this.findVideos();             // 扫描页面 video 元素
  this.setupMutationObserver(); // 监听 DOM 变化
  this.startReporting();         // 每 5s 上报进度
}
```

### findVideos — Map 去重

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
}
```

**用 Map 而非数组**：key 是 video 元素引用，O(1) 查找 + 去重。

### 视频源变化检测

```javascript
const onLoadedMetadata = () => {
  const newDuration = video.duration || 0;
  if (info.duration > 0 && newDuration > 0) {
    const diff = Math.abs(info.duration - newDuration);
    const ratio = diff / Math.max(info.duration, newDuration);
    if (diff > 5 && ratio > 0.1) {
      info.watched = 0;  // 换源重置进度
    }
  }
  info.duration = newDuration;
};
```

**判定条件**：`diff > 5s && ratio > 10%`

### 上报进度

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
      }).catch(() => {});
    }
  });
}
```

---

## 全局倍速 — videoSpeed.js

> 详见 [[speed-control-arch]]

### 核心特性

1. **全局统一倍速** — 存储在 `tabboard_global_video_speed`，所有视频共享
2. **视频源变化自动重设** — 监听 `loadedmetadata` 检测 `video.src` 变化
3. **被重置自动恢复** — 监听 `play` 事件，倍速被覆盖时恢复
4. **默认静音支持** — 可设置打开视频时自动静音

### 存储

```javascript
// chrome.storage.local['tabboard_global_video_speed']
1.5  // number，全局有效

// chrome.storage.local['tabboard_global_video_muted']
false  // boolean，默认不静音
```

### 预设倍速

`0.5x | 0.75x | 1x | 1.25x | 1.5x | 2x | 3x | 5x | 8x`（滑块支持 0.25~8）

---

## 数据层 — videoProgress.js

### normalizeUrl — URL 规范化

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

**作用**：Bilibili 去掉 `?spm=...` 等追踪参数，同一视频不同来源识别为同一 URL。

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

---

## 消息协议

| Action                  | 方向 | 参数                   | 说明             |
| ----------------------- | ---- | ---------------------- | ---------------- |
| `getVideoGroups`      | →   | -                      | 获取所有课程组   |
| `addVideoGroup`       | →   | name, color?           | 创建课程组       |
| `deleteVideoGroup`    | →   | groupId                | 删除课程组       |
| `addVideoToGroup`     | →   | groupId, video         | 添加视频         |
| `updateVideoProgress` | →   | url, duration, watched | 进度上报         |
| `openVideoGroup`      | →   | groupId                | 打开组内所有视频 |
| `archiveVideoGroup`   | →   | groupId                | 归档课程         |
| `detectVideos`        | →   | -                      | 触发检测         |
| `getVideoSpeed`       | →   | -                      | 获取全局倍速     |
| `setVideoSpeed`       | →   | speed                  | 设置全局倍速     |

**约定**：

- 失败响应：`{ success: false, error: string }`
- 异步响应必须 `return true`

---

## 存储 Schema

```javascript
// chrome.storage.local['videoGroups']
[
  {
    id: string,
    name: string,
    color: string,
    createdAt: string,
    archived: boolean,
    archivedAt: string | null,
    archiveSnapshot: { videos, totalDuration, totalWatched, videoCount } | null,
    videos: [
      {
        id: string,
        title: string,       // 用户可编辑，content script 不覆盖
        url: string,         // normalizeUrl 后的值
        duration: number,
        watched: number,     // 只增不减
        favicon: string,
        pageTitle: string,
        addedAt: string
      }
    ]
  }
]

// chrome.storage.local['tabboard_global_video_speed']
1.5  // number
```

---

## References 导读

| 任务 | 文档 | 何时读取 |
|------|------|----------|
| 倍速控制架构 | [[speed-control-arch]] | 理解 Ring → Core → Video 的数据流，或扩展新功能时 |
| 进度百分比计算 | [[progress-utils]] | 计算视频完成度时 |
| 添加视频流程 | [[ui-flows]] | 理解 addVideoToGroup 的完整流程时 |
| 消息协议 | [[message-protocol]] | 需要新增 action 或调试通信时 |
| 存储 Schema | [[storage-schema]] | 了解所有 storage 键时 |
| 踩坑查表 | [[errors-and-pitfalls]] | 遇到 bug 或异常行为时 |

---

## 文件索引

| 功能 | 文件 | 备注 |
|------|------|------|
| 进度追踪 | `content/videoTracker.js` | |
| 倍速核心 | `content/videoSpeed.js` | 视频元素操作核心 |
| 倍速 Ring 面板 | `content/speedRing.js` | 页面悬浮控制面板 |
| 倍速 Popup | `popup/modules/videoSpeed.js` | Popup 内的控制 UI |
| 消息桥接 | `content/content.js` | |
| 数据层 | `background/videoProgress.js` | |
| 进度工具 | `modules/video-progress/progress-utils.js` | |
| Popup 进度 | `popup/modules/videoProgress.js` | |
| 完整页面 | `modules/video-progress/view.js` | |
| 入口配置 | `manifest.json` | |

---

## 本次优化经验（key_board_3）

| 发现的问题 | 修复方式 |
|------------|----------|
| 文档说 videoTracker.js 有`setupUrlChangeListener()`，但代码实际没有 | 移除错误介绍，只描述 MutationObserver |
| "视频倍速控制"章节与实际内容重复 | 合并到主文档，精简描述 |
| `content/videoSpeed.js` 缺少文档 | 补全核心特性、检测机制、存储 |
| references 文件过多（6个）且部分内容冗余 | 精简每个 ref 到 < 100 行 |
| message-protocol.md 缺少`getVideoSpeed`/`setVideoSpeed` | 补全新 action |
| errors-and-pitfalls.md 有 11 条错误案例（过时的） | 精简到核心 6 条 + 5 条坑点 |
| 描述说"三层防护"但代码只有一层 | 按代码第一性重写，描述实际实现 |
| speed 控制内容散落在多处，架构不清晰 | 抽取为 [[speed-control-arch]] ref，包含 Ring→Core→Video 数据流 |
