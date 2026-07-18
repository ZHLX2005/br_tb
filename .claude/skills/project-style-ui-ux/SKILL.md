
---
name: project-style-ui-ux
description: TabBoard UI/UX 设计规范集合。涵盖视觉风格、按钮规范、进度条交互。当用户为 TabBoard 做界面设计、CSS 样式、交互逻辑时触发。
---
# TabBoard UI/UX 设计规范

## 设计原则

### 风格定位

**无 Emoji + 高信息密度 + Neo-Brutalism 物理感**，三者统一为一个设计语言：

| 要素 | 规范                                                                        | 禁止                     |
| ---- | --------------------------------------------------------------------------- | ------------------------ |
| 边框 | `2px solid #000`（Neo-Brutalism），或 `1px solid var(--border)`（简约） | 无边框、渐变边框         |
| 阴影 | 硬偏移`3px 3px 0 #000`（Neo-Brutalism），或轻阴影 `0 1px 3px`（简约）   | 模糊阴影（扩展场景除外） |
| 圆角 | `0~2px`（Neo-Brutalism），或 `4~6px`（简约）                            | > 6px 圆角               |
| 填充 | 纯色块，高饱和度                                                            | 任何渐变                 |
| 字体 | 粗体为主，`font-weight: 600~900`                                          | 细字重                   |
| 背景 | 暖白`#F7F7F4` 或 `#f5f7fa`，不用纯白 `#FFF`                           | 纯白背景                 |

### Emoji 移除规则

**保留**：上下箭头 `▶` `▼`（折叠/展开）

**替换对照表**：

| 原 Emoji         | 替换为             |
| ---------------- | ------------------ |
| 📋 📄 📁 🗂️    | 空 span + 背景图标 |
| 🎯               | 文字标签           |
| 🔄               | Refresh            |
| ✏️             | Edit               |
| 🗑️             | Del                |
| 📂               | Open               |
| ✅ ⚠️ ❌       | [OK] [i] [X]       |
| 🔴 ⚪            | ● ○              |
| 📌 🔍 📥 📤 ⚙️ | 空 span            |

### 间距规范（高信息密度）

| 位置           | 数值                                   |
| -------------- | -------------------------------------- |
| Header padding | 6-8px 12px                             |
| 卡片 padding   | 6-8px                                  |
| 按钮 padding   | 4px 8-10px                             |
| gap            | 4-6px                                  |
| 圆角           | 4-6px（简约）或 0-2px（Neo-Brutalism） |

### 按钮规范（统一激活状态）

**铁律：同一操作组内的所有按钮，默认状态和 hover 状态必须完全一致，不允许用 `primary` 类让某一个按钮特殊化。**

- ✅ 所有按钮共享同一个类
- ✅ hover 效果完全一致
- ✅ 常用功能放前面暗示优先级
- ❌ 不给任何按钮加 `primary` 类（对话框二选一场景除外）
- ❌ 不做"primary 高亮 + 其他按钮微弱 hover"的分级效果

例外：对话框"确定/取消"、表单"提交/重置"、危险操作（红色语义色）可以用特殊样式。

### 进度条规范（见 [[course-progress]]）

进度条有**上下文模式**和**概览模式**两种互斥逻辑，代码必须完全隔离，不能共享统一函数。

## 决策树：何时使用哪个 Ref

| 场景                                         | 使用                   |
| -------------------------------------------- | ---------------------- |
| 用户要求 bold 风格、粗边框、硬阴影、纯色填充 | →[[neo-brutalism-ui]]                     |
| 设计按钮组、快捷面板、工具栏                 | →[[unified-button]]                     |
| 课程视频进度条、进度可视化                   | →[[course-progress]]                     |
| 整体间距、配色、质感优化                     | 看上方「设计原则」即可 |

## 引用索引

| ref | 何时使用                                         | 路径                           |
| --- | ------------------------------------------------ | ------------------------------ |
| [[neo-brutalism-ui]]    | 用户要求 Neo-Brutalism/bold 风格、硬阴影、粗边框 | references/neo-brutalism-ui.md |
| [[unified-button]]    | 设计按钮组、快捷面板、默认激活状态、主按钮高亮   | references/unified-button.md   |
| [[course-progress]]    | 课程进度条、时间线进度、上下文/概览双模式        | references/course-progress.md  |

## 快速参考

```css
/* === 简约风格配置 === */
:root {
  --primary: #42a5f5;
  --text: #333;
  --text-light: #666;
  --border: #e0e0e0;
  --bg: #f5f7fa;
}
.btn { padding: 5px 10px; border-radius: 4px; }
.card { padding: 8px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.item:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.1); transform: translateY(-1px); }

/* === Neo-Brutalism 风格配置 === */
:root {
  --ink: #111111;
  --paper: #F7F7F4;
  --card: #FFFFFF;
  --cyan: #00C8FF;
  --coral: #FF4D6D;
  --lime: #C8FF00;
  --shadow: 3px 3px 0 #000;
  --shadow-sm: 2px 2px 0 #000;
}
.btn { border: 2px solid var(--ink); border-radius: 2px; box-shadow: var(--shadow-sm); font-weight: 700; }
.btn:hover { transform: translate(-1px,-1px); box-shadow: var(--shadow); }
.btn:active { transform: translate(1px,1px); box-shadow: none; }
```

## 错误案例

| 错误操作                          | 实际后果                  | 正确做法                             |
| --------------------------------- | ------------------------- | ------------------------------------ |
| 给快捷面板第一个按钮加`primary` | 其他按钮显得不重要        | 所有按钮共享同一类，靠位置暗示优先级 |
| 用`linear-gradient` 做背景      | 视觉干扰，破坏简约/粗野感 | 纯色块                               |
| 进度条 tooltip 硬编码 100%        | 用户 hover 发现数据不符   | tooltip 显示真实 watched 比例        |
| 在扩展 popup 中用 Google Fonts    | 每次打开需网络请求，卡顿  | 用系统字体栈                         |

## 性能禁忌（Chrome 扩展场景）

1. **零外部资源**：popup/iframe 场景不引用任何网络字体/图片
2. **慎用 backdrop-filter**：大量使用时可能触发重绘风暴
3. **transition 只动 transform 和 box-shadow**：不 transition width/height/margin
