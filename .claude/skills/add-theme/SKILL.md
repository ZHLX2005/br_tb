---
name: add-theme
description: |
  TabBoard 新主题添加标准化流程。触发场景：用户说"加个新主题"、"添加主题样式"、"新增主题"、"再写个主题"、"像xxx主题那样加一个"、"主题模板"。
---

# Add Theme — TabBoard 新主题添加标准化流程

## 架构概要

TabBoard 使用 `[data-theme]` CSS 属性选择器方案：**所有主题 CSS 预先加载，通过 `<html data-theme="xxx">` 切换激活哪一组样式**。核心机制在 `popup.js:23-28` 通用化 —— 点击 `.theme-option` → 读 `option.dataset.theme` → 设 `document.documentElement.dataset.theme` → CSS 选择器自动匹配。

## 涉及文件清单

| 文件 | 操作 |
|------|------|
| `popup/themes/<name>.css` | **新建** — 全部样式 |
| `popup/popup.html` | **两处修改** |
| `popup/popup.js` | 无需修改 |
| `background/init.js` | 无需修改 |

## 执行步骤

### Step 1 — 新建 CSS 文件 `popup/themes/<name>.css`

#### 1.1 顶部 CSS 变量块（全部必须定义）

```css
/* <显示名> (<英文标识>) */
[data-theme="<name>"] {
  /* 背景色 */
  --bg-app: <主背景>;
  --bg-surface: <卡片/面板>;
  --bg-subtle: <浅层背景>;
  --bg-subtle-hover: <浅层 hover>;
  --bg-hover: <通用 hover>;
  --bg-nav: <导航栏>;
  --bg-nav-hover: <导航 hover>;
  --bg-overlay: rgba(0,0,0,<透明度>);

  /* 文字色 */
  --text-primary: <主文字>;
  --text-secondary: <次要文字>;
  --text-on-accent: <强调色上的文字>;
  --text-on-nav: <导航文字>;
  --text-on-nav-hover: <导航 hover 文字>;

  /* 语义色 */
  --color-accent: <强调色>;
  --color-accent-hover: <强调 hover>;
  --color-danger: <危险色>;
  --color-danger-hover: <危险 hover>;
  --color-danger-hover-bg: <危险按钮 hover>;
  --color-danger-bg: <危险按钮>;
  --color-success: <成功色>;
  --color-success-hover: <成功 hover>;
  --color-secondary: <辅助色>;

  /* 边框 */
  --border-color: <边框色>;
  --border-width: <边框宽>;
  --border-radius: <圆角>;

  /* 阴影 */
  --shadow-sm: <小阴影>;
  --shadow: <中阴影>;
  --shadow-lg: <大阴影>;

  /* 字体 */
  --font-mono: <等宽字体>;

  /* Layout */
  --body-width: 360px;
  --body-min-height: 480px;
  --page-padding: <页面内边距>;
  --scrollbar-width: <滚动条宽>;

  /* Navigation */
  --nav-height: <导航高>;
  --nav-padding-x: <导航水平内边距>;
  --nav-tab-padding: <标签内边距>;
  --nav-tab-font-weight: <标签字重>;
  --nav-tab-active-bg: <激活标签背景>;
  --nav-tab-active-color: <激活标签色>;
  --nav-tab-active-border: <激活标签边框>;
  --nav-tab-active-shadow: <激活阴影>;
  --nav-tab-active-transform: <激活变换>;
  --nav-tab-active-font-weight: <激活字重>;
  --nav-hover-bg: <标签 hover>;
  --nav-hover-color: <标签 hover 色>;
  --nav-tab-transition: <过渡>;

  /* Buttons */
  --btn-padding: <按钮内边距>;
  --btn-qa-padding: <快捷操作按钮内边距>;

  /* Dialog */
  --dialog-padding: <对话框内边距>;
  --dialog-width: <对话框宽>;
}
```

#### 1.2 组件样式清单（按顺序覆盖以下每一组）

每个选择器都必须以 `[data-theme="<name>"]` 开头。此清单与 `neo-brutalism.css` / `japanese.css` 对齐。

**Buttons**
```
.btn, .btn:hover, .btn:active(可选)
.btn-small, .btn-primary, 它们的:hover
.btn-secondary, .btn-secondary:hover
```

