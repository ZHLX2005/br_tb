# Nav Overflow Dropdown — 设计文档

> 模块：TabBoard 顶部导航（nav）
> 日期：2026-07-07
> 状态：待用户最终 review

## 1. 目标

TabBoard 顶部 nav 现在有 7 个按钮：`Time / Board / Rec / Video / LC / Timer / Bili`。在 100% 缩放 + 中等宽度窗口下，按钮组越来越挤。把 `LC / Timer / Bili` 三个收纳到一个 `More ▾` 下拉里，保留 `Time / Board / Rec / Video` 在外层 nav。

不做什么：
- ❌ 不动 `Rec / Video`（它们跳独立页面，跟其他三个 in-page view 性质不同，混在一起语义混乱）
- ❌ 不改 AppShell 模块缓存（fix dc59625 引入）
- ❌ 不引入第三方组件库

## 2. 决策摘要

| 维度 | 决策 |
|---|---|
| 折叠形式 | 下拉气泡（dropdown） |
| 关闭 | 点击外部自动关 + Esc 关 + 选中子项自动关 |
| 选中态 | More 保持 active + 子项高亮（双重指示） |
| 气泡内容 | 名称 + 静态描述（`LC 150` / `Timer 日志` / `Bili 历史`） |
| 视觉 | 白底 + 软阴影 + 行间细分割线 + 右对齐到 More 按钮 |
| 实现技术 | JS 动态注入（不用 HTML `<details>` 原生气泡） |

## 3. 架构

### 3.1 触发流程

```
用户点击 #moreViewBtn
  └─ AppShell._toggleDropdown()
       ├─ 若关 → 打开：注入 DOM 到 nav 同级，绑定子项点击事件
       └─ 若开 → 关闭：移除 DOM

用户点击 .nav-dropdown-item[data-view="xxx"]
  └─ 触发回调 → this.switchView('xxx')
       └─ switchView 末尾：this._closeDropdown()

用户点击页面其它位置（document）
  └─ capture-phase listener 判断 target
       └─ 不在 nav / dropdown 内 → this._closeDropdown()

用户按 Escape
  └─ this._closeDropdown()
```

### 3.2 数据结构

```javascript
// AppShell 类内
this.dropdownItems = [
  { viewName: 'leetcode',        label: 'LC',    desc: '150'  },
  { viewName: 'timer',           label: 'Timer', desc: '日志' },
  { viewName: 'bilibili-history', label: 'Bili',  desc: '历史' },
];
this.dropdownOpen = false;
```

`desc` 是**静态文案**，不联三个视图的实时数据（用户决策）。

### 3.3 模块接口

```javascript
class AppShell {
  // 现有方法保持不变
  _setupViewSwitchButtons()       // +绑定 #moreViewBtn
  switchView(viewName, ...)       // 末尾 +this._closeDropdown()
  _updateViewUI(viewName)         // +viewName ∈ dropdownItems[*].viewName 时 #moreViewBtn.active

  // 新增
  _toggleDropdown()               // 切换开/关
  _openDropdown()                 // 注入 DOM + 绑事件
  _closeDropdown()                // 移除 DOM
  _setupDropdownDismiss()         // document click + Escape 监听（一次性）
  _isDropdownItemView(viewName)   // viewName 是否在 dropdownItems 中
}
```

## 4. 改动清单

### 4.1 `modules/tabboard/tabboard.html`

**删除**：
```html
<button id="leetcodeViewBtn" class="nav-btn" title="LeetCode 150">LC</button>
<button id="timerViewBtn" class="nav-btn" title="时间日志">Timer</button>
<button id="bilibiliHistoryViewBtn" class="nav-btn" title="B 站历史">Bili</button>
```

**新增**（替换 3 个按钮位置）：
```html
<button id="moreViewBtn" class="nav-btn" title="更多视图" aria-haspopup="true" aria-expanded="false">More ▾</button>
```

### 4.2 `modules/tabboard/tabboard.js`

**Imports / 字段**（无新增；用 vanilla JS）。

**constructor**：
```javascript
this.dropdownOpen = false;
this.dropdownItems = [
  { viewName: 'leetcode',        label: 'LC',    desc: '150'  },
  { viewName: 'timer',           label: 'Timer', desc: '日志' },
  { viewName: 'bilibili-history', label: 'Bili',  desc: '历史' },
];
```

**`_setupViewSwitchButtons`** 末尾追加：
```javascript
document.getElementById('moreViewBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  this._toggleDropdown();
});
this._setupDropdownDismiss();
```

**`_setupDropdownDismiss`**（新方法）：
```javascript
_setupDropdownDismiss() {
  document.addEventListener('click', (e) => {
    if (!this.dropdownOpen) return;
    if (e.target.closest('#moreViewBtn, .nav-dropdown')) return;
    this._closeDropdown();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && this.dropdownOpen) this._closeDropdown();
  });
}
```

