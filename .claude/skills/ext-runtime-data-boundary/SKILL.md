---
name: ext-runtime-data-boundary
description: 当 content script 上报运行时数据（进度、状态）时，发现覆盖了用户手动设定的元数据（标题、名称、描述），或需要定义运行时数据上报的边界时触发。
---

# Content Script 运行时数据上报边界

## 触发条件

- "上报进度覆盖标题"
- "运行时数据不要覆盖用户设定"
- "content script 上报元数据"
- "进度更新不要改标题"
- "document.title 覆盖导入的标题"

## 核心原则

### 1. 运行时上报只报「状态」，不报「元数据」

Content script 从页面抓取的数据（`document.title`、DOM 文本）属于**运行时快照**，不可靠、带噪音、随时变化。用户手动导入/编辑的标题属于**用户元数据**，是信任源。

**错误做法** — 进度上报顺手更新标题：
```javascript
// ❌ background.js
video.watched = request.watched;
video.duration = request.duration;
video.title = request.title || video.title;  // 运行时 title 覆盖用户设定
```

**正确做法** — 进度 API 只更新进度字段：
```javascript
// ✅ background.js — updateVideoProgress 只更新进度
video.watched = Math.max(video.watched || 0, request.watched || 0);
video.duration = request.duration || video.duration || 0;
// title 由用户导入时设定，进度上报不覆盖
```

```javascript
// ✅ background.js — 标题修改走独立 API
video.title = request.newTitle.trim();
```

### 2. `document.title` 在 SPA 中不可信

| 问题 | 根因 |
|------|------|
| 旧标题覆盖新标题 | SPA 路由切换后 `document.title` 异步更新，content script 在更新前抓取到旧值 |
| 标题带站点后缀 | `document.title` 通常是 `"视频标题 - 哔哩哔哩"`，用户不想要后缀 |
| 标题被 SEO 脚本动态改写 | 某些站点会用 JS 动态修改 title，与视频实际名称无关 |

**结论：** `document.title` 只能作为**导入时的初始参考**，不能作为**持续同步的数据源**。

### 3. 元数据修改必须显式、用户驱动

元数据（标题、名称、描述）的变更路径：

```
用户操作 → 独立 API → 直接更新 storage
     ↑
   显式意图（点击编辑、弹窗确认）
```

进度数据的上报路径：

```
定时器/事件 → 上报 API → 只更新状态字段
     ↑
   自动触发（无需用户参与）
```

两条路径必须分离，不能共用同一个 API。

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `updateVideoProgress` 中顺手更新 `title` | 每次播放进度上报都用 `document.title` 覆盖用户手动编辑的标题 | 进度 API 只更新 `watched`/`duration`，标题走独立 `updateVideoTitle` |
| content script 把 `document.title` 加入上报消息 | SPA 切换时 title 延迟更新，旧标题污染新视频 | content script 不上报 title，background 不接收 title |
| 运行时抓取 DOM 标题作为唯一标题来源 | DOM 标题带站点后缀、SEO 关键词，用户无法获得干净标题 | 导入时抓取一次作为初始值，之后用户可手动编辑修正 |
| 进度和元数据共用同一个 message action | 代码意图混乱，难以区分哪些是自动上报、哪些是用户编辑 | `updateVideoProgress` 只处理进度，`updateVideoTitle` 只处理标题 |

## 设计检查清单

- [ ] 进度上报 API 只包含状态字段（watched、duration、timestamp），不包含元数据
- [ ] 元数据修改有独立的 API，且必须由用户显式触发
- [ ] content script 不抓取 `document.title` 用于上报
- [ ] background 不将运行时数据回写到用户元数据字段
- [ ] 导入时抓取的标题作为初始值，允许用户后续手动编辑

## 代码模板

```javascript
// background.js — 进度上报（只更新状态）
case 'updateVideoProgress': {
  const video = findVideoByUrl(request.url);
  if (video) {
    video.watched = Math.max(video.watched || 0, request.watched || 0);
    video.duration = request.duration || video.duration || 0;
    // ❌ 不要在这里碰 title、description 等元数据
  }
  await save(videoGroups);
  break;
}

// background.js — 标题编辑（独立 API，用户驱动）
case 'updateVideoTitle': {
  const video = findVideoById(request.videoId);
  if (video && request.newTitle) {
    video.title = request.newTitle.trim();
  }
  await save(videoGroups);
  break;
}

// content_script.js — 上报消息（不包含 title）
chrome.runtime.sendMessage({
  action: 'updateVideoProgress',
  url: currentUrl,
  duration: info.duration,
  watched: info.watched
  // ❌ 不要传 title
});
```
