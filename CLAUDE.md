# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome browser extension for demonstration and testing purposes. It showcases various browser extension capabilities including word selection translation, OCR with AI-powered image recognition, favorites management, and browser bookmarks integration.

**Key Design Principle**: This is a demo/experimental project for verifying various use cases. Features are often simplified or simulated, though OCR uses a real API.

## Development Commands

```bash
# Load/Reload the extension
# 1. Navigate to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select this directory
# 4. After code changes, click the refresh icon on the extension card

# No build process required - plain HTML/CSS/JS
# Files are loaded directly by Chrome
```

## Architecture

### Component Communication

```
┌─────────────┐     chrome.runtime     ┌──────────────┐
│   Content   │ ◄─────────────────────► │   Background │
│   Script    │      sendMessage       │   (Service   │
│ (content.js)│                         │   Worker)    │
│content-ocr.js│                        └──────────────┘
└─────────────┘                                         │
      │                                                 │ chrome.tabs
      │                                                 ▼
   Web Page                                          ┌──────────┐
      │                                             │  Popup   │
      │                                             │(UI only) │
      ▼                                             └──────────┘
   chrome.storage.local ◄────────────────────────────┘
```

### Key Files

- **manifest.json**: Extension configuration (Manifest V3)
- **background.js**: Service worker, handles context menus, screenshot capture (`captureVisibleTab`), and messages
- **content.js**: Injected into web pages, handles text selection and tooltips
- **content-ocr.js**: OCR functionality including screenshot selection, coordinate adjustment, and GLM-4.5V API calls
- **popup.html/js/css**: Extension popup interface for settings and manual operations
- **favorites/**: User's favorite translations (separate feature module)
- **browser-bookmarks/**: Browser native bookmarks viewer (separate feature module)

### Message Passing

The extension uses `chrome.runtime.sendMessage` and `chrome.runtime.onMessage` for component communication:

- Content script → Background: `performOCR` (with rect coordinates), `updateSettings`, `addToFavorites`
- Popup → Background: `updateSettings`, `updateShortcut`, `clearShortcut`
- Background → Content script: `startOCRSelection`, `closeOCRResult`, `updateShortcut`, `clearShortcut`

### Storage Schema

Uses `chrome.storage.local` for:

```javascript
{
  // Favorites list (up to 200 items)
  favorites: Array<{text, url, timestamp}>,

  // User settings
  settings: {
    autoTranslate: boolean,
    showContextMenu: boolean
  },

  // Translation statistics
  statistics: {
    todayCount: number,
    totalCount: number,
    lastUpdateDate: string
  },

  // OCR settings
  ocrSettings: {
    prompt: string,        // Recognition prompt
    stream: boolean        // Use streaming API
  },

  // OCR keyboard shortcut (customizable)
  ocrShortcut: {
    ctrlKey: boolean,
    altKey: boolean,
    shiftKey: boolean,
    metaKey: boolean,
    key: string
  }
}
```

## OCR Feature Architecture

### Screenshot Capture Flow

The OCR feature uses a two-stage capture process:

1. **User Selection**: User drags mouse to select region on webpage
2. **Screenshot Capture**: Background captures full tab via `chrome.tabs.captureVisibleTab()`
3. **Coordinate Adjustment**: Content script adjusts coordinates for scaling factors
4. **Image Cropping**: Content script crops the full screenshot using canvas
5. **API Call**: Send cropped image (base64) to GLM-4.5V API

### Critical: Coordinate System Adjustment

**Why it's needed**: Mouse coordinates are in CSS pixels, but `captureVisibleTab` returns physical pixels. Additionally, some websites apply CSS transforms, zoom, or have browser zoom, creating coordinate mismatches.

**Solution** ([content-ocr.js:384-463](content-ocr.js#L384-L463)):
- `detectAndAdjustCoordinates()`: Detects and compensates for:
  - CSS `transform` matrix (extracts scale factors)
  - CSS `zoom` property
  - Browser zoom level (using test element method)
  - `devicePixelRatio`
- Adjusts coordinates to match screenshot coordinate system

**When troubleshooting offset issues**:
- Check console for "检测到页面缩放" messages
- Some websites (e.g., Zhihu) have CSS transforms that require adjustment
- The adjustment is applied automatically before calling `performOCR()`

### API Configuration

OCR uses GLM-4.5V (智谱 AI) - OpenAI-compatible API:

```javascript
const API_CONFIG = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: 'd237351671da318126fb5bd2f1372a08.EdkVfX8wE0JtcZpP',
  model: 'glm-4.5v'
};
```

**Request format**:
- `stream: true` → Returns Server-Sent Events (SSE)
- `stream: false` → Returns complete JSON response
- Image sent as base64 (without `data:image/png;base64,` prefix)

## Keyboard Shortcut System

### Registration Flow

1. **Setting** ([popup.js:295-441](popup.js#L295-L441)):
   - User clicks shortcut input in popup
   - Popup enters "recording" mode (green pulse animation)
   - User presses key combination
   - Shortcut saved to `chrome.storage.local`
   - All tabs notified via `chrome.tabs.sendMessage`

2. **Execution** ([content-ocr.js:857-887](content-ocr.js#L857-L887)):
   - Content script loads shortcut from storage on page load
   - `keydown` listener checks for match with `isShortcutMatch()`
   - On match: prevents default, calls `startSelection()`

**Important**: Shortcuts require at least one modifier key (Ctrl/Alt/Shift/Meta). Content scripts cannot use `chrome.commands` API (only background can), so this uses manual event listening.

## Module Organization

Each major feature should be organized in its own directory:

```
feature-name/
  ├── feature-name.html
  ├── feature-name.js
  └── (feature-name.css if needed)
```

When adding new features:
1. Create a dedicated directory
2. Add HTML/JS to `web_accessible_resources` in manifest.json
3. Add entry point in popup.html with appropriate button
4. Implement navigation function in popup.js using `chrome.runtime.getURL()`

## Design Guidelines

### Theme Colors
- **Primary**: Light gray backgrounds (`#f5f5f5`, `#f8f9fa`, `#6c757d`)
- **NEVER use**: Blue-purple gradients or similar
- Keep UI clean, minimal, and professional

### UI Components
- White containers with subtle shadows
- Rounded corners (8-12px)
- Smooth animations (0.2-0.3s ease)
- Responsive design for mobile compatibility

## Chrome Extension APIs Used

- `chrome.bookmarks`: Access browser bookmarks
- `chrome.contextMenus`: Right-click menu integration
- `chrome.storage.local`: Persistent data storage
- `chrome.tabs`: Create and manage tabs
- `chrome.runtime`: Message passing between components
- `chrome.tabs.captureVisibleTab`: Screenshot capture for OCR

## Content Script Limitations

**Important**: Content scripts run in webpage context and have limited Chrome API access:
- ❌ Cannot access: `chrome.tabs`, `chrome.windows`, `chrome.debugger`
- ✌ Can access: `chrome.runtime.sendMessage`, `chrome.storage.local`, DOM APIs

For operations requiring `chrome.tabs` (like getting tab ID), use `sender.tab.id` in the background script's message handler.

## Feature Modules

### Current Features
1. **Word Selection Translation** (content.js + background.js)
2. **OCR with Screenshot** (content-ocr.js + GLM-4.5V API)
3. **Favorites Management** (favorites/)
4. **Browser Bookmarks** (browser-bookmarks/)

### Adding New Features
1. Create feature directory with HTML/JS files
2. Update manifest.json `web_accessible_resources`
3. Add navigation button in popup.html
4. Add handler function in popup.js
5. Keep modules isolated - each feature should be self-contained

## Notes

- Translation functionality is currently simulated (appends 'x' to text)
- OCR uses real API (GLM-4.5V from 智谱 AI)
- Extension uses Chinese language in UI
- No build tools or bundlers required
- Direct file editing is sufficient for development
