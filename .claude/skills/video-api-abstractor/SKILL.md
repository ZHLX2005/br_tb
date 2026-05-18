---
name: video-api-abstractor
description: 当用户需要在页面中发现视频元素、控制视频播放、开发片段播放功能、或提取视频控制逻辑为可复用 API 时触发。
---

# Video API Abstractor — 页面视频控制抽象层

## 触发条件

- "提取视频控制逻辑"
- "抽象视频 API"
- "页面视频发现和播放控制"
- "片段播放功能"
- "视频时间范围控制"
- "把视频播放器抽象为 API"

## 核心原则

1. **零 UI 依赖**：抽象层只暴露 API，不创建任何 DOM 元素
2. **事件驱动**：通过回调函数通知外部状态变化
3. **防御式编程**：视频不存在、时间非法、网络错误等场景全部兜底
4. **时区无关**：所有时间以秒为单位，输入/输出格式可配置

## API 架构

```
VideoController
├── 发现层：扫描页面 video 元素
├── 选择层：切换当前操作的 video
├── 时间层：解析/格式化时间字符串
├── 播放层：播放/暂停/跳转/片段循环
├── 片段层：多片段队列管理、自动跳转
└── 事件层：时间更新、片段切换、播放结束
```

## 标准化 API

### 初始化

```javascript
const vc = new VideoController({
  onTimeUpdate: (time, segmentIndex) => {},    // 每 100ms 回调
  onSegmentEnd: (endedIndex, nextIndex) => {},  // 片段结束
  onSegmentChange: (newIndex) => {},            // 切换片段
  onPlayStateChange: (isPlaying) => {},         // 播放/暂停
  onVideoChange: (videoElement, index) => {},   // 切换视频源
  autoPlayNext: true,                           // 是否自动播放下一片段
  endThreshold: 0.1                             // 提前 N 秒触发结束检测
});
```

### 发现与选择

```javascript
// 扫描页面视频
const videos = vc.findVideos();       // => [HTMLVideoElement, ...]
const count = vc.videoCount;          // => number

// 切换视频
vc.setVideo(index);                   // index: 0-based
vc.currentVideo;                      // => HTMLVideoElement | null
vc.videoInfo;                         // => { duration, width, height, currentTime }
```

### 时间工具（静态方法，可独立使用）

```javascript
VideoController.parseTimeStr('01:30')     // => 90 (秒)
VideoController.parseTimeStr('01:30:45')  // => 5445 (秒)
VideoController.parseTimeStr('90.5')      // => 90.5 (秒)

VideoController.formatTime(90)            // => "01:30"
VideoController.formatTime(5445)          // => "01:30:45"

VideoController.parseTimeRange('00:01-00:05')  // => { start: 1, end: 5 }
```

### 基础播放控制

```javascript
vc.play();
vc.pause();
vc.stop();            // pause + 清除片段监听
vc.seekTo(120);       // 跳转到 120 秒
vc.currentTime;       // 当前时间（秒）
```

### 片段队列管理

```javascript
// 添加片段
vc.addSegment('00:01-00:05', '片段1');     // timeRange, optionalLabel
vc.addSegment({ start: 10, end: 15 });      // 对象形式

// 批量添加
vc.setSegments([
  { start: 0, end: 5, label: '开头' },
  { start: 60, end: 65, label: '高潮' }
]);

// 片段信息
vc.segments;          // => [{ start, end, label }, ...]
vc.segmentCount;      // => number
vc.currentSegment;    // => number (0-based)

// 片段导航
vc.playSegment(index);        // 播放指定片段
vc.nextSegment();             // 下一片段
vc.previousSegment();         // 上一片段
vc.playSegments();            // 从第0片开始播放队列
```

### 智能定位

```javascript
// 根据当前视频时间，找到对应的片段并激活
vc.autoFit();   // 如果当前时间在片段A内，激活A；如果在间隙，跳到下一个片段开始
```

### 配置持久化

```javascript
// 导出为可序列化对象
const config = vc.exportConfig();
// => { segments: [{start, end, label}], currentSegment, autoPlayNext }

// 从对象恢复
vc.importConfig(config);
```

### 销毁

```javascript
vc.destroy();   // 暂停、清除定时器、解绑所有事件
```

## 完整实现模板