**`_toggleDropdown`**（新）：
```javascript
_toggleDropdown() {
  this.dropdownOpen ? this._closeDropdown() : this._openDropdown();
}
```

**`_openDropdown`**（新）：
```javascript
_openDropdown() {
  if (this.dropdownOpen) return;
  const moreBtn = document.getElementById('moreViewBtn');
  if (!moreBtn) return;
  // 计算当前 viewName，用于 active 高亮
  const activeView = this.currentView;
  const html = `<div class="nav-dropdown" role="menu">
    ${this.dropdownItems.map(it => `
      <button class="nav-dropdown-item ${activeView === it.viewName ? 'active' : ''}"
              data-view="${it.viewName}" role="menuitem">
        <span class="nav-dropdown-label">${it.label}</span>
        <span class="nav-dropdown-desc">${it.desc}</span>
      </button>`).join('')}
  </div>`;
  // 插到 nav 同级（body 末尾 absolute 定位）
  document.body.insertAdjacentHTML('beforeend', html);
  // 定位
  const dd = document.querySelector('.nav-dropdown');
  if (dd) {
    const rect = moreBtn.getBoundingClientRect();
    dd.style.top = `${rect.bottom + 6}px`;
    dd.style.right = `${window.innerWidth - rect.right}px`;
  }
  // 绑定子项
  document.querySelectorAll('.nav-dropdown-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const view = el.getAttribute('data-view');
      if (view) this.switchView(view);
    });
  });
  this.dropdownOpen = true;
  moreBtn.setAttribute('aria-expanded', 'true');
}
```

**`_closeDropdown`**（新）：
```javascript
_closeDropdown() {
  if (!this.dropdownOpen) return;
  document.querySelectorAll('.nav-dropdown').forEach(el => el.remove());
  this.dropdownOpen = false;
  const moreBtn = document.getElementById('moreViewBtn');
  if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
}
```

**`switchView`** 末尾追加（在 `updateSettings` 之前）：
```javascript
this._closeDropdown();
```

**`_updateViewUI`** 末尾追加：
```javascript
// More 按钮 active 状态：当且仅当当前视图是 dropdown 中某项时
const inDropdown = this.dropdownItems.some(it => it.viewName === viewName);
document.getElementById('moreViewBtn')?.classList.toggle('active', inDropdown);
```

### 4.3 `modules/tabboard/tabboard.css`

新增（约 40 行）：
```css
.nav-dropdown {
  position: fixed;
  background: #ffffff;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12), 0 0 1px rgba(0, 0, 0, 0.08);
  min-width: 160px;
  padding: 4px 0;
  z-index: 10000;
  font-family: inherit;
  font-size: 13px;
}

.nav-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: #1f2328;
  border-bottom: 1px solid #f0f0f0;
  font-family: inherit;
  font-size: 13px;
}

.nav-dropdown-item:last-child {
  border-bottom: none;
}

.nav-dropdown-item:hover {
  background: #f5f7fa;
}

.nav-dropdown-item.active {
  background: #e6f4fb;
  color: #00aeec;
}

.nav-dropdown-label {
  font-weight: 500;
}

.nav-dropdown-desc {
  color: #6b7280;
  font-size: 11px;
}

.nav-dropdown-item.active .nav-dropdown-desc {
  color: #00aeec;
}
```

## 5. 行为验证清单

- [ ] Nav 4 个主按钮（Time / Board / Rec / Video）+ 1 个 More
- [ ] 点击 More：dropdown 出现在 More 下方、右对齐、白底阴影
- [ ] 点击 dropdown 子项 → 切换到对应视图 + dropdown 自动关
- [ ] 点击页面其他地方 → dropdown 自动关
- [ ] 按 Esc → dropdown 关
- [ ] 当视图在 LC/Timer/Bili 时，More 按钮保持 active 态
- [ ] 当视图在 LC/Timer/Bili 时，dropdown 子项 active 态也对应该项
- [ ] module cache 行为不变：dropdown 切换 view 后，状态仍保留
- [ ] 现有 5 个旧按钮（Time/Board/Rec/Video/原 LC/原 Timer/原 Bili）的事件监听器不重复绑定

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| dropdown 元素泄漏：多次开关 DOM 累积 | `_openDropdown` 用 `if (this.dropdownOpen) return;` 守卫；`_closeDropdown` 用 `querySelectorAll` 全清 |
| 点击外部监听与 toggle 事件竞态 | 监听器在 capture 阶段判断 `closest()`；toggle 内的 `e.stopPropagation()` 阻止冒泡 |
| dropdown 定位漂移（页面滚动后） | 每次 `_openDropdown` 重新计算 `getBoundingClientRect` |
| Rec/Video 不在 dropdown —— 避免误折叠 | dropdownItems 硬编码只含 LC/Timer/Bili |
| 视图切换后 dropdown 没关 | `switchView` 末尾强制 `_closeDropdown()` |
| TabBoard 旧 `view-container` 显示残留 | 与本次无关，沿用现有 `_updateViewUI` 行为 |