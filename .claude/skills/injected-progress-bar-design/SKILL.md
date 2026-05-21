---
name: injected-progress-bar-design
description: 当需要设计页面注入型进度条、学习进度面板、状态指示器时触发。总结连续进度条的 UX 心智模型、视觉连续性、高亮策略和 CSS 实现技巧。
---

# Injected Progress Bar — 页面注入型进度条 UX 设计

## 触发条件

- "在页面顶部加进度条"
- "注入进度面板"
- "课程学习进度条"
- "状态指示器设计"
- "页面级进度追踪 UI"

## 核心 UX 原则

### 1. 心智模型匹配：顺序完成

课程/列表型进度条，用户的心智模型是**顺序完成**：
- **前面** = 已完成（默认 100%，不需要精确到 98%）
- **当前** = 进行中（显示实际 watched / duration）
- **后面** = 未开始（灰色遮罩）

```
整体进度 = (前面视频总时长 + 当前视频 watched) / 课程总时长
```

**Why:** 用户学习课程是按顺序的，不会跳着看。精确显示每个视频的具体百分比反而增加认知负担。

### 2. 视觉连续性：统一渐变 > 分段色块

| 方案 | 效果 | 评价 |
|------|------|------|
| 每个 segment 独立纯色 | 色块感强，像仪表盘 | ❌ 不够丝滑 |
| 每个 segment 独立渐变 | 颜色在边界处重复/断层 | ❌ 不连续 |
| **整条 track 统一渐变，segment 只控制遮罩** | 一条流动的彩带 | ✅ 丝滑、通行 |

**实现方式：**
```css
.track {
  background: linear-gradient(90deg, #42a5f5, #4fc3f7, #66bb6a, #81c784);
}
.segment-done { background: transparent; }      /* 露出底层渐变 */
.segment-current { background: transparent; }    /* 露出底层渐变 */
.segment-todo { background: rgba(210,210,210,0.88); } /* 灰色遮罩 */
```

### 3. 高亮策略：柔和 > 突兀

| 方案 | 效果 | 评价 |
|------|------|------|
| 红色/橙色边框 | 像报错、刺眼 | ❌ 不好看 |
| 亮度提升 + 白色光晕 | 呼吸感、自然 | ✅ 柔和 |
| scaleY 上浮 | 层级感、不遮挡 | ✅ 立体 |

**推荐组合：**
```css
.segment-current {
  transform: scaleY(1.25);
  filter: brightness(1.15) drop-shadow(0 0 4px rgba(255,255,255,0.6));
  z-index: 2;
}
```

### 4. 克制与融入

- **高度 6-8px**：足够可见，不抢夺页面注意力
- **固定顶部**：用户随时可见，但 z-index 最大不遮挡交互
- **背景半透明 + 毛玻璃**：`backdrop-filter: blur(4px)` 融入页面
- **悬浮才显示 tooltip**：默认状态极简，悬停才暴露详细信息

## 视觉层次

```
┌─────────────────────────────────────────────────────┐
│ 课程名 | ████████████░░░░░░░░░░ | 45%               │
│         ↑ 已完成（露渐变）   ↑ 未完成（灰遮罩）      │
│         ↑ 当前 segment scaleY(1.25) 白色光晕        │
└─────────────────────────────────────────────────────┘
```

## CSS 实现模板

```javascript
function createProgressBar(segments, currentIndex) {
  const track = document.createElement('div');
  track.style.cssText = `
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: linear-gradient(90deg, #42a5f5, #4fc3f7, #66bb6a, #81c784);
  `;

  const total = segments.reduce((s, v) => s + v.duration, 0);

  segments.forEach((seg, i) => {
    const el = document.createElement('div');
    const width = (seg.duration / total) * 100;
    const isDone = i < currentIndex;
    const isCurrent = i === currentIndex;

    el.style.width = `${width}%`;
    el.style.height = '100%';
    el.style.position = 'relative';
    el.style.transition = 'all 0.3s';

    if (isDone || isCurrent) {
      el.style.background = 'transparent'; // 露出 track 渐变
    } else {
      el.style.background = 'rgba(210,210,210,0.88)'; // 灰色遮罩
    }

    if (isCurrent) {
      el.style.transform = 'scaleY(1.25)';
      el.style.filter = 'brightness(1.15) drop-shadow(0 0 4px rgba(255,255,255,0.6))';
      el.style.zIndex = '2';

      // 当前进度填充
      const fill = document.createElement('div');
      const pct = seg.duration > 0 ? (seg.watched / seg.duration) * 100 : 0;
      fill.style.cssText = `
        position: absolute; left: 0; top: 0; bottom: 0;
        width: ${pct}%;
        background: rgba(102,187,106,0.85);
      `;
      el.appendChild(fill);
    }

    track.appendChild(el);
  });

  return track;
}
```

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 每个 segment 独立设置渐变背景 | 边界处颜色重复/断层，不连续 | track 统一渐变，segment 只控制遮罩/透明 |
| 纵向渐变（从上到下） | 进度条是横向流动的，纵向不符合视觉习惯 | 横向渐变（`90deg` / `to right`） |
| 红色/橙色边框高亮当前项 | 像报错状态，刺眼突兀 | `brightness(1.15) + drop-shadow` 白色光晕 |
| 小圆点表示各视频 | 不像进度条，没有"通行感" | 连续条带，按时长比例切割 |
| 精确显示每个视频的剩余百分比（如 98%） | 增加认知负担，用户默认前面已完成 | 默认前面已完成，只精确当前视频 |
| 高度过大（>20px） | 遮挡页面内容，喧宾夺主 | 6-8px 细条 + 悬浮 tooltip |
| 无遮罩区分已完成/未完成 | 无法一眼看出进度边界 | 未完成部分用灰色半透明遮罩 |

## 设计检查清单

- [ ] 整条进度条使用统一的底层渐变，不是每个 segment 独立渐变
- [ ] 渐变方向是横向（`90deg`），符合从左到右的阅读/进度流动
- [ ] 已完成部分露出底层渐变，未完成部分用灰色遮罩
- [ ] 当前项高亮使用柔和的白色光晕 + 亮度提升，不用红色/橙色边框
- [ ] 高度控制在 6-8px，不干扰页面主体内容
- [ ] 默认状态极简，悬浮 segment 才显示详细信息（tooltip）
- [ ] 整体进度计算采用"前面已完成 + 当前精确"的心智模型
