# 视频倍速控制架构 — Speed Control

> 基于源码：`content/videoSpeed.js`、`content/speedRing.js`、`popup/modules/videoSpeed.js`。

## 模块职责

| 模块 | 职责 | 运行环境 |
|------|------|----------|
| `videoSpeed.js` | 核心：应用倍速/静音到 `<video>` 元素，监听变化自动恢复 | Content Script |
| `speedRing.js` | UI：右侧悬浮控制面板（Shadow DOM），读写 storage | Content Script |
| `popup/modules/videoSpeed.js` | Popup 中的倍速控制 UI | Popup |

## 数据流

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              用户交互层                                    │
├────────────────────────┬───────────────────────┬───────────────────────┤
│  popup/popup.html     │  任意页面 (speedRing)   │  视频页面 (speedRing)  │
│  - 预设按钮 (0.5x~8x) │  - 悬浮触发按钮        │  - <video> 元素       │
│  - 自定义输入         │  - 面板 (预设+滑块)   │                       │
└───────────┬───────────┴───────────┬───────────┴───────────┬───────────┘
            │ chrome.runtime        │ postMessage            │ video API
            │ sendMessage           │ + storage              │
            ▼                       ▼                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           核心层 (videoSpeed.js)                         │
│  - globalSpeed / globalMuted 状态管理                                     │
│  - applySpeedToAllVideos() / applyMutedToAllVideos()                    │
│  - 监听 play/loadedmetadata/timeupdate 自动恢复                           │
└──────────────────────────────────────────────────────────────────────────┘
            │ storage sync (chrome.storage.onChanged)
            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          Storage (chrome.storage.local)                   │
│  - tabboard_global_video_speed: number                                    │
│  - tabboard_global_video_muted: boolean                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

## 存储键

| 键 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| `tabboard_global_video_speed` | `number` | `1` | 全局倍速 (0.25 ~ 8) |
| `tabboard_global_video_muted` | `boolean` | `false` | 默认静音状态 |

## 消息协议

### Content Script ↔ Content Script（同一页面内）

| 消息类型 | 方向 | 参数 | 说明 |
|----------|------|------|------|
| `TABBOARD_SET_VIDEO_SPEED` | Ring → Core | `{ speed }` | 设置倍速 |
| `TABBOARD_SET_VIDEO_MUTED` | Ring → Core | `{ muted }` | 设置静音 |
| `TABBOARD_VIDEO_SPEED_CHANGED` | Core → Ring/Popup | `{ speed }` | 速度变化广播 |
| `TABBOARD_VIDEO_MUTED_CHANGED` | Core → Ring/Popup | `{ muted }` | 静音变化广播 |

### Popup ↔ Content Script（跨上下文）

| Action | 方向 | 参数 | 说明 |
|--------|------|------|------|
| `setVideoSpeed` | Popup → Content | `{ speed }` | 通过 `chrome.tabs.sendMessage` |
| `setVideoMuted` | Popup → Content | `{ muted }` | 通过 `chrome.tabs.sendMessage` |

## UI 组件

### Popup (`popup/popup.html`)

```
┌─────────────────────────────────┐
│  倍速设置                        │
├─────────────────────────────────┤
│ [0.5x][0.75x][正常][1.25x][1.5x]│
│        [2x]                     │
├─────────────────────────────────┤
│  自定义: [____] [应用]          │
└─────────────────────────────────┘
```

### Speed Ring (`content/speedRing.js`)

```
┌─────────────────────────────┐
│  倍速控制              [×]  │
├─────────────────────────────┤
│         1.5x                │
│       当前倍速               │
├─────────────────────────────┤
│ [0.5][0.75][1][1.25][1.5] │
│   [2]  [3]  [5]  [8]      │
├─────────────────────────────┤
│  微调    1.5x               │
│  ═══════●════════           │
├─────────────────────────────┤
│  倍速开关          [✓]      │
│  默认静音          [ ]      │
└─────────────────────────────┘
```

## 视频源变化检测

| 事件 | 触发条件 | 动作 |
|------|----------|------|
| `loadedmetadata` | `video.src` 变化 | 重新应用倍速和静音 |
| `play` | `playbackRate !== globalSpeed` | 恢复倍速 |
| `play` | `globalMuted && !video.muted` | 恢复静音 |
| `timeupdate` | duration 变化 >5s 且 ratio >10% | 检测到视频切换，应用倍速 |

## 预设倍速

```
0.5x | 0.75x | 1x | 1.25x | 1.5x | 2x | 3x | 5x | 8x
```

滑块支持 `0.25 ~ 8`，步进 `0.25`。

## 关键代码片段

### videoSpeed.js — 核心

```javascript
// 状态
let globalSpeed = 1;
let globalMuted = false;

// 应用到所有视频
function applySpeedToAllVideos(speed) {
  document.querySelectorAll('video').forEach(video => {
    video.playbackRate = speed;
  });
}

function applyMutedToAllVideos(muted) {
  document.querySelectorAll('video').forEach(video => {
    video.muted = muted;
  });
}

// 播放时恢复
const onPlay = () => {
  if (video.playbackRate !== globalSpeed) {
    video.playbackRate = globalSpeed;
  }
  if (globalMuted && !video.muted) {
    video.muted = true;
  }
};
```

### popup/modules/videoSpeed.js — Popup 控制

```javascript
// 发送消息到 content script
async function setVideoSpeed(speed) {
  await chrome.storage.local.set({ [STORAGE_KEY]: speed });

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    await chrome.tabs.sendMessage(tabs[0].id, {
      action: 'setVideoSpeed',
      speed: speed
    });
  }
}

// 监听来自 content script 的变化
window.addEventListener('message', (event) => {
  if (event.data.type === 'TABBOARD_VIDEO_SPEED_CHANGED') {
    updateSpeedUI(event.data.speed);
  }
});
```

## 监听 storage 变化（跨页面同步）

```javascript
// speedRing.js
chrome.storage.onChanged.addListener((changes, ns) => {
  if (ns !== 'local') return;

  if (changes[STORAGE_KEY]) {
    currentSpeed = changes[STORAGE_KEY].newValue ?? 1;
    syncPanelUI();
  }

  if (changes[MUTED_KEY]) {
    isMuted = changes[MUTED_KEY].newValue ?? false;
    syncPanelUI();
  }
});
```

## 扩展新功能

如需添加"记住每个站点的倍速"：

1. 在 `videoSpeed.js` 添加 `siteOverrides` Map
2. 在 `loadedmetadata` 时检测 `window.location.hostname`
3. 优先使用站点覆盖，无则用全局值

如需在 Popup 添加静音控制：

1. 添加静音状态到 `loadVideoSpeedSetting()`
2. 在 HTML 添加静音切换按钮
3. 调用 `chrome.tabs.sendMessage({ action: 'setVideoMuted', muted: ... })`
