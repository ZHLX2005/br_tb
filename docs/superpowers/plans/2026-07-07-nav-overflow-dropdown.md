# Nav Overflow Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `More ▾` dropdown button to the TabBoard top nav that consolidates the LC / Timer / Bili buttons into a single expandable popup, preserving all click behavior and `switchView` dispatch semantics.

**Architecture:** Pure JS dynamic injection (no third-party libs). AppShell gains 4 new methods: `_openDropdown`, `_closeDropdown`, `_toggleDropdown`, `_setupDropdownDismiss`, plus state fields `dropdownOpen` and `dropdownItems`. HTML nav loses 3 buttons, gains 1 `#moreViewBtn`. New CSS for `.nav-dropdown` and `.nav-dropdown-item`.

**Tech Stack:** Vanilla JS + ES6 classes (TabBoard AppShell), HTML5 `<button>`/`<div>`, CSS3 (box-shadow, position: fixed).

**Spec:** `docs/superpowers/specs/2026-07-07-nav-overflow-dropdown-design.md`

---

## Global Constraints

- **Zero third-party deps** — no Headless UI, no Flowbite, no Popper
- **Rec / Video stay in top nav** — do NOT push them into the dropdown
- **Module cache preserved** — fix `dc59625` introduced `this.modules = {}` + cache HIT path; this plan must NOT regress it
- **Pure JS dynamic injection** — dropdown DOM is created/destroyed on each open/close, not pre-existing in HTML
- **`currentView` is the source of truth** — used for both More button active state AND dropdown item active state
- **Click-outside dismiss** — must work via `document.addEventListener('click', ...)`, capture phase; toggling more button must not trigger immediate dismiss
- **Esc dismiss** — also wired via `document.addEventListener('keydown', ...)`
- **Each task ends with a commit**

---

## File Structure

```
modules/tabboard/
├── tabboard.html           — modify (3 buttons removed, 1 button added)
├── tabboard.js             — modify (state fields + 4 methods + edits to 3 existing methods)
├── tabboard.css            — modify (add ~40 lines for .nav-dropdown*)
└── (no new files)
```

The dropdown's behavior lives entirely on `AppShell`. CSS lives alongside existing nav styles. HTML changes are minimal.

---

### Task 1: HTML — swap 3 buttons for #moreViewBtn

**Files:**
- Modify: `modules/tabboard/tabboard.html:30-32`

Replace these 3 lines:
```html
<button id="leetcodeViewBtn" class="nav-btn" title="LeetCode 150">LC</button>
<button id="timerViewBtn" class="nav-btn" title="时间日志">Timer</button>
<button id="bilibiliHistoryViewBtn" class="nav-btn" title="B 站历史">Bili</button>
```
with:
```html
<button id="moreViewBtn" class="nav-btn" title="更多视图" aria-haspopup="true" aria-expanded="false">More <span aria-hidden="true">▾</span></button>
```

- [ ] **Step 1: Apply the Edit above**

Use the Edit tool with `old_string` matching the 3-button block and `new_string` matching the single More button. Verify `tabboard.html` no longer contains `leetcodeViewBtn`, `timerViewBtn`, `bilibiliHistoryViewBtn`.

- [ ] **Step 2: Verify HTML structure**

Run: `grep -n "ViewBtn\|moreViewBtn" modules/tabboard/tabboard.html`
Expected: 5 lines (timelineViewBtn, groupViewBtn, recordingViewBtn, videoProgressViewBtn, moreViewBtn) — the original 3 buttons gone, More present.

- [ ] **Step 3: Commit**

