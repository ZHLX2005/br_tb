# 消息协议 — video-tracker 模块

> 完整 action 列表：popup/module ↔ content script ↔ background。

## 协议总览

| Action | 方向 | 参数 | 说明 |
|--------|------|------|------|
| `getVideoGroups` | → | - | 获取所有课程组 |
| `getCurrentVideoGroup` | → | url | 获取当前 URL 所在的组 |
| `addVideoGroup` | → | name, color? | 创建课程组 |
| `deleteVideoGroup` | → | groupId | 删除课程组 |
| `renameVideoGroup` | → | groupId, newName | 重命名 |
| `addVideoToGroup` | → | groupId, video | 添加视频到组 |
| `removeVideoFromGroup` | → | groupId, videoId | 移除视频 |
| `updateVideoProgress` | → | url, duration, watched | 进度上报 |
| `updateVideoTitle` | → | groupId, videoId, newTitle | 更新标题 |
| `openVideoGroup` | → | groupId | 打开组内所有视频 |
| `archiveVideoGroup` | → | groupId | 归档课程 |
| `unarchiveVideoGroup` | → | groupId | 恢复课程 |
| `reorderGroupVideos` | → | groupId, videoIds[] | 重排视频顺序 |
| `openVideoProgressPage` | → | - | 打开课程管理页面 |
| `detectVideos` | → | - | 触发 content script 检测 |
| `getVideoSpeed` | → | - | 获取全局倍速 |
| `setVideoSpeed` | → | speed | 设置全局倍速 |

**方向约定**：→ 表示 popup/module → background

---

## 关键 Action 详解

### addVideoToGroup

```javascript
{
  action: 'addVideoToGroup',
  groupId: 'g_xxx',
  video: {
    title: '...',
    url: '...',
    duration: 1234,
    watched: 56,
    favicon: '...',
    pageTitle: '...'
  }
}
```

响应：
- `{ success: true, video: {...} }`
- `{ success: false, error: 'Video already in group' }`
- `{ success: false, error: 'Group not found' }`

去重基于 `normalizeUrl(video.url)`。

### updateVideoProgress

```javascript
{
  action: 'updateVideoProgress',
  url: 'https://www.bilibili.com/video/BVxxx',
  duration: 1234,
  watched: 56
}
```

策略：**只增不减** — `video.watched = Math.max(old, new)`

---

## 添加 Action SOP

1. 在 `background/videoProgress.js` 的 switch 里加 case
2. 调用 `sendResponse({ success: true })`
3. 调用方用 `chrome.runtime.sendMessage`
4. **永远 return true**（异步响应）

---

## 错误处理

- 失败响应：`{ success: false, error: string }`
- content script 上报用 `.catch(() => {})` 静默失败
