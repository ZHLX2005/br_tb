---
name: neo-brutalism-ui
description: 当用户要求实现新粗野主义/Neo-Brutalism/Neubrutalism UI风格，或要求bold风格、黑色粗边框、硬阴影、纯色填充的UI设计时触发。
---

# Neo-Brutalism UI 设计 Skill

## 风格定义

Neo-Brutalism（新粗野主义）是一种 2020 年代兴起的前端视觉风格，融合了 90 年代早期网页的原始感与现代设计的可用性。核心特征：高对比、强边界、物理触感。

## 核心视觉原则（不可省略）

| 要素 | 规范 | 禁止 |
|------|------|------|
| **边框** | `2px solid #000` 统一粗细，所有可交互元素必须有 | 渐变边框、无边框按钮 |
| **阴影** | 硬偏移阴影 `box-shadow: 3px 3px 0 #000`，无模糊 | `blur` 值 > 0 的柔和阴影 |
| **圆角** | `0px` 或最多 `2px`，保持几何感 | 大于 4px 的圆角 |
| **填充** | 纯色块，高饱和度 | 任何渐变（linear-gradient, radial-gradient） |
| **字体** | 粗体为主，`font-weight: 600~900` | 细字重、过多字号层级 |
| **背景** | 暖白/米白 `#F7F7F4` 或纯黑 `#111` | 纯白 `#FFF` 长时间刺眼 |

## 交互物理感（必须实现）

```css
.btn {
  border: 2px solid #000;
  box-shadow: 2px 2px 0 #000;
  transition: all 0.1s ease;
}

.btn:hover {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 #000;
}

.btn:active {
  transform: translate(1px, 1px);
  box-shadow: none;
}
```

**原理**：hover 抬起 + 阴影放大 = 吸引点击；active 下沉 + 阴影消失 = 确认按下。

## 推荐配色方案

### Light 主题（默认）

```css
:root {
  --ink: #111111;        /* 边框、深色文字 */
  --paper: #F7F7F4;      /* 页面背景，暖白护眼 */
  --card: #FFFFFF;       /* 卡片背景 */
  --cyan: #00C8FF;       /* 主操作色 */
  --coral: #FF4D6D;      /* 危险/删除 */
  --lime: #C8FF00;       /* 成功/进度 */
  --amber: #FFB800;      /* 警告/强调 */
  --lavender: #B8A9FF;   /* 辅助/标签 */
}
```

### Dark 主题

```css
:root {
  --ink: #FFFFFF;
  --paper: #1A1A1A;
  --card: #222222;
  --cyan: #00E5FF;
  --coral: #FF6B6B;
  --lime: #DFFF00;
  --amber: #FFCC00;
  --lavender: #C4B5FF;
}
```

## 快速复用模板

```css
/* === 基础 === */
* { box-sizing: border-box; }

:root {
  --ink: #111; --paper: #F7F7F4; --card: #FFF;
  --cyan: #00C8FF; --coral: #FF4D6D; --lime: #C8FF00;
  --shadow: 3px 3px 0 #000;
  --shadow-sm: 2px 2px 0 #000;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
               'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: var(--paper);
  color: var(--ink);
}

/* === 按钮 === */
.btn {
  padding: 8px 16px;
  border: 2px solid var(--ink);
  border-radius: 2px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.1s ease;
}
.btn:hover  { transform: translate(-1px,-1px); box-shadow: var(--shadow); }
.btn:active { transform: translate(1px,1px); box-shadow: none; }

.btn-primary   { background: var(--cyan); }
.btn-danger    { background: var(--coral); }
.btn-success   { background: var(--lime); color: var(--ink); }

/* === 卡片 === */
.card {
  background: var(--card);
  border: 2px solid var(--ink);
  border-radius: 2px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
}

/* === 输入框 === */
.input {
  width: 100%;
  padding: 8px 12px;
  border: 2px solid var(--ink);
  border-radius: 2px;
  background: var(--paper);
  font-weight: 500;
  box-shadow: var(--shadow-sm);
}
.input:focus {
  outline: none;
  background: var(--card);
  box-shadow: var(--shadow);
  transform: translate(-1px,-1px);
}

/* === 自定义复选框 === */
input[type="checkbox"] {
  appearance: none;
  width: 18px; height: 18px;
  border: 2px solid var(--ink);
  border-radius: 2px;
  background: var(--card);
  cursor: pointer;
}
input[type="checkbox"]:checked {
  background: var(--lime);
}
input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 4px; top: 1px;
  width: 5px; height: 9px;
  border: solid var(--ink);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
```

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 使用 Google Fonts `@import` | 每次打开 Chrome 扩展 popup 都需网络请求，导致明显卡顿 | 扩展/弹窗场景只用系统字体栈，零外部资源 |
| 使用 `backdrop-filter: blur()` | 低端设备 GPU 开销大，动画掉帧 | 用纯色半透明遮罩替代：`rgba(0,0,0,0.6)` |
| 使用 `linear-gradient` 做进度条 | 破坏纯色原则，显得脏 | 进度条用纯色填充，如 `background: var(--lime)` |
| 圆角超过 `4px` | 失去粗野主义的几何锋利感 | 统一 `0~2px`，或完全直角 |
| 阴影带模糊 `box-shadow: 0 4px 12px rgba(0,0,0,0.15)` | 变成现代柔和风，与粗野主义冲突 | 必须是 `Xpx Ypx 0 #000` 的硬阴影 |
| 使用纯白 `#FFFFFF` 做背景 | 长时间观看刺眼，尤其暗光环境 | 用暖白 `#F7F7F4` 或极浅灰 |

## 性能禁忌

1. **零外部资源**：Chrome 扩展 popup、Electron 窗口、内嵌 iframe 等场景，CSS 不得引用任何网络字体/图片/API
2. **慎用 backdrop-filter**：在列表/表格大量使用时可能触发重绘风暴
3. **transition 只动 transform 和 box-shadow**：不要 transition width/height/margin，避免布局抖动
4. **will-change 不需要**：硬阴影和 transform 在现代浏览器上已高度优化，不需要额外声明

## 何时使用 / 何时不用

**适合**：
- 工具类/效率类扩展（tab 管理、笔记、计算器）
- 年轻用户产品、创意工具
- 需要强视觉记忆点的落地页
- 小尺寸界面（popup、sidebar、widget）

**不适合**：
- 企业后台/SaaS 管理界面（过于 playful）
- 长文阅读场景（边框太多干扰阅读流）
- 需要极专业/严肃气质的金融/法律产品
