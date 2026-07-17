---
name: unified-button
description: 当用户要求设置 primary/主按钮样式，或设计按钮组、快捷操作面板，或提到"默认激活状态"、"主按钮高亮"时触发。
---

# 统一按钮激活状态规范

> 原 skill：`unified-button-activation`，已归档为 project-style-ui-ux 的特化 ref。

## 核心原则

**同一操作组内的所有按钮，默认状态必须完全一致，激活/悬浮状态也必须完全一致。不允许用 `primary` 类或其他方式让某一个按钮在视觉上特殊化。**

### 为什么

- 用户浏览操作列表时，视线会自然落在第一个位置，不需要额外的高亮来引导
- `primary` 特殊样式会制造视觉噪音，暗示"其他按钮不重要"
- 在暗色/高对比风格中，一个发光按钮会让其他按钮看起来像"不可用"
- 操作组的每个选项都是独立有效的，不存在"主/次"之分

## 正确做法

```css
/* 所有按钮共享完全相同的默认状态 */
.quick-action-btn {
  background: var(--surface);
  color: var(--text);
  border: 1px solid transparent;
  /* ... 其他样式 */
}

/* 所有按钮共享完全相同的 hover 状态 */
.quick-action-btn:hover {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 0 24px var(--accent-glow);
}
```

```html
<!-- 不要给任何按钮加 primary 类 -->
<button class="quick-action-btn">收集并打开看板</button>
<button class="quick-action-btn">收集其他标签页</button>
<button class="quick-action-btn">打开看板</button>
<button class="quick-action-btn">打开侧边栏</button>
```

## 错误做法

```css
/* 错误：给 primary 单独设置默认高亮 */
.quick-action-btn.primary {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 0 16px var(--accent-glow);
}

/* 错误：只有 primary 才有特殊 hover */
.quick-action-btn.primary:hover {
  background: var(--accent);
}
.quick-action-btn:hover {
  background: var(--surface-hover); /* 其他按钮 hover 效果弱一级 */
}
```

```html
<!-- 错误：给第一个按钮加 primary -->
<button class="quick-action-btn primary">...</button>
<button class="quick-action-btn">...</button>
```

## 例外情况

以下场景**可以**使用 primary/特殊样式：
- 对话框的"确定"与"取消"（二选一决策，用户必须明确主次）
- 表单提交 vs 重置（提交是正向操作，重置是破坏性/回退操作）
- 危险操作（删除、退出）用红色，这是语义色不是主次色

以下场景**不允许**：
- 快捷操作面板/工具栏（所有操作同等重要）
- 导航标签（当前 active 除外，但那是状态不是主次）
- 列表项的操作按钮（编辑/删除/分享等）

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|--------|
| 给操作组第一个按钮加 `primary` 类 | 默认状态下它独自高亮，其他按钮显得不重要 | 所有按钮使用同一个类，通过位置排序暗示优先级 |
| `primary` 默认高亮 + 普通按钮只有微弱 hover | 用户误以为其他按钮不可点或功能较弱 | 所有按钮 hover 效果完全一致 |
| 用 `primary` 区分"常用/不常用" | 用户界面出现不可预测的样式差异 | 常用功能放前面，样式保持统一 |
| 保留 HTML 上的 `primary` 类但 CSS 不处理 | 未来维护者可能恢复 primary 样式，引入回归 | 彻底从 HTML 移除 `primary` 类名 |

## 迁移检查清单

当重构一个已有按钮组时：
- [ ] 检查 HTML 中是否有 `primary`、`main`、`active` 等主次类名
- [ ] 检查 CSS 中是否有 `.btn-primary`、`.btn-main` 等针对单个按钮的特殊规则
- [ ] 把所有按钮的 hover 效果统一为同一套
- [ ] 把所有按钮的默认背景/边框/文字色统一
- [ ] 从 HTML 彻底移除 `primary` 类（不要留空壳）
