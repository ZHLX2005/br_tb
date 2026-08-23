# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TabBoard is a Chrome extension for tab management, similar to OneTab but with enhanced features. It uses a modular architecture with separate views for timeline snapshots and kanban-style group management. Includes a **Recording** feature that automatically captures browsing sessions.

**Key technologies:** Vanilla JavaScript, Chrome Extension Manifest V3, jKanban library

**No build system required** - This is a vanilla JS extension that loads directly in the browser.

## Architecture

### Entry Points

- **`background/index.js`** - Service worker (ES6 module) that handles keyboard shortcuts, tab collection, and storage operations
- **`modules/tabboard/tabboard.js`** - Main app entry point (loaded when view)
- **`popup/popup user opens the board.html`** - Browser action popup
- **`content/content.js`** - Content script injected into web pages

### Background Modules (`background/`)

The background service worker has been refactored into ES6 modules:

1. **`index.js`** - Main entry point, initializes all modules
2. **`commands.js`** - Keyboard shortcut command handlers
3. **`groups.js`** - Group and tab management (add, move, delete, sort)
4. **`timeline.js`** - Timeline/snapshot collection and restoration
5. **`recording.js`** - Session recording feature (auto-capture tabs)
6. **`init.js`** - Default data initialization and settings listeners
7. **`utils.js`** - Shared utilities (generateId, showToast, etc.)

### Core Modules (`modules/tabboard/core/`)

1. **DataManager.js** - Centralized data management, handles chrome.storage.local operations via message passing to background
2. **TimelineView.js** - Timeline/snapshot view for collected tabs
3. **GroupView.js** - Kanban-style drag-and-drop board for organizing tabs into groups
4. **EventManager.js** - Coordinates view switching and global events
5. **Utils.js** - Shared utilities (formatSnapshotTime, escapeHtml, exportData, importData)

### Recording Modules (`modules/recording/`)

1. **recording.js** - Frontend controller for recording view
2. **recording.html** - Recording page UI
3. **recording.css** - Recording page styles

### Data Flow

```
User Action → View Component → DataManager.sendMessage()
    → chrome.runtime.sendMessage() → background/* (module switch case)
    → chrome.storage.local.get/set → storage update
    → View re-renders with fresh data via DataManager.loadData()
```

### Storage Schema (`chrome.storage.local`)

```javascript
{
  groups: [
    {
      id: string,
      name: string,
      color: string,
      isDefault: boolean,
      // 标记字段(goto / inFocusSearch / visible 是 group 的属性,
      // 通过 background/group-model.js 统一读写,详见下方"Group 数据访问规约")
      goto: boolean,
      inFocusSearch: boolean,
      visible: boolean
    }
  ],
  tabs: {
    [groupId]: [
      { id: string, title: string, url: string, favicon: string, timestamp: string, visitCount: number, lastVisit: string }
    ]
  },
  timelineSnapshots: [
    { id: string, timestamp: string, tabs: [{ id, title, url, favicon, marked: boolean }] }
  ],
  recordings: [
    { id: string, name: string, startTime: string, endTime: string, tabs: [{ id, title, url, favicon, timestamp }] }
  ],
  recordingState: {
    isRecording: boolean,
    recordingId: string | null,
    recordingName: string,
    startTime: string | null,
    tabCount: number
  },
  settings: {
    closeAfterCollect: boolean,
    closeAfterRestore: boolean,
    excludeEdgeUrls: boolean,
    lastView: 'timeline' | 'group'
    // 注:历史版本曾有 visibleGroups / focusSearchGroups,
    // 已迁移为 group.visible / group.inFocusSearch(由 group-model.ensureGroupDefaults 一次性迁移)
  }
}
```

## Message Protocol

All communication between frontend and background uses `chrome.runtime.sendMessage()` with an `action` property:

**Group Management:**
- `getGroups` - Get all groups
- `addGroup` - Create new group (name, color). 新 group 默认 visible: true、goto: false、inFocusSearch: false
- `deleteGroup` - Delete group and its tabs. 标记属性随 group 对象一起删除,无需清理 settings
- `setDefaultGroup` - Set default group for quick-add
- `updateGroupName` - Rename a group
- `clearAllGroups` - Empty all groups (保留分组结构,清空 tabs)
- `importGroupsAndTabs` - Replace all data
- `updateBoardOrder` - Reorder groups
- `setGroupAsGoto` - Toggle group.goto (影响 goto 圆环源)
- `toggleGroupFocusSearch` - 设置 group.inFocusSearch (groupId, value)
- `setGroupsVisibility` - 批量设置可见性 (visibleGroupIds: string[])
- `getGotoMenuData` - 返回 goto=true 的 group + 各自前 6 个 tab 的结构化数据(给 content/inject/goto 用)

