# Project Index: TabBoard Chrome Extension

Generated: 2026-04-15

## Project Structure

```
test_feature/
├── background/                    # Chrome Extension Service Worker (ES6 modules)
│   ├── index.js                  # Main entry - initializes all modules
│   ├── commands.js               # Keyboard shortcut handlers (Alt+Shift+A/C/O/S)
│   ├── groups.js                 # Group & tab CRUD
│   ├── focus.js                  # Focus search API (getAllOpenTabs, addToHistoryGroup, focusSearchSwitchTab)
│   ├── timeline.js               # Snapshot collection & restoration
│   ├── recording.js              # Session recording feature
│   ├── init.js                   # Default data init, settings listeners
│   └── utils.js                  # generateId, showToast, getUrlBase
├── content/                     # Content scripts (injected into all pages)
│   ├── content.js               # Main content script (visit count tracking)
│   ├── focus-search.js          # Focus shortcut overlay (Alt+Shift+S)
│   └── focus-search.css         # Focus overlay styles
├── modules/
│   ├── tabboard/                # TabBoard main view
│   │   ├── tabboard.html        # Main app HTML
│   │   ├── tabboard.js         # App entry point
│   │   ├── tabboard.css        # Main styles
│   │   ├── core/
│   │   │   ├── DataManager.js  # Centralized data management (singleton)
│   │   │   ├── TimelineView.js # Timeline/snapshot view
│   │   │   ├── GroupView.js    # Kanban drag-drop board (jKanban)
│   │   │   ├── EventManager.js # View switching & global events
│   │   │   └── Utils.js        # formatSnapshotTime, escapeHtml, export/import
│   │   └── lib/
│   │       ├── jkanban.min.js  # Kanban board library
│   │       └── jkanban.min.css
│   └── recording/               # Recording feature
│       ├── recording.html
│       ├── recording.js
│       └── recording.css
├── popup/                       # Browser action popup
│   ├── popup.html               # Tabbed UI (快捷操作/分组管理/专注搜索/设置)
│   ├── popup.js                 # Tab switching, group management, settings
│   ├── popup.css                # Hover-expand nav styles
│   └── popup-solution.js        # Recording UI in popup
├── sidepanel/                   # Side panel view
│   ├── sidepanel.html
│   ├── sidepanel.js
│   └── sidepanel.css
├── shared/                      # Shared utilities
│   ├── ModalDialog.js           # Modal dialog component
│   ├── ModalDialog.css
│   └── ModalDialog.global.js
└── manifest.json               # Extension manifest (MV3)
```

## Entry Points

- **Service Worker**: `background/index.js` — initializes all background modules
- **TabBoard View**: `modules/tabboard/tabboard.html` — main kanban UI
- **Side Panel**: `sidepanel/sidepanel.html` — side panel UI
- **Popup**: `popup/popup.html` — browser action popup with 4 tabs
- **Content Script**: `content/content.js` — injected into all pages
- **Focus Search**: `content/focus-search.js` — Alt+Shift+S overlay (dynamic injection)

## Keyboard Shortcuts (4 commands max)

| Shortcut | Action |
|----------|--------|
| Alt+Shift+A | Add current tab to default group |
| Alt+Shift+C | Collect all tabs to timeline snapshot |
| Alt+Shift+O | Open TabBoard |
| Alt+Shift+S | Open focus search overlay |

## Message Protocol (action → handler)

**Group Management** (`groups.js`): `getGroups`, `addGroup`, `deleteGroup`, `setDefaultGroup`, `updateGroupName`, `clearAllGroups`, `importGroupsAndTabs`, `updateBoardOrder`

**Tab Operations** (`groups.js`): `addTab`, `moveTab`, `deleteTab`, `openTab`, `openGroup`, `incrementVisitCount`, `sortTabsByVisitCount`, `getAllOpenTabs`, `focusSearchSwitchTab`, `addToHistoryGroup`

**Timeline** (`timeline.js`): `getTimelineTabs`, `deleteTimelineSnapshot`, `restoreSnapshot`, `importTimelineSnapshots`, `toggleTabMark`, `extractMarkedAsGroup`

**Recording** (`recording.js`): `getRecordingState`, `getRecordings`, `startRecording`, `stopRecording`, `deleteRecording`, `renameRecording`, `openRecording`, `openRecordingPage`

## Storage Schema

```javascript
{
  groups: [{ id, name, color, isDefault }],
  tabs: { [groupId]: [{ id, title, url, favicon, timestamp, visitCount, lastVisit }] },
  timelineSnapshots: [{ id, timestamp, tabs: [{ id, title, url, favicon, marked }] }],
  recordings: [{ id, name, startTime, endTime, tabs }],
  recordingState: { isRecording, recordingId, recordingName, startTime, tabCount },
  settings: { closeAfterCollect, closeAfterRestore, excludeEdgeUrls, lastView, visibleGroups, focusSearchGroups }
}
```

## Core Modules

| Module | File | Purpose |
|--------|------|---------|
| DataManager | `modules/tabboard/core/DataManager.js` | Singleton data store, storage.sync, listener pattern |
| GroupView | `modules/tabboard/core/GroupView.js` | jKanban initialization, drag-drop handlers |
| TimelineView | `modules/tabboard/core/TimelineView.js` | Snapshot rendering, mark/restore |
| EventManager | `modules/tabboard/core/EventManager.js` | View switching, event coordination |
| Focus Search | `content/focus-search.js` | Fuzzy search overlay, fuzzyMatchOrdered algorithm |

## Key Algorithms

- **fuzzyMatchOrdered**: Sequential character matching for fuzzy search (reused from timeline.js)
- **scoreTab**: Scoring 0-100 based on exact/prefix/substring/fuzzy match
- **filterAndSortTabs**: Combines fuzzy match + scoring + sorting

## Configuration

- `manifest.json` — MV3, 4 commands, scripting permission, sidePanel
- No build system — vanilla JS loads directly
- ES6 modules in background only (type: "module" in manifest)

## Tech Stack

- Vanilla JavaScript (no framework)
- Chrome Extension Manifest V3
- jKanban library (drag-drop kanban)
- chrome.storage.local (no external backend)