```bash
git add modules/tabboard/tabboard.html
git commit -m "feat(nav): 替换 LC/Timer/Bili 三个按钮为 More 按钮（占位 HTML）

行为尚未接入 tabboard.js，仅做 HTML 占位。
配合后续 task 实现 dropdown 行为。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: CSS — add `.nav-dropdown*` styles

**Files:**
- Modify: `modules/tabboard/tabboard.css` (append at end of file)

- [ ] **Step 1: Append dropdown CSS**

Open `modules/tabboard/tabboard.css`, append at the end:

```css
/* Nav overflow dropdown */
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
.nav-dropdown-item:last-child { border-bottom: none; }
.nav-dropdown-item:hover { background: #f5f7fa; }
.nav-dropdown-item.active { background: #e6f4fb; color: #00aeec; }
.nav-dropdown-label { font-weight: 500; }
.nav-dropdown-desc { color: #6b7280; font-size: 11px; }
.nav-dropdown-item.active .nav-dropdown-desc { color: #00aeec; }
```

- [ ] **Step 2: Verify CSS parse**

Run: `wc -l modules/tabboard/tabboard.css` — confirm it grew by ~40 lines from previous baseline.

- [ ] **Step 3: Commit**

```bash
git add modules/tabboard/tabboard.css
git commit -m "feat(nav): dropdown 样式（白底软阴影 + 行间分割 + 右对齐）

CSS 不引第三方组件库，原生属性。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: AppShell — state fields + dropdown items

**Files:**
- Modify: `modules/tabboard/tabboard.js:13-20`

- [ ] **Step 1: Add state fields to constructor**

Replace the current `constructor()` body (lines 13-20):
```javascript
constructor() {
  this.dataManager = new DataManager();
  this.eventBus = new EventBus();
  this.currentModule = null;
  this.currentView = 'timeline';
  this.storageChangeTimer = null;
}
```
with:
```javascript
constructor() {
  this.dataManager = new DataManager();
  this.eventBus = new EventBus();
  this.currentModule = null;
  this.currentView = 'timeline';
  this.storageChangeTimer = null;
  this.dropdownOpen = false;
  this.dropdownItems = [
    { viewName: 'leetcode',         label: 'LC',    desc: '150'  },
    { viewName: 'timer',            label: 'Timer', desc: '日志' },
    { viewName: 'bilibili-history', label: 'Bili',  desc: '历史' },
  ];
}
```

- [ ] **Step 2: Verify `node --check`**

Run: `node --check modules/tabboard/tabboard.js`
Expected: silent (no errors).

- [ ] **Step 3: Commit**

```bash
git add modules/tabboard/tabboard.js
git commit -m "feat(nav): AppShell 增加 dropdown state 与 items 元数据

items 包含 3 项（LC/Timer/Bili），描述字段是静态文案，
不联任何 view 的实时数据。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: AppShell — More button click + dismiss listeners

**Files:**
- Modify: `modules/tabboard/tabboard.js:34-41`

- [ ] **Step 1: Update `_setupViewSwitchButtons`**

Replace the body of `_setupViewSwitchButtons()` (lines 34-41):
```javascript
_setupViewSwitchButtons() {
  document.getElementById('timelineViewBtn')?.addEventListener('click', () => this.switchView('timeline'));
  document.getElementById('groupViewBtn')?.addEventListener('click', () => this.switchView('group'));
  document.getElementById('recordingViewBtn')?.addEventListener('click', () => this._openRecordingPage());
  document.getElementById('videoProgressViewBtn')?.addEventListener('click', () => this._openVideoProgressPage());
  document.getElementById('leetcodeViewBtn')?.addEventListener('click', () => this.switchView('leetcode'));
  document.getElementById('timerViewBtn')?.addEventListener('click', () => this.switchView('timer'));
  document.getElementById('bilibiliHistoryViewBtn')?.addEventListener('click', () => this.switchView('bilibili-history'));
}
```
with:
```javascript
_setupViewSwitchButtons() {
  document.getElementById('timelineViewBtn')?.addEventListener('click', () => this.switchView('timeline'));
  document.getElementById('groupViewBtn')?.addEventListener('click', () => this.switchView('group'));
  document.getElementById('recordingViewBtn')?.addEventListener('click', () => this._openRecordingPage());
  document.getElementById('videoProgressViewBtn')?.addEventListener('click', () => this._openVideoProgressPage());

  const moreBtn = document.getElementById('moreViewBtn');
  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    this._toggleDropdown();
  });
  this._setupDropdownDismiss();
}
```

- [ ] **Step 2: Add `_setupDropdownDismiss` method**

After `_setupViewSwitchButtons()` (i.e. after line 41, before `_setupRefreshButton`), insert:

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

- [ ] **Step 3: Verify `node --check`**

Run: `node --check modules/tabboard/tabboard.js`
Expected: silent.

- [ ] **Step 4: Commit**

```bash
git add modules/tabboard/tabboard.js
git commit -m "feat(nav): More 按钮点击 toggle + document 级 dismiss 监听

- click on #moreViewBtn: toggle dropdown (用 stopPropagation 避免触发 document dismiss)
- click outside (#moreViewBtn / .nav-dropdown): close
- Escape: close

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: AppShell — `_toggleDropdown` + `_openDropdown` + `_closeDropdown`

**Files:**
- Modify: `modules/tabboard/tabboard.js` (append after `_setupDropdownDismiss`)

- [ ] **Step 1: Add 3 dropdown methods**

After the `_setupDropdownDismiss` method (added in Task 4), append:

```javascript
_toggleDropdown() {
  this.dropdownOpen ? this._closeDropdown() : this._openDropdown();
}

_openDropdown() {
  if (this.dropdownOpen) return;
  const moreBtn = document.getElementById('moreViewBtn');
  if (!moreBtn) return;

  const activeView = this.currentView;
  const html = `<div class="nav-dropdown" role="menu">${
    this.dropdownItems.map(it => `
      <button class="nav-dropdown-item ${activeView === it.viewName ? 'active' : ''}"
              data-view="${it.viewName}" role="menuitem">
        <span class="nav-dropdown-label">${it.label}</span>
        <span class="nav-dropdown-desc">${it.desc}</span>
      </button>`).join('')
  }</div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const dd = document.querySelector('.nav-dropdown');
  if (dd) {
    const rect = moreBtn.getBoundingClientRect();
    dd.style.top  = `${rect.bottom + 6}px`;
    dd.style.right = `${window.innerWidth - rect.right}px`;
  }

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

_closeDropdown() {
  if (!this.dropdownOpen) return;
  document.querySelectorAll('.nav-dropdown').forEach(el => el.remove());
  this.dropdownOpen = false;
  document.getElementById('moreViewBtn')?.setAttribute('aria-expanded', 'false');
}
```

- [ ] **Step 2: Verify `node --check`**

Run: `node --check modules/tabboard/tabboard.js`
Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add modules/tabboard/tabboard.js
git commit -m "feat(nav): dropdown 三个核心方法（toggle/open/close）

- _openDropdown: 注入 DOM，定位在 More 下方右对齐，
  当前 view 对应项加 .active，绑定子项 click → switchView
- _closeDropdown: 清 DOM + 更新 aria-expanded
- _toggleDropdown: 状态切换

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: AppShell — wire dropdown into `switchView` and `_updateViewUI`

**Files:**
- Modify: `modules/tabboard/tabboard.js:113-114` (`switchView`末尾) and `modules/tabboard/tabboard.js:130-141` (`_updateViewUI`末尾)

- [ ] **Step 1: Add `_closeDropdown()` to `switchView` end**

Open `tabboard.js`, find the body of `switchView()` method (around lines 67-114). Locate the last lines (before closing `}`):
```javascript
    await this.dataManager.sendMessage('updateSettings', {
      settings: { lastView: viewName }
    });
  }
```
Insert one new line BEFORE the `updateSettings` call:
```javascript
    this._closeDropdown();

    await this.dataManager.sendMessage('updateSettings', {
      settings: { lastView: viewName }
    });
  }
