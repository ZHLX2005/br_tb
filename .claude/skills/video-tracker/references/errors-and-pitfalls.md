# 错误案例 + 坑点速查 — video-tracker 模块

> 实战踩坑清单：来自真实代码的 11 条错误案例 + 10 条坑点速查。

## 错误案例（11 条）

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

## 坑点速查（10 条）

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

## 错误类别分组

按故障模式归类，便于快速定位：

### A. 视频检测不到
- 行 1（active: false 后台打开）
- 行 7（特殊页面 content script 未注入）
- 行 8（只监听 MutationObserver 不监听 URL）
- 坑 4（iframe 视频）

### B. SPA 切换后状态错乱
- 行 8（旧数据残留）
- 行 9（info.url 缓存）
- 行 10（video 元素复用）
- 行 11（pushState 劫持破坏路由）
- 坑 1（劫持顺序）
- 坑 3（清理时机）

### C. 进度数据错乱
- 行 4（watched 倒退）
- 行 6（多视频共用 URL）
- 行 9（同上但 SPA 切换维度）
- 坑 2（duration 阈值误触发）
- 坑 6（duration 为 NaN）

### D. UI 流程异常
- 行 2（固定等待 10s）
- 行 3（关闭后未切回 module）
- 行 5（modal.custom 抛异常）
- 坑 8（sleep 必要等待）

### E. 系统级 / 边界
- 行 7（特殊页面）
- 坑 5（Manifest V3 通信）
- 坑 7（存储空间）
- 坑 9（Map 去重）
- 坑 10（progress-utils 纯函数）

---

## 调试套路

遇到"视频检测不到"症状：

1. **检查 URL 协议** — 排除 chrome:// / edge:// 等（行 7、坑 5）
2. **打开 DevTools Console** — 看 content script 是否报错（Manifest V3 注入时机会不会太晚）
3. **手动调用 `window.__tabboardVideoTracker.forceDetect()`** — 看返回 videos 数组
4. **如果能 forceDetect 但页面刷新又丢** — 大概率 SPA 切视频未触发（行 8、坑 3）
5. **如果检测到但进度永远不变** — 检查 updateVideoProgress 走通没（行 4、行 6）

遇到"进度倒退"症状：

1. 直接定位 `updateVideoProgress` 看是否用了 `Math.max`
2. 检查 `info.watched` 是不是 `video.currentTime` 直接赋值（行 4）

遇到"duration 溢出"症状：

1. 检查 `loadedmetadata` 中有没有换源重置逻辑（行 10）
2. 阈值 `5s && 10%` 对当前场景合适吗？（坑 2）