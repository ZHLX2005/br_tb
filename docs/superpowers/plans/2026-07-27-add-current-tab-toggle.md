# Add-Current-Tab Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `Alt+Shift+A` (and the `addTab` message) from "add if not exists, else no-op" to a toggle — add if absent, remove if present, with distinct toast feedback per branch.

**Architecture:** Split `addTabToGroup` in `background/groups.js` into three atomic functions (`addTabToGroup`, `removeTabFromGroup`, `toggleTabInGroup`). Rewire `addCurrentTabToDefaultGroup` and the `addTab` message handler to call `toggleTabInGroup`. Update the `manifest.json` command description string.

**Tech Stack:** Vanilla JS, Chrome Extension Manifest V3, ES modules, `chrome.storage.local`, `chrome.runtime.sendMessage`. No build system, no test framework — verification is manual via a loaded unpacked extension.

## Global Constraints

- **No new dependencies** — vanilla JS only, jKanban is the only allowed lib and this plan doesn't touch it.
- **Manifest V3** — service worker (ES6 module) style; keep `"type": "module"` in `background`.
- **Message contract compatibility** — the `addTab` message request shape must not change; response may gain fields (`action`) but cannot remove existing (`success`).
- **URL matching:** exact string equality (`t.url === tab.url`) — do NOT switch to `getUrlBase`.
- **Removal scope:** operate only on `tabs[groupId]`; never touch other groups.
- **Storage schema:** unchanged. No migration.
- **File to modify:** `background/groups.js` (primary), `manifest.json` (already changed — do not re-edit).
- **Toast copy (verbatim):**
  - added → title `"已添加"`, message `"已保存到「{groupName}」"`, `showOpenButton: true`, type `"success"`, duration `2000`
  - removed → title `"已移除"`, message `"已从「{groupName}」移除"`, type `"info"`, duration `2000`, no open button
  - noop → title `"标签已存在"`, message `"该标签已在「{groupName}」中"`, type `"info"`, duration `2000` (fallback, unreachable in practice)
- **Commit style:** conventional commits (`feat:`, `refactor:`, `docs:`), end body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Modify:** `background/groups.js`
  - Keep `addTabToGroup` as an atomic "add-only" function (existing behavior).
  - Add `removeTabFromGroup(tab, groupId)` — atomic "remove-only".
  - Add `toggleTabInGroup(tab, groupId)` — composite that returns `'added' | 'removed' | 'noop'`.
  - Change `addCurrentTabToDefaultGroup` to call `toggleTabInGroup` and pick toast per return value.
  - Change the `addTab` message handler to call `toggleTabInGroup` and include the action in response.
  - Export the new functions in the existing export block.
- **No changes to:** `background/commands.js`, `background/index.js`, `manifest.json` (already synced in prior commit `70cdc6d`), any frontend code.

---

### Task 1: Add `removeTabFromGroup` atomic function

**Files:**
- Modify: `background/groups.js` (insert new function between `addTabToGroup` at line ~53 and `addCurrentTabToDefaultGroup` at line ~55)

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: `removeTabFromGroup(tab, groupId): Promise<boolean>` — resolves `true` if a matching tab was removed, `false` if none matched or the group didn't exist. Matches by strict `t.url === tab.url` equality. Writes `tabs` back to `chrome.storage.local`.

- [ ] **Step 1: Read the current file to confirm insertion point**

Read `background/groups.js` to locate the end of `addTabToGroup` (around line 53) and confirm the surrounding blank-line style.

- [ ] **Step 2: Insert `removeTabFromGroup` after `addTabToGroup`**

Add this function immediately after `addTabToGroup`'s closing brace:

```javascript
// 从分组移除标签(精确 URL 匹配)
async function removeTabFromGroup(tab, groupId) {
  if (!tab || !tab.url) return false;

  const result = await chrome.storage.local.get(['tabs']);
  const tabs = result.tabs || {};
  const groupTabs = tabs[groupId];

  if (!Array.isArray(groupTabs) || groupTabs.length === 0) {
    return false;
  }

  const before = groupTabs.length;
  tabs[groupId] = groupTabs.filter(t => t.url !== tab.url);

  if (tabs[groupId].length === before) {
    // 没有匹配项
    return false;
  }

  await chrome.storage.local.set({ tabs });
  return true;
}
```

- [ ] **Step 3: Add `removeTabFromGroup` to the export block**

Locate the existing `export { ... }` block (currently exporting `addCurrentTabToDefaultGroup, addTabToGroup, getDefaultGroupId, openTabboard, setupGroupsListeners`) and add `removeTabFromGroup` to it, keeping alphabetical-ish ordering — insert after `openTabboard`:

