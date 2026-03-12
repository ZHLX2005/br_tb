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
    { id: string, name: string, color: string, isDefault: boolean }
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
    lastView: 'timeline' | 'group',
    visibleGroups: string[]
  }
}
```

## Message Protocol

All communication between frontend and background uses `chrome.runtime.sendMessage()` with an `action` property:

**Group Management:**
- `getGroups` - Get all groups
- `addGroup` - Create new group (name, color)
- `deleteGroup` - Delete group and its tabs
- `setDefaultGroup` - Set default group for quick-add
- `updateGroupName` - Rename a group
- `clearAllGroups` - Empty all groups
- `importGroupsAndTabs` - Replace all data
- `updateBoardOrder` - Reorder groups

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