```javascript
class VideoController {
  constructor(options = {}) {
    this.videos = [];
    this.currentVideo = null;
    this.segments = [];
    this.currentSegment = 0;
    this.isPlaying = false;
    this.intervalId = null;

    this.onTimeUpdate = options.onTimeUpdate || (() => {});
    this.onSegmentEnd = options.onSegmentEnd || (() => {});
    this.onSegmentChange = options.onSegmentChange || (() => {});
    this.onPlayStateChange = options.onPlayStateChange || (() => {});
    this.onVideoChange = options.onVideoChange || (() => {});
    this.autoPlayNext = options.autoPlayNext !== false;
    this.endThreshold = options.endThreshold || 0.1;

    this.findVideos();
  }

  // ========== 发现层 ==========
  findVideos() {
    this.videos = Array.from(document.querySelectorAll('video'));
    if (this.videos.length > 0 && !this.currentVideo) {
      this.setVideo(0);
    }
    return this.videos;
  }

  get videoCount() {
    return this.videos.length;
  }

  setVideo(index) {
    if (index < 0 || index >= this.videos.length) return false;
    this.cleanupVideoListeners();
    this.currentVideo = this.videos[index];
    this.bindTimeUpdate();
    this.onVideoChange(this.currentVideo, index);
    return true;
  }

  get videoInfo() {
    if (!this.currentVideo) return null;
    return {
      duration: this.currentVideo.duration,
      width: this.currentVideo.videoWidth,
      height: this.currentVideo.videoHeight,
      currentTime: this.currentVideo.currentTime
    };
  }

  // ========== 时间层（静态方法）==========
  static parseTimeStr(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return NaN;
    const parts = timeStr.split(':').map(p => parseFloat(p));
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return NaN;
  }

  static formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    }
    return `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }

  static parseTimeRange(rangeStr) {
    const match = rangeStr.match(/([\d:.]+)-([\d:.]+)/);
    if (!match) return null;
    const start = VideoController.parseTimeStr(match[1]);
    const end = VideoController.parseTimeStr(match[2]);
    if (isNaN(start) || isNaN(end) || start >= end) return null;
    return { start, end };
  }

  // ========== 播放层 ==========
  play() {
    if (!this.currentVideo) return Promise.resolve();
    this.isPlaying = true;
    this.onPlayStateChange(true);
    return this.currentVideo.play().catch(() => {});
  }

  pause() {
    if (!this.currentVideo) return;
    this.currentVideo.pause();
    this.isPlaying = false;
    this.onPlayStateChange(false);
  }

  stop() {
    this.pause();
    this.clearEndCheck();
  }

  seekTo(time) {
    if (!this.currentVideo || isNaN(time)) return;
    this.currentVideo.currentTime = Math.max(0, time);
  }

  get currentTime() {
    return this.currentVideo ? this.currentVideo.currentTime : 0;
  }

  // ========== 片段层 ==========
  addSegment(rangeOrObj, label = '') {
    let segment;
    if (typeof rangeOrObj === 'string') {
      segment = VideoController.parseTimeRange(rangeOrObj);
      if (!segment) return false;
    } else {
      segment = { start: rangeOrObj.start, end: rangeOrObj.end };
    }
    if (label) segment.label = label;
    this.segments.push(segment);
    return true;
  }

  setSegments(segments) {
    this.segments = segments.map(s => ({
      start: s.start,
      end: s.end,
      label: s.label || ''
    }));
    this.currentSegment = 0;
  }

  get segmentCount() {
    return this.segments.length;
  }

  playSegment(index) {
    if (index < 0 || index >= this.segments.length) return false;
    this.currentSegment = index;
    const seg = this.segments[index];
    this.seekTo(seg.start);
    this.play();
    this.setupEndCheck(seg);
    this.onSegmentChange(index);
    return true;
  }

  nextSegment() {
    if (this.currentSegment < this.segments.length - 1) {
      return this.playSegment(this.currentSegment + 1);
    }
    return false;
  }

  previousSegment() {
    if (this.currentSegment > 0) {
      return this.playSegment(this.currentSegment - 1);
    }
    return false;
  }

  playSegments() {
    if (this.segments.length === 0) return false;
    return this.playSegment(0);
  }

  autoFit() {
    if (!this.currentVideo || this.segments.length === 0) return false;
    const time = this.currentVideo.currentTime;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (time >= seg.start && time <= seg.end) {
        this.currentSegment = i;
        this.setupEndCheck(seg);
        this.onSegmentChange(i);
        return true;
      }
      if (time < seg.start) {
        this.currentSegment = i;
        this.seekTo(seg.start);
        this.setupEndCheck(seg);
        this.onSegmentChange(i);
        return true;
      }
    }
    return false;
  }

  // ========== 事件层 ==========
  bindTimeUpdate() {
    if (!this.currentVideo) return;
    const handler = () => {
      this.onTimeUpdate(this.currentVideo.currentTime, this.currentSegment);
    };
    this.currentVideo.addEventListener('timeupdate', handler);
    this._timeUpdateHandler = handler;
  }

  cleanupVideoListeners() {
    if (this.currentVideo && this._timeUpdateHandler) {
      this.currentVideo.removeEventListener('timeupdate', this._timeUpdateHandler);
    }
    this._timeUpdateHandler = null;
  }

  setupEndCheck(segment) {
    this.clearEndCheck();
    this.intervalId = setInterval(() => {
      if (!this.currentVideo || !this.isPlaying) {
        this.clearEndCheck();
        return;
      }
      const time = this.currentVideo.currentTime;
      this.onTimeUpdate(time, this.currentSegment);
      if (time >= segment.end - this.endThreshold) {
        this.clearEndCheck();
        this.onSegmentEnd(this.currentSegment, this.currentSegment + 1);
        if (this.autoPlayNext && this.currentSegment < this.segments.length - 1) {
          this.nextSegment();
        } else {
          this.isPlaying = false;
          this.onPlayStateChange(false);
        }
      }
    }, 100);
  }

  clearEndCheck() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // ========== 配置持久化 ==========
  exportConfig() {
    return {
      segments: this.segments,
      currentSegment: this.currentSegment,
      autoPlayNext: this.autoPlayNext
    };
  }

  importConfig(config) {
    if (config.segments) this.segments = config.segments;
    if (config.currentSegment !== undefined) this.currentSegment = config.currentSegment;
    if (config.autoPlayNext !== undefined) this.autoPlayNext = config.autoPlayNext;
  }

  // ========== 销毁 ==========
  destroy() {
    this.stop();
    this.cleanupVideoListeners();
  }
}