```

- [ ] **Step 2: Add More-button active toggle to `_updateViewUI`**

Find the body of `_updateViewUI()` (around lines 116-141). Add at the very end (after the last `display =` line for `#bilibiliHistoryView`, before the method's closing `}`):

```javascript
    // More 按钮 active 状态：当前 view 属于 dropdown items 时高亮
    const inDropdown = this.dropdownItems.some(it => it.viewName === viewName);
    document.getElementById('moreViewBtn')?.classList.toggle('active', inDropdown);
```

- [ ] **Step 3: Verify `node --check`**

Run: `node --check modules/tabboard/tabboard.js`
Expected: silent.

- [ ] **Step 4: Commit**

```bash
git add modules/tabboard/tabboard.js
git commit -m "feat(nav): switchView 自动关 dropdown + More 按钮 active 同步

- switchView 末尾 _closeDropdown()：保证选中子项后自动关闭
- _updateViewUI 增加 More 按钮 active 判断：
  当前 view ∈ dropdownItems[*].viewName 时，#moreViewBtn 加 .active

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Manual end-to-end smoke test + final commit

**Files:**
- (no code changes — just verify in browser)

- [ ] **Step 1: Reload the extension**

Open `chrome://extensions`, find TabBoard card, click the refresh icon. Also reload any open TabBoard page (F5).

