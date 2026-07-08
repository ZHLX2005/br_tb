# 消息协议 — video-tracker 模块

> 完整 action 列表：popup/module ↔ content script ↔ background。

## 协议总览

| Action                    | 方向 | 参数                       | 说明                                     |
| ------------------------- | ---- | -------------------------- | ---------------------------------------- |
| `getVideoGroups`        | ←   | -                          | 获取所有课程组                           |
| `getCurrentVideoGroup`  | ←   | url                        | 获取当前 URL 所在的组                    |
| `addVideoGroup`         | ←   | name, color?               | 创建课程组                               |
| `deleteVideoGroup`      | ←   | groupId                    | 删除课程组                               |
| `renameVideoGroup`      | ←   | groupId, newName           | 重命名                                   |
| `addVideoToGroup`       | ←   | groupId, video             | 添加视频到组（去重）                     |
| `removeVideoFromGroup`  | ←   | groupId, videoId           | 移除视频                                 |
| `updateVideoProgress`   | ←   | url, duration, watched     | 进度上报                                 |
| `updateVideoTitle`      | ←   | groupId, videoId, newTitle | 更新标题                                 |
| `openVideoGroup`        | ←   | groupId                    | 打开组内所有视频                         |
| `archiveVideoGroup`     | ←   | groupId                    | 归档课程                                 |
| `unarchiveVideoGroup`   | ←   | groupId                    | 恢复课程                                 |
| `reorderGroupVideos`    | ←   | groupId, videoIds[]        | 重排视频顺序                             |
| `openVideoProgressPage` | ←   | -                          | 打开课程管理页面                         |
| `detectVideos`          | ←→ | -                          | 触发 content script 检测（返回视频列表） |

---

## 方向约定

- **←**：popup / module / content script 主动发给 background
- **←→**：双向（content script 监听 background 触发 + 返回结果）

所有消息通过 `chrome.runtime.sendMessage(action, params)` 发送，background 在 `background/videoProgress.js` 的 `onMessage` listener 里 switch case 处理。

---

## 关键 action 详解

### `addVideoToGroup`（添加视频到课程组）

请求：

```javascript
{
  action: 'addVideoToGroup',
  groupId: 'g_xxx',
  video: {
    title: '...',
    url: '...',          // background 自动 normalizeUrl
    duration: 1234,
    watched: 56,
    favicon: '...',
    pageTitle: '...'
  }
}
```

响应：

- `{ success: true, video: {...newVideo} }` — 新建成功
- `{ success: false, error: 'Video already in group' }` — 已存在
- `{ success: false, error: 'Group not found' }` — 课程组不存在

去重基于 `normalizeUrl(video.url)`。

### `updateVideoProgress`（content script 上报进度）

请求：

```javascript
{
  action: 'updateVideoProgress',
  url: 'https://www.bilibili.com/video/BVxxx',  // SPA 内必须是当前 location.href
  duration: 1234,
  watched: 56
}
```

策略：**只增不减** — `video.watched = Math.max(old, new)`。

### `archiveVideoGroup`（归档课程）

归档后：

- `group.archived = true`
- `group.archiveSnapshot = { videos, totalDuration, totalWatched, videoCount }`

不删除视频数据，调用 `unarchiveVideoGroup` 可恢复。

---

## 添加自定义 action 的 SOP

1. 在 `background/videoProgress.js` 的 `setupVideoProgressListeners` switch 里加 case
2. 调用 `sendResponse({ success: true })` 或 `sendResponse({ success: false, error: ... })`
3. 在 popup/module 调用方用 `chrome.runtime.sendMessage`
4. **永远 return true**（async response 模式）

模板：

```javascript
case 'myNewAction': {
  const data = await chrome.storage.local.get(['videoGroups']);
  const groups = data.videoGroups || [];
  // ... 业务逻辑 ...
  await chrome.storage.local.set({ videoGroups: groups });
  sendResponse({ success: true, /* payload */ });
  break;
}
```

---

## 错误处理约定

- 所有失败响应：`{ success: false, error: string }`
- background 抛异常时：上层 `sendResponse({ success: false, error: error.message })`
- 调用方需检查 `chrome.runtime.lastError`（context invalidated）
- content script 上报用 `.catch(() => {})` 静默失败（避免刷屏）
