---
name: chrome-ext-popup-scrollbar-hide
description: When hiding scrollbars in Chrome extension popups, use scrollbar-width:none on html instead of overflow:hidden or ::-webkit-scrollbar
---

# Chrome 扩展弹窗滚动条隐藏

## 问题根源

Chrome 扩展弹窗在内容超出浏览器最大高度（默认约 600px）时，**浏览器强制在 `html` 视图层添加滚动条**。这个滚动条不属于任何页面元素，而是浏览器 UI 层的一部分。

## 关键限制

- `overflow: hidden` 对 `html` 和 `body` 无效（浏览器弹窗视图层滚动条不受 CSS overflow 控制）
- `::-webkit-scrollbar { width: 0 }` 在 **Chrome 121+ 已移除支持**，不再生效
- `scrollbar-width: none` 是唯一有效的标准方案

## 正确方案

```css
html {
  scrollbar-width: none;
}
```

如果还有其他内部容器的滚动条需要隐藏：

```css
html,
.page-container,
.groups-list {
  scrollbar-width: none;
}
```

## 适用范围

- Chrome 扩展 Manifest V3 popup
- 浏览器弹窗（browserAction / action popup）
- 任何由浏览器强制添加视图层滚动条的场景

## 相关特性

- `scrollbar-width: thin` — 可替代 `none`，显示更细的滚动条
- `scrollbar-color: thumb track` — 替代 `::-webkit-scrollbar-thumb` 和 `::-webkit-scrollbar-track` 为滚动条着色（标准 CSS Scrollbars 规范）

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `html { overflow: hidden; }` | 滚动条依然显示 | 浏览器视图层滚动条不受 overflow 控制 |
| `::-webkit-scrollbar { width: 0; }` | Chrome 121+ 无效 | 使用 `scrollbar-width: none` |
| `body { overflow: hidden; }` | 滚动条依然显示 | 同上 |
| 只在 `.page-container` 设置 `scrollbar-width: none` | 滚动条仍在（在 html 上） | 必须同时设置 `html` |
| `* { scrollbar-width: none }` | 能用但过度 | 精确定位到 `html` 即可 |

## 检测方法

1. 先尝试 `* { scrollbar-width: none }` 确认滚动条能消失
2. 再逐一缩小范围定位具体元素
3. 用 DevTools Elements 面板检查 `html` 元素的计算样式