- [ ] **Step 2: Verify nav layout**

Expected: top nav now has 4 buttons + 1 More ▾ button — total 5 buttons. Visually no overlap, no truncation.

- [ ] **Step 3: Verify More open / close / dismiss**

- Click More ▾ → dropdown appears below More, right-aligned, white card with shadow, 3 items.
- Click any item (LC / Timer / Bili) → switches to that view + dropdown closes.
- Click More again → dropdown re-opens.
- Click outside (anywhere on the main panel area) → dropdown closes.
- Click More → opens. Press Esc → closes.

- [ ] **Step 4: Verify More active state + item active state**

- Navigate to LC (via More → LC).
- Click More → dropdown opens. LC item should have light-blue background (`.active`).
- More ▾ button itself should have white background + shadow (`.active`).
- Same for Timer and Bili.

- [ ] **Step 5: Verify no regressions**

- Time / Board / Rec / Video buttons still work normally.
- Module cache (fix dc59625) still preserves state when switching Bili → Group → Bili.
- Browser devtools console shows no errors.

- [ ] **Step 6: Final commit (only if spec/plan adjustments needed; otherwise no commit)**

If any final tweak was needed during smoke test, commit with:
```bash
git add -A
git commit -m "fix(nav): 烟测微调（详见 task-7 报告）"
```

If everything works as-spec'd, skip — no commit needed.

---

## Self-Review

- [x] **Spec coverage**:
  - HTML swap (3 → 1 button) → Task 1 ✓
  - CSS for dropdown → Task 2 ✓
  - AppShell state (`dropdownOpen`, `dropdownItems`) → Task 3 ✓
  - Click outside / Esc dismiss → Task 4 ✓
  - Toggle/open/close methods → Task 5 ✓
  - Wire `switchView` close + `_updateViewUI` active sync → Task 6 ✓
  - End-to-end smoke test → Task 7 ✓
  - Rec/Video stay in top nav (NOT in dropdown) → spec'd constraint, Task 1 only removes LC/Timer/Bili ✓
  - Module cache preserved (dc59625) → not touched by any task ✓

- [x] **Placeholder scan**: No TBD / TODO. Each task has full code blocks where code changes.

- [x] **Type / field consistency**:
  - `this.dropdownItems` field name consistent across Tasks 3, 4, 5, 6
  - `this.dropdownOpen` field name consistent across Tasks 3, 4, 5, 6
  - Method names `_toggleDropdown` / `_openDropdown` / `_closeDropdown` / `_setupDropdownDismiss` consistent across Tasks 4, 5, 6
  - `viewName` strings `'leetcode'`, `'timer'`, `'bilibili-history'` match what `switchView` already handles

**Plan complete and saved to `docs/superpowers/plans/2026-07-07-nav-overflow-dropdown.md`.**