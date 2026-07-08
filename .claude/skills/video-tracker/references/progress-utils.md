# 进度计算工具 — video-tracker 模块

> 三级进度条计算：`getVideoDisplayProgress` / `getGroupDisplayProgress`。

## 三级概览

| 层级 | 计算方式 | 显示位置 |
|------|---------|---------|
| 整体 | `sum(watched) / sum(duration)` | 顶部 stats 区域 |
| 分组 | `group.videos.reduce(watched) / group.videos.reduce(duration)` | group-header 进度条 |
| 单项 | `video.watched / video.duration` | video-item 底部细条 |

---

## API 实现

`modules/video-progress/progress-utils.js`：

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

## 调用方

| 调用方 | 用的函数 | 渲染位置 |
|---|---|---|
| `modules/video-progress/view.js` | 两个都 | 整体 stats + group-header + video-item |
| `popup/modules/videoProgress.js` | 两个都 | popup 视频进度页 |
| `content/courseProgressBar.js` | `getVideoDisplayProgress` | 顶部进度条（单视频） |

---

## 设计要点

### 纯函数

- `progress-utils.js` 不修改传入对象，仅返回百分比数字
- 安全用于渲染流水线（多次调用无副作用）

### 边界处理

| 情况 | 返回值 |
|---|---|
| `video.duration === 0` 或 `NaN` | `0`（避免除零） |
| `video.watched === undefined` | 当 0 处理 |
| `videos` 空数组 | `0` |
| 所有视频 duration 都是 0 | `0`（filter 掉，sum 仍为 0） |
| `watched > duration` | **可能 > 100**（如换源未重置时），但实际不会发生（updateVideoProgress 不倒退，且换源会重置） |

### 整体 vs 分组计算区别

- **整体**（所有非归档课程的视频）：用同一个 `getGroupDisplayProgress(allVideos)` 调用
- **分组**：对 `group.videos` 调用一次
- 二者**不是嵌套关系**，是平级的——分组进度不受其他分组影响

---

## 进度展示相关 UI 约定

### 整体 stats 区（顶部）

```
[总进度 35%]  [总时长 4h 32m]  [已观看 1h 35m]  [视频数 12]
```

### group-header 进度条

```
┌──────────────────────────────┐
│ 课程：机器学习                │
│ ▓▓▓▓▓▓░░░░░░░░░  38%         │  ← 整条 group-header
└──────────────────────────────┘
```

### video-item 进度条

```
┌────────────────────────────────────────┐
│ ▶ 1.1 机器学习导论          12:34      │
│ ▓▓▓▓▓▓▓▓░░░░░░░░░  52%               │  ← video-item 底部细条
└────────────────────────────────────────┘
```

---

## 与 SPA 切视频的协同

`watched` 只增不减 + SPA 切视频重置 watched 的策略由 `updateVideoProgress` 和 `videoTracker.js` 共同保证：

1. content script 上报 `watched = video.currentTime`
2. background 的 `updateVideoProgress` 用 `Math.max(old, new)`
3. SPA 切视频（duration 阈值触发换源）→ content script 把 `info.watched = 0`
4. 下次 `getGroupDisplayProgress` 重新计算，新视频的进度从 0 开始

所以三级进度计算**不需要关心** SPA 切换是否发生过——它只看最终 `watched / duration`。