export default VideoController;
```

## 使用示例

```javascript
import VideoController from './video-controller.js';

const vc = new VideoController({
  onSegmentChange: (idx) => console.log('切换到片段', idx),
  onSegmentEnd: (ended, next) => console.log(`片段${ended}结束，下一个${next}`)
});

// 添加片段并播放
vc.addSegment('00:01:10-00:01:20', '高潮');
vc.addSegment('00:02:30-00:02:45', '结尾');
vc.playSegments();
```

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 在 `VideoController` 内创建 DOM / UI | API 与 UI 耦合，无法在 headless 环境或不同 UI 框架中复用 | 纯 API 层，UI 由外部消费方实现 |
| 使用 `setInterval` 但不提供 `destroy()` | 页面切换后定时器继续运行，内存泄漏 | `destroy()` 必须清除所有定时器和事件监听 |
| 时间解析失败返回 `null` 但不处理 | 下游代码 `null.start` 抛异常 | `parseTimeRange` 返回 `null` 时，调用方必须判断 |
| 片段结束检测用 `===` 精确匹配 | 100ms 轮询可能跳过精确时间点，导致不触发 | 使用 `>= end - threshold` 提前触发 |
| `play()` 返回值被忽略 | 浏览器自动播放策略阻止时无感知 | `play()` 返回 Promise，必须 `.catch()` |

## 与 UI 层的关系

```
┌─────────────────────────────────────────┐
│  UI Layer（由业务方实现）                  │
│  - 浮动面板 / 控制台界面 / 扩展弹窗         │
│  - 调用 VideoController API               │
├─────────────────────────────────────────┤
│  VideoController（本 Skill）              │
│  - 纯 JS，零 DOM 操作                      │
│  - 通过回调通知外部                         │
└─────────────────────────────────────────┘
```

## 验证清单

- [ ] 零 DOM 创建（`document.createElement` 数量为 0）
- [ ] 提供 `destroy()` 方法，清理所有定时器和监听
- [ ] `play()` 返回 Promise 并处理 rejection
- [ ] 时间解析支持 `MM:SS`、`HH:MM:SS`、纯秒数三种格式
- [ ] 片段结束检测使用 threshold，不依赖精确时间匹配
- [ ] 所有回调在构造时可选，不传时不抛异常