**Quick action buttons**
```
.quick-action-btn, .quick-action-btn:hover, .quick-action-btn:active(可选)
.qa-label(可选)
```

**Group items**
```
.group-item, .group-item:hover
.group-item .group-color
.group-item .group-name
.group-item .group-default-badge
```

**Add to focus**
```
.add-to-focus, .add-to-focus:hover, .add-to-focus:active(可选)
```

**Group action buttons**
```
.group-item .group-actions-buttons button, 它的:hover
.group-item .group-actions-buttons button.delete, 它的:hover
```

**Focus search**
```
.focus-group-item, .focus-group-item:hover
.focus-group-item.enabled
.focus-group-item input[type="checkbox"], 它的:checked, 它的:checked::after
.focus-color-dot
.focus-group-name, .focus-group-count
.focus-group-remove, .focus-group-remove:hover
```

**Settings**
```
.settings-list
.setting-row, .setting-row:hover
.setting-row input[type="checkbox"], 它的:checked, 它的:checked::after
```

**Dialog**
```
.dialog-content (+ @keyframes <ns>-dialogIn)
.dialog-content h3
.form-group label
.input, .input:focus
.color-option, .color-option:hover, .color-option.selected
.empty-state
```

**Video progress** (所有 .vp-* 前缀)
```
.vp-actions-row .btn-secondary, 它的:hover
.vp-settings-row .setting-row
.vp-current-box, .vp-current-title, .vp-current-meta
.vp-current-bar, .vp-current-fill
.vp-current-none, .vp-current-loading
.vp-stats, .vp-stat-value, .vp-stat-label
.vp-overall-bar, .vp-overall-fill
.vp-group, .vp-group-header:hover
.vp-group-color, .vp-group-name, .vp-group-meta
.vp-group-percent, .vp-group-bar, .vp-group-fill, .vp-group-toggle
.vp-video-item:hover
.vp-video-favicon, .vp-video-title
.vp-video-bar, .vp-video-fill
.vp-video-meta, .vp-video-empty
.vp-empty-state, .vp-empty-text, .vp-empty-desc
```

**Recording**
```
.solution-recording
.recording-dot (+ @keyframes <ns>-pulse)
.recording-text, .recording-time, .recording-info
.btn-stop, .btn-stop:hover
```

**Page animation**
```
.page.active (+ @keyframes <ns>-pageIn)
```

**Other**
```
.page-section-title
.focus-hint
.idle-title
.btn-start, .btn-start:hover
```

### Step 2 — 在 HTML 中注册

**修改文件：** `popup/popup.html`

**2.1 `<head>` 中加载 CSS（按字母顺序排列）**

```html
<link rel="stylesheet" href="themes/<name>.css">
```

**2.2 `#themePanel` 中注册选项（按字母顺序排列）**

```html
<div class="theme-option" data-theme="<name>"><显示名></div>
```

### Step 3 — 验证

1. 确认 CSS 文件中**所有选择器都带 `[data-theme="<name>"]` 前缀**
2. 确认所有 `@keyframes` 动画名使用唯一命名空间前缀，不会与其他主题冲突
3. 确认 CSS 变量**全部定义完整**，无遗漏
4. 加载扩展，切换到新主题，检查每个组件区域的样式表现

## 错误案例

| 错误操作 | 后果 | 正确做法 |
|---------|------|---------|
| 漏定义某个 CSS 变量 | 该变量 fallback 到未定义状态，样式断裂 | 按模板逐项填写，不允许缺省 |
| `@keyframes` 未加命名空间前缀 | 与其他主题动画名冲突，动画错乱 | 用 `<ns>-dialogIn`、`<ns>-pulse` 模式 |
| 选择器漏写 `[data-theme="<name>"]` | 样式污染其他主题 | 严格在每个选择器前加前缀 |
| 跳过某个组件区域的样式 | 该区域无样式覆盖，显示错乱 | 对照 1.2 清单逐项覆盖，不允许跳过 |

## 参考

- 默认主题参考：`popup/themes/neo-brutalism.css`（新粗野主义风格，粗边框+重阴影）
- 极简参考：`popup/themes/japanese.css`（细边框+无阴影+暖色调）
- 深色参考：`popup/themes/dark-cockpit.css`（暗色调+发光阴影）
