# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TabBoard is a Chrome extension for tab management, similar to OneTab but with enhanced features. It uses a modular architecture with separate views for timeline snapshots and kanban-style group management.

**Key technologies:** Vanilla JavaScript, Chrome Extension Manifest V3, jKanban library

**No build system required** - This is a vanilla JS extension that loads directly in the browser.

## Architecture

### Entry Points

- **`background.js`** - Service worker that handles keyboard shortcuts, tab collection, and storage operations
- **`modules/tabboard/tabboard.js`** - Main app entry point (loaded when user opens the board view)
- **`popup/popup.html`** - Browser action popup
- **`content/content.js`** - Content script injected into web pages

### Core Modules (`modules/tabboard/core/`)

1. **DataManager.js** - Centralized data management, handles chrome.storage.local operations via message passing to background.js
2. **TimelineView.js** - Timeline/snapshot view for collected tabs
3. **GroupView.js** - Kanban-style drag-and-drop board for organizing tabs into groups
4. **EventManager.js** - Coordinates view switching and global events
5. **Utils.js** - Shared utilities (formatSnapshotTime, escapeHtml, exportData, importData)

### Data Flow

```
User Action → View Component → DataManager.sendMessage()
    → chrome.runtime.sendMessage() → background.js (switch case)
    → chrome.storage.local.get/set → storage update
    → View re-renders with fresh data via DataManager.loadData()
```

### Storage Schema (`chrome.storage.local`)

```javascript
{
  groups: [
    { id: string, name: string, color: string, isDefault: boolean }
  ],
  tabs: {
    [groupId]: [
      { id: string, title: string, url: string, favicon: string, timestamp: string, visitCount: number }
    ]
  },
  timelineSnapshots: [
    { id: string, timestamp: string, tabs: [{ title, url, favicon, marked: boolean }] }
  ],
  settings: {
    closeAfterCollect: boolean,
    closeAfterRestore: boolean,
    excludeEdgeUrls: boolean,
    lastView: 'timeline' | 'group'
  }
}
```

## Message Protocol (background.js)

All communication between frontend and background uses `chrome.runtime.sendMessage()` with an `action` property:

**Group Management:**
- `getGroups` - Get all groups
- `addGroup` - Create new group (name, color)
- `deleteGroup` - Delete group and its tabs
- `setDefaultGroup` - Set default group for quick-add

**Tab Operations:**
- `addTab` - Add tab to group (tab, groupId)
- `moveTab` - Move tab between groups
- `deleteTab` - Delete tab from group
- `openTab` - Open tab in new window
- `openGroup` - Open all tabs in a group
- `visitTab` - Increment visit count (used by content script)

**Timeline/Snapshot Operations:**
- `getTimelineTabs` - Get all snapshots
- `deleteTimelineSnapshot` - Delete single snapshot
- `restoreSnapshot` - Open all tabs in snapshot
- `importTimelineSnapshots` - Merge snapshots from export
- `toggleTabMark` - Toggle marked status on snapshot tabs
- `extractMarkedAsGroup` - Extract marked tabs to new group, clear snapshots

**Other:**
- `clearAllGroups` - Empty all groups
- `importGroupsAndTabs` - Replace all data
- `updateBoardOrder` - Reorder groups

## Keyboard Shortcuts

- `Alt+Shift+A` - Add current tab to default group
- `Alt+Shift+C` - Collect all tabs in current window to timeline snapshot
- `Alt+Shift+O` - Open TabBoard

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

1. **Deprecated API:** `Math.random().toString(36).substr(2, 9)` uses deprecated `substr()`. Should be `substring()`.

2. **Performance:** UV (Unique Visitor) statistics in `background.js:597-620` has O(n²) complexity. Consider building an index for URL lookups.

3. **Duplicate code:** `generateId()` is defined in multiple files (background.js, Utils.js). Should be consolidated.

4. **Missing .gitignore:** Backup files like `*.bak` should be ignored.

## Important Constraints

- **No external dependencies** besides jKanban library (already included)
- **Manifest V3** - Uses service worker, not background pages
- **Chrome storage API** - All data persisted locally, no server backend
- **Message passing is async** - Always await/sendResponse properly in background.js

## Testing the Extension

1. Load extension in Chrome
2. Open a few tabs
3. Press `Alt+Shift+C` to collect tabs (creates timeline snapshot)
4. Press `Alt+Shift+O` to open TabBoard
5. Test view switching (timeline vs group view)
6. Test drag-and-drop between groups
7. Test right-click context menu on timeline tabs for marking important tabs