```javascript
export {
  addCurrentTabToDefaultGroup,
  addTabToGroup,
  getDefaultGroupId,
  openTabboard,
  removeTabFromGroup,
  setupGroupsListeners
};
```

- [ ] **Step 4: Manual verify — reload extension and inspect service worker console**

- Open `chrome://extensions`, click "reload" on the TabBoard card.
- Open the service worker console (Inspect views: service worker).
- In the console, run:

```javascript
const { tabs } = await chrome.storage.local.get(['tabs']);
console.log('groups with tabs:', Object.keys(tabs));
```

Expected: no errors, groups printed. This confirms the module still loads.

- [ ] **Step 5: Commit**

```bash
git add background/groups.js
git commit -m "refactor(groups): add removeTabFromGroup atomic function

Adds a companion to addTabToGroup that removes by exact URL match,
returning boolean for whether a match was found and removed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add `toggleTabInGroup` composite function

**Files:**
- Modify: `background/groups.js` (insert after `removeTabFromGroup`)

**Interfaces:**
- Consumes: `addTabToGroup(tab, groupId): Promise<boolean>` and `removeTabFromGroup(tab, groupId): Promise<boolean>` from Task 1 and the pre-existing `addTabToGroup`.
- Produces: `toggleTabInGroup(tab, groupId): Promise<'added' | 'removed' | 'noop'>` — tries add first; if add returns `false` (already exists), tries remove; if both return `false` (unreachable in practice, defensive), resolves `'noop'`.

- [ ] **Step 1: Insert `toggleTabInGroup` after `removeTabFromGroup`**

```javascript
// 切换标签在分组中的存在状态:不存在则添加,存在则移除
async function toggleTabInGroup(tab, groupId) {
  const added = await addTabToGroup(tab, groupId);
  if (added) return 'added';

  const removed = await removeTabFromGroup(tab, groupId);
  if (removed) return 'removed';

  return 'noop';
}
```

- [ ] **Step 2: Add `toggleTabInGroup` to the export block**

Update the export block from Task 1 to include `toggleTabInGroup`:

```javascript
export {
  addCurrentTabToDefaultGroup,
  addTabToGroup,
  getDefaultGroupId,
  openTabboard,
  removeTabFromGroup,
  setupGroupsListeners,
  toggleTabInGroup
};
```

- [ ] **Step 3: Manual verify — call from service worker console**

Reload the extension. In the service worker console:

```javascript
// Pick an existing groupId first
const { groups, tabs } = await chrome.storage.local.get(['groups', 'tabs']);
const gid = groups.find(g => g.isDefault)?.id || groups[0].id;

// Import via dynamic import for console testing
const mod = await import(chrome.runtime.getURL('background/groups.js'));

// 1. Add a fresh URL — expect 'added'
console.log(await mod.toggleTabInGroup({ url: 'https://example.com/toggle-test', title: 'Toggle Test' }, gid));

// 2. Call again with same URL — expect 'removed'
console.log(await mod.toggleTabInGroup({ url: 'https://example.com/toggle-test', title: 'Toggle Test' }, gid));

// 3. Third call — expect 'added' again
console.log(await mod.toggleTabInGroup({ url: 'https://example.com/toggle-test', title: 'Toggle Test' }, gid));
```

Expected console output (in order): `added`, `removed`, `added`.

- [ ] **Step 4: Clean up test data**

```javascript
const { tabs } = await chrome.storage.local.get(['tabs']);
for (const g of Object.keys(tabs)) {
  tabs[g] = tabs[g].filter(t => t.url !== 'https://example.com/toggle-test');
}
await chrome.storage.local.set({ tabs });
```

- [ ] **Step 5: Commit**

```bash
git add background/groups.js
git commit -m "feat(groups): add toggleTabInGroup composite function

Wraps addTabToGroup + removeTabFromGroup into an atomic toggle
that returns 'added' | 'removed' | 'noop' so callers can drive
distinct UX feedback per branch.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rewire `addCurrentTabToDefaultGroup` to use toggle

**Files:**
- Modify: `background/groups.js:56-128` (function `addCurrentTabToDefaultGroup`)

**Interfaces:**
- Consumes: `toggleTabInGroup` from Task 2, `getDefaultGroupId`, `showToast` (already imported).
- Produces: no exported signature change — still `addCurrentTabToDefaultGroup()` (fire-and-forget from `commands.js`).

- [ ] **Step 1: Replace the `addTabToGroup` call and toast branches**

Find the tail of `addCurrentTabToDefaultGroup` — the block that currently reads:

```javascript
  const added = await addTabToGroup(tab, defaultGroupId);

  if (added) {
    showToast(tab.id, {
      type: 'success',
      title: '已添加',
      message: `已保存到「${groupName}」`,
      duration: 2000,
      showOpenButton: true
    });
  } else {
    showToast(tab.id, {
      type: 'info',
      title: '标签已存在',
      message: `该标签已在「${groupName}」中`,
      duration: 2000
    });
  }
}
```