**Tab Operations:**
- `addTab` - Add tab to group (tab, groupId)
- `moveTab` - Move tab between groups (fromGroup, toGroup, tabId, afterTabId)
- `deleteTab` - Delete tab from group
- `openTab` - Open tab in new window
- `openGroup` - Open all tabs in a group
- `incrementVisitCount` - Track tab visits (used by content script)
- `sortTabsByVisitCount` - Sort all groups by visit count

**Timeline/Snapshot Operations:**
- `getTimelineTabs` - Get all snapshots
- `deleteTimelineSnapshot` - Delete single snapshot
- `restoreSnapshot` - Open all tabs in snapshot
- `importTimelineSnapshots` - Merge snapshots from export
- `toggleTabMark` - Toggle marked status on snapshot tabs
- `extractMarkedAsGroup` - Extract marked tabs to new group, clear snapshots

**Recording Operations:**
- `getRecordingState` - Get current recording status
- `getRecordings` - Get all saved recordings
- `startRecording` - Start a new recording session
- `stopRecording` - Stop current recording
- `deleteRecording` - Delete a recording
- `renameRecording` - Rename a recording
- `openRecording` - Open all tabs in a recording
- `openRecordingPage` - Open the recording management page

**Other:**
- `openTabboard` - Open the TabBoard page

## Keyboard Shortcuts

- `Alt+Shift+A` - Add current tab to default group
- `Alt+Shift+C` - Collect all tabs in current window to timeline snapshot
- `Alt+Shift+X` - Collect all tabs except current page (new feature)
- `Alt+Shift+O` - Open TabBoard

## Group Data Access Contract

> **规约:** `groups` / `tabs` 是 group 域的底层数据结构。任何模块(background / popup / view / content script)对它们的读写,**必须**经过 `background/group-model.js` 导出的程序语言接口,不允许直接 `chrome.storage.local.get/set(['groups'|'tabs'])`。

| 层 | 调用方式 | 入口 |
|---|---|---|
| background 内部(focus.js / goto.js / init.js) | 直接 `import { ... } from './group-model.js'` | 函数调用,无消息往返 |
| 前端(popup / tabboard view / content script) | 发消息 → `background/groups.js` 适配层 → 调 model | `chrome.runtime.sendMessage({ action, ... })` |

**违反情形自动失效:** 之前 goto content script 直接 `chrome.storage.local.get(['groups'])`、focus.js 自己建 History 分组直接 `chrome.storage.local.set({ groups })`、view.js 用通用 `updateSettings` 做 settings.read-modify-write —— 这些分散写法都已收敛到 model + 专用消息(`toggleGroupFocusSearch` / `setGroupsVisibility` / `getGotoMenuData`)。

**新增 group 标记(如未来的 `pinned` / `archived`)** 应该:
1. 加到 `group-model.createGroup` 默认值的字段列表
2. 在 `ensureGroupDefaults` 的迁移循环里给老 group 补默认值
3. 导出专用 setter(`setGroupPinned` 等),不要用 `updateSettings` 走通用 settings 路径

## Development Workflow

**Loading the extension:**
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this repository's root directory

**Reloading after changes:**
- Background script: Click refresh icon on extension card
- Frontend modules: Refresh the TabBoard page (F5)

**No build process** - Changes to `.js` files take effect immediately after reload.

## Known Issues & Technical Debt

1. **Performance:** Visit count tracking has O(n²) complexity when searching all groups. Consider building an index for URL lookups.

2. **Storage limits:** Each group is limited to 100 tabs, and timeline is limited to 50 snapshots.

## Important Constraints

- **No external dependencies** besides jKanban library (already included)
- **Manifest V3** - Uses service worker, not background pages
- **Chrome storage API** - All data persisted locally, no server backend
- **Message passing is async** - Always await/sendResponse properly in background modules
- **ES6 Modules** - Background uses ES6 module syntax with `"type": "module"` in manifest

## Testing the Extension

1. Load extension in Chrome
2. Open a few tabs
3. Press `Alt+Shift+C` to collect tabs (creates timeline snapshot)
4. Press `Alt+Shift+X` to test collecting other tabs (keeps current page)
5. Press `Alt+Shift+O` to open TabBoard
6. Test view switching (timeline vs group view)
7. Test drag-and-drop between groups
8. Test right-click context menu on timeline tabs for marking important tabs
9. Test recording feature: start recording, browse, stop recording, review captured tabs
