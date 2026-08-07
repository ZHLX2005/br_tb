# 注入式 UI 里的下拉选择器（Dropdown Picker）— 无法点击的踩坑与解法

> 适用于**自由悬浮圆环（Mode B）**或**ring-stack 面板（Mode A）**里需要"点击标题栏 → 弹出下拉选择器 → 点击选项切换/选择"的场景（如便签页切换器、下拉菜单、选择器）。
>
> 配套 `free-floating-entry.md`（自由圆环 cookbook）和 `draggable-ring.md`（拖动契约）。

## 症状

在注入 UI 里做一个下拉选择器（页面切换器 / 下拉菜单），用户报告：

- "下拉框看不到" / "点开是空的" / "选择器没有加载"
- "点选项没反应" / "点了选不中" / "点一下立刻又关了"

## 三个根因（按出现频率）

### 根因 1：面板 `overflow: hidden` 把下拉框裁剪掉了（看不到）

**症状**：点开下拉框，视觉上什么都没出现。

**原理**：注入面板为了圆角 / 内部滚动常设 `overflow: hidden`。如果下拉框以 `position: absolute` 放在面板内部，且中间没有 `position: relative` 的父级，那么：

- 下拉框的**包含块**是最近的定位祖先 = 面板本身（`position: fixed`）
- `top: 100%` = **面板高度**（不是面板 header 的高度）
- 下拉框渲染在面板底边之下 → 被 `overflow: hidden` **整体裁剪**，完全不可见

```css
/* ❌ 面板里放 absolute 下拉框,必然被裁剪 */
#panel { overflow: hidden; }            /* 面板 */
#panel-header { }                       /* 没设 position,不是包含块 */
#dropdown { position: absolute; top: 100%; }  /* 包含块=面板,top:100%=面板高,被裁 */
```

**正确做法**：下拉框**挂在 `document.body` 层**，`position: fixed`，打开时用触发器 `getBoundingClientRect()` 定位：

```javascript
// ✅ body 级 dropdown:脱离面板,不受 overflow:hidden 裁剪
const picker = document.createElement('div');
picker.className = 'note-page-picker';
document.body.appendChild(picker);      // 不进 panel

function openPicker(triggerEl) {
  const r = triggerEl.getBoundingClientRect();
  picker.style.left = Math.max(8, r.left) + 'px';
  picker.style.top = (r.bottom + 4) + 'px';
  picker.classList.add('open');
}
```

```css
/* ✅ body 级 dropdown 样式:fixed + 高 z-index */
.note-page-picker {
  position: fixed;
  z-index: 1000001;          /* 高于一切宿主 UI */
  width: 300px;
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0,0,0,0.16);
  display: none;
}
.note-page-picker.open { display: block; }
```

### 根因 2：下拉框在拖拽 handle 内 → `setPointerCapture` 劫持点击（点不中）

**症状**：下拉框能看到，但点选项没反应 / 点一下整个面板跟着拖动。

**原理**：自由圆环的面板通常用 header 做拖拽 handle（`pointerdown` → 超过阈值 → 拖动）。如果下拉框放在 header **内部**：

- `pointerdown` 冒泡到 header 的拖拽处理器
- 拖拽处理器排除列表（`button, .switcher, .icon-btn`）**不含下拉框选项** → 误判为拖拽开始 + `setPointerCapture(pid)`
- `setPointerCapture` 把后续 pointer 事件**重定向到 header**，浏览器据此派发 `click` → `e.target` 变成 header（没有 `data-action`）→ 下拉框的选择委托**找不到 action,永不触发**

```javascript
// ❌ 下拉框在 drag-handle 内,drag 捕获点击
handle.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, .switcher, .icon-btn')) return;  // 没排除下拉框!
  handle.setPointerCapture(e.pointerId);  // ← 点击被劫持到 header
});
```

**正确做法**（两条择一）：
1. **下拉框移到 `document.body` 层**（推荐,同时解决根因1）——天然不在拖拽 handle 内
2. 若必须留在 handle 内：**拖拽排除列表必须加上下拉框所有子元素**：