Replace with:

```javascript
  const action = await toggleTabInGroup(tab, defaultGroupId);

  if (action === 'added') {
    showToast(tab.id, {
      type: 'success',
      title: '已添加',
      message: `已保存到「${groupName}」`,
      duration: 2000,
      showOpenButton: true
    });
  } else if (action === 'removed') {
    showToast(tab.id, {
      type: 'info',
      title: '已移除',
      message: `已从「${groupName}」移除`,
      duration: 2000
    });
  } else {
    // noop 兜底(实际不可达)
    showToast(tab.id, {
      type: 'info',
      title: '标签已存在',
      message: `该标签已在「${groupName}」中`,
      duration: 2000
    });
  }
}
```

- [ ] **Step 2: Manual verify — hotkey add**

Reload extension. Open a new tab (e.g. `https://example.com/`). Focus that tab. Press `Alt+Shift+A`. Expected: toast titled "已添加" with message `已保存到「<default group name>」`.

- [ ] **Step 3: Manual verify — hotkey remove (toggle)**

Without changing tabs, press `Alt+Shift+A` again on the same page. Expected: toast titled "已移除" with message `已从「<default group name>」移除`. Open the TabBoard (`Alt+Shift+O`) and confirm the tab is no longer in the default group.

- [ ] **Step 4: Manual verify — hotkey add again (round-trip)**

Press `Alt+Shift+A` once more on the same tab. Expected: toast "已添加". Confirm in TabBoard that the tab is back in the default group.

- [ ] **Step 5: Manual verify — special page rejection unchanged**

