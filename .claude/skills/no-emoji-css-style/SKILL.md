---
name: no-emoji-css-style
description: 当用户要求"移除emoji"、"禁用emoji"、"增强页面质感"但保持高信息密度时触发
---

# 无 Emoji 高信息密度 CSS 设计规范

## 触发条件

用户要求：
- 移除项目中的 emoji 图标
- 禁用 emoji
- 增强整体页面质感
- CSS 样式优化

## 核心原则

### 1. Emoji 移除规则

**保留**：
- 上下箭头 `▶` `▼` （用于折叠/展开）
- 纯文本标签替代所有 emoji

**替换对照表**：
| 原 Emoji | 替换为 |
|---------|--------|
| 📋 📄 📁 🗂️ | 空 span + 背景图标 |
| 🎯 | 文字标签 |
| 🔄 | Refresh |
| ✏️ | Edit |
| 🗑️ | Del |
| 📂 | Open |
| ✅ ⚠️ ❌ | [OK] [i] [X] |
| 🔴 ⚪ | ● ○ |
| 📌 🔍 📥 📤 ⚡ 🎙️ ⚙️ | 空 span |

### 2. 高信息密度设计规范

**间距原则**：
- Header padding: 6-8px 12px
- 卡片 padding: 6-8px
- 按钮 padding: 4px 8-10px
- gap: 4-6px
- 圆角: 4-6px（保持锐利感）

**禁止事项**：
- ❌ 大幅 padding/margin（降低信息密度）
- ❌ 过度圆角（8px 以上）
- ❌ 复杂渐变背景
- ❌ 大面积阴影
- ❌ 大字体、大图标

**正确做法**：
- ✅ 紧凑间距，优先信息密度
- ✅ 微妙阴影（0 1px 3px rgba(0,0,0,0.08)）
- ✅ 细边框 1px solid var(--border)
- ✅ hover 状态用颜色/阴影提示，不改变尺寸

### 3. 质感增强技巧（不牺牲密度）

**配色**：
- 主色: var(--primary) #42a5f5
- 边框: var(--border) #e0e0e0
- 背景: var(--bg) #f5f7fa
- 文字: var(--text) #333

**hover 效果**：
```css
.kanban-item:hover {
  box-shadow: 0 2px 6px rgba(0,0,0,0.1);
  transform: translateY(-1px);  /* 仅1px位移 */
}
```

**分组颜色标题**：
```css
.kanban-board-red .kanban-title-board {
  background: linear-gradient(135deg, rgba(255,107,107,0.08), transparent);
  border-bottom: 2px solid var(--color-red);
}
```

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 过度增大 padding | 信息密度骤降，每屏内容减少 | padding: 4-8px 紧凑设计 |
| 使用大圆角(10px+) | 页面显得臃肿 | 圆角 4-6px |
| 复杂渐变背景 | 视觉干扰，分散注意力 | 简单渐变或纯色 |
| 大面积阴影 | 区块感过强，层次混乱 | 轻阴影，仅 hover 时增强 |
| 替换 emoji 为大图标 | 占用过多空间 | 文字标签或空 span |

## 验证清单

- [ ] 移除了所有 emoji（保留 ▶ ▼）
- [ ] 紧凑间距，padding 不超过 8-10px
- [ ] 圆角不超过 6px
- [ ] hover 效果仅 transform + 轻微阴影
- [ ] 页面可显示足够信息量
- [ ] 用户测试确认信息密度合适

## 快速参考

```css
/* 推荐配置 */
:root {
  --primary: #42a5f5;
  --primary-light: #e3f2fd;
  --text: #333;
  --text-light: #666;
  --border: #e0e0e0;
  --bg: #f5f7fa;
}

.btn { padding: 5px 10px; border-radius: 4px; }
.card { padding: 8px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.item:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.1); transform: translateY(-1px); }
```