```javascript
// ✅ 排除列表含下拉框全部选项
if (e.target.closest('button, .switcher, .icon-btn, .dropdown, .dropdown-item')) return;
```

### 根因 3：capture 阶段的 outside-click 监听把"点击选项"当"外部点击"（点了立刻关）

**症状**：点开下拉框,再点某个选项,下拉框瞬间消失,选择结果也不生效。

**原理**：注入 UI 常用 `document.addEventListener('click', close, true)`（capture 阶段）实现"点击外部收起"。capture 阶段**先于**目标元素 / 冒泡阶段的所有监听执行。于是：

1. 点开下拉框（触发器在 panel 内,capture 监听跳过 panel 内点击 ✓）
2. 点下拉框选项 → capture 监听先跑 → 发现点在 panel 外（下拉框在 body 层,不在 panel 内）→ **把下拉框关了**
3. 冒泡阶段下拉框的委托才跑 → 选择逻辑执行了,但下拉框已被关掉,用户没看到反馈

**正确做法**：outside-click 监听**必须把下拉框本身也算作"内部"**：

```javascript
// ✅ outside-click 同时判断 panel 和 dropdown
document.addEventListener('click', (e) => {
  if (panel && panel.contains(e.target)) return;
  if (pickerEl && pickerEl.contains(e.target)) return;  // 点下拉框选项不关闭
  pickerEl.classList.remove('open');
}, true);
```

## 完整推荐模式（body 级下拉框）

```
panel (fixed, overflow:hidden)          ← 只装正文内容
├── header (drag-handle)
│   ├── switcher (data-action="toggle") ← 点击开/关下拉框
│   └── actions...
└── body...
dropdown (挂在 document.body, fixed)     ← 与 panel 平级,独立定位
```

- **下拉框独立元素**：`document.body.appendChild(dropdown)`,`position: fixed`,高 z-index
- **打开时定位**：`switcher.getBoundingClientRect()` → 设 `left/top`
- **下拉框自己的事件委托**：绑定在 dropdown 元素上（panel 的委托够不到它）
- **outside-click**：capture 监听同时跳过 panel 和 dropdown 内的点击
- **ESC 收起**：查 `document.querySelector('[data-dropdown]')`

## 反模式表

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 下拉框 `position: absolute` 放面板内,面板 `overflow: hidden` | 包含块=面板,`top:100%`=面板高,整体被裁剪不可见 | 挂 `document.body`,`position: fixed`,触发器 rect 定位 |
| 下拉框在拖拽 handle 内,排除列表不含选项 | `setPointerCapture` 劫持点击 → 选项选不中 | 移到 body 层;或排除列表加 `.dropdown, .dropdown-item` |
| outside-click 用 capture 监听且不判 dropdown | 点选项时 capture 先关下拉框,选择看似无效 | capture 监听同时跳过 panel 和 dropdown 内的点击 |
| 下拉框委托绑在 panel 上（下拉框在 body 层） | panel 委托收不到 body 层下拉框的点击 | 委托绑在 dropdown 元素上 |
| 收起后下拉框还在 DOM,`getElementById` 乱命中 | 多实例残留 | 每次 build/remove 时同步创建/删除下拉框元素 |

## 检查清单

- [ ] 下拉框在 `document.body` 层,`position: fixed`,高 z-index（不被面板 overflow:hidden 裁剪）
- [ ] 打开时用触发器 `getBoundingClientRect()` 定位
- [ ] 下拉框不在拖拽 handle 内（或拖拽排除列表含下拉框所有选项）
- [ ] outside-click（capture）监听跳过 panel + dropdown 内的点击
- [ ] 下拉框自己的事件委托绑在 dropdown 元素上
- [ ] `remove()`/`destroy()` 时同步移除下拉框元素
- [ ] ESC 关闭下拉框（先关下拉框再收起面板）