Focus a `chrome://extensions` tab. Press `Alt+Shift+A`. Expected: no state change to any group; existing "无法添加特殊页面" behavior (this toast is shown via content-script; if the page can't accept the content-script it will silently no-op, which is the current behavior — this is unchanged).

- [ ] **Step 6: Commit**

```bash
git add background/groups.js
git commit -m "feat(hotkey): toggle current tab in default group on Alt+Shift+A

Alt+Shift+A now removes the tab from the default group when it is
already present, instead of showing an 'already exists' notice.
Distinct toast copy for added vs removed branches.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rewire `addTab` message handler to use toggle

**Files:**
- Modify: `background/groups.js:175-180` (the `case 'addTab':` block inside `setupGroupsListeners`)

**Interfaces:**
- Consumes: `toggleTabInGroup` from Task 2, `getDefaultGroupId`.
- Produces: response contract — `{ success: true, action: 'added' | 'removed' | 'noop' }`. `success` field preserved. `action` field is new but additive (existing frontend consumers ignore unknown fields).

- [ ] **Step 1: Replace the addTab handler**

Find the block:

```javascript
        case 'addTab': {
          const defaultId = await getDefaultGroupId();
          await addTabToGroup(request.tab, request.groupId || defaultId);
          sendResponse({ success: true });
          break;
        }
```

Replace with:

```javascript
        case 'addTab': {
          const defaultId = await getDefaultGroupId();
          const targetGroupId = request.groupId || defaultId;
          const action = await toggleTabInGroup(request.tab, targetGroupId);
          sendResponse({ success: true, action });
          break;
        }
```

- [ ] **Step 2: Manual verify — frontend addTab first call adds**

Open the TabBoard page. Open the DevTools console for the TabBoard page. Run:

```javascript
const response1 = await chrome.runtime.sendMessage({
  action: 'addTab',
  tab: { url: 'https://example.com/msg-test', title: 'Msg Test', favIconUrl: '' }
});
console.log(response1);
```

Expected: `{ success: true, action: 'added' }`. Refresh TabBoard — the tab appears in the default group.

- [ ] **Step 3: Manual verify — frontend addTab second call removes**

Immediately run the same command again:

```javascript
const response2 = await chrome.runtime.sendMessage({
  action: 'addTab',
  tab: { url: 'https://example.com/msg-test', title: 'Msg Test', favIconUrl: '' }
});
console.log(response2);
```

Expected: `{ success: true, action: 'removed' }`. Refresh TabBoard — the tab is gone from the default group.

- [ ] **Step 4: Manual verify — non-default target groupId**

Pick a non-default group id from `chrome.storage.local.get(['groups'])`. Run addTab twice with `groupId: <non-default>` — expect `added` then `removed` on that group only, default group untouched.

- [ ] **Step 5: Clean up test data**

```javascript
const { tabs } = await chrome.storage.local.get(['tabs']);
for (const g of Object.keys(tabs)) {
  tabs[g] = tabs[g].filter(t => t.url !== 'https://example.com/msg-test');
}
await chrome.storage.local.set({ tabs });
```

- [ ] **Step 6: Commit**

```bash
git add background/groups.js
git commit -m "feat(msg): addTab message now toggles instead of noop-on-exists

Frontend addTab callers (DataManager) receive the same toggle
semantics as the hotkey path. Response gains an 'action' field
('added' | 'removed' | 'noop') for callers that want to branch
on the outcome; existing consumers reading only 'success' are
unaffected.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full regression pass

**Files:** none modified; verification only.

**Interfaces:** none.

- [ ] **Step 1: Fresh install regression**

Reload the extension. From the popup, click "打开 TabBoard" — confirm the board loads without JS errors in the console.

- [ ] **Step 2: Timeline snapshot regression**

Press `Alt+Shift+C` on a window with 2+ tabs. Confirm the timeline snapshot appears in TabBoard. This exercises `collectCurrentWindowTabs` which is unrelated to toggle changes but shares the same module.

- [ ] **Step 3: Move / delete tab regression**

In TabBoard group view, drag a tab from one group to another. Delete a tab from a group. Confirm both operations still work.

- [ ] **Step 4: Hotkey full flow**

Open 3 distinct URLs. On each:
  - Press `Alt+Shift+A` — toast "已添加"
  - Press `Alt+Shift+A` again — toast "已移除"
  - Press `Alt+Shift+A` a third time — toast "已添加"
Confirm final state in TabBoard: all 3 tabs present in the default group.

- [ ] **Step 5: No default group edge case**

In DevTools console for background service worker:

```javascript
const { groups } = await chrome.storage.local.get(['groups']);
groups.forEach(g => g.isDefault = false);
await chrome.storage.local.set({ groups });
// Now the fallback in getDefaultGroupId returns groups[0].id — still a valid id.
// To hit the *no groups at all* case, empty the array:
await chrome.storage.local.set({ groups: [] });
```

Then press `Alt+Shift+A` on any tab. Expected: toast "添加失败 / 没有找到目标分组". Restore groups afterward via popup or by reloading the extension (init.js re-seeds defaults on install but NOT on plain reload — you may need to manually restore or reinstall to recover).

- [ ] **Step 6: Verify manifest description in `chrome://extensions`**

Go to `chrome://extensions` → TabBoard → keyboard shortcuts icon. Confirm `Alt+Shift+A` line reads: `切换当前标签页在默认分组中的状态（已存在则移除）` (this was set in commit `70cdc6d` — task exists as a verification checkpoint, not a code change).

- [ ] **Step 7: No commit — verification-only task**

If everything passes, mark the task complete. If regressions surface, open a separate issue/task rather than amending prior commits.

---

## Self-Review

**Spec coverage check** (against `docs/superpowers/specs/2026-07-27-add-current-tab-toggle-design.md`):

| Spec requirement | Task |
|---|---|
| Split `addTabToGroup` — atomic add | Pre-existing, verified untouched in Task 1 |
| New `removeTabFromGroup` | Task 1 |
| New `toggleTabInGroup` returning `'added'\|'removed'\|'noop'` | Task 2 |
| `addCurrentTabToDefaultGroup` uses toggle + 3-way toast | Task 3 |
| `addTab` message handler uses toggle + `action` in response | Task 4 |
| URL exact match | Task 1 code uses `t.url !== tab.url` |
| Only target group scoped removal | Task 1 code only touches `tabs[groupId]` |
| Preserve 100-tab cap | Task 1 doesn't touch add path; existing slice logic in `addTabToGroup` unchanged |
| Preserve special-page pre-checks | Task 3 leaves the entire pre-check block untouched |
| Preserve "no default group" error toast | Task 3 leaves that block untouched; Task 5 Step 5 verifies |
| Manifest description sync | Already applied in commit `70cdc6d`; Task 5 Step 6 verifies |
| Toast copy verbatim | Global Constraints section + Task 3 code block |
| Response contract additive-only | Task 4 keeps `success: true` and adds `action` |

No gaps.

**Placeholder scan:** No TBD / TODO / "handle appropriately" / vague test descriptions. Every code step has an exact snippet. Every manual-verify step has an exact expected output.

**Type consistency:**
- `addTabToGroup` returns `Promise<boolean>` — consumed by `toggleTabInGroup` as boolean. ✓
- `removeTabFromGroup` returns `Promise<boolean>` — same. ✓
- `toggleTabInGroup` returns `Promise<'added'|'removed'|'noop'>` — Task 3 and Task 4 both branch on the same three string literals. ✓
- Toast object shape (`type`, `title`, `message`, `duration`, `showOpenButton`) matches existing `showToast` usage in the file. ✓
- Response shape `{ success: true, action }` compatible with existing `{ success: true }`. ✓

Plan is internally consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-add-current-tab-toggle.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
