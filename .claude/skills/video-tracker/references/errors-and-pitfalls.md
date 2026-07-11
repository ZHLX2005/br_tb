# 错误案例 + 坑点 — video-tracker

> 实战踩坑清单。

## 常见错误

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `active: false` 后台打开 | autoplay 被阻止，检测不到 video | `active: true` 前台打开 |
| 固定等 10s 后检测 | 视频提前加载完仍白等，或网络慢不够 | 2s 轮询 × 5 次，提前命中退出 |
| 关闭视频页后未切回 | 浏览器切到其他标签 | 先 `tabs.update(moduleTab, {active: true})` 再 `remove` |
| `watched = currentTime` | 拖拽进度条导致倒退 | `Math.max(old, currentTime)` |
| `getDetectedVideos` 返回 `info.url` | SPA 切换后上报到错误记录 | 用 `window.location.href` |
| 只监听 MutationObserver | SPA 路由切换后检测不到 | 已有 MutationObserver 足够，视频源变化靠 duration 检测 |

## 坑点

1. **duration 阈值** — `diff > 5s && ratio > 0.1` 是经验值，YouTube 广告可能误触发
2. **iframe 视频** — `querySelectorAll('video')` 不穿透 iframe
3. **duration 为 NaN** — 视频未加载完成时需 `> 0` 才上报
4. **存储空间** — chrome.storage.local 单 key 约 5MB
5. **progress-utils 是纯函数** — 不修改原对象

## 调试套路

1. 打开 DevTools Console，看 content script 是否报错
2. 手动调用 `window.__tabboardVideoTracker.forceDetect()` 看返回
3. 检查 `updateVideoProgress` 是否用了 `Math.max`