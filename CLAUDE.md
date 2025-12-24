# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome browser extension for demonstration and testing purposes. It showcases various browser extension capabilities including word selection translation, favorites management, and browser bookmarks integration.

**Key Design Principle**: This is a demo/experimental project for verifying various use cases. Features are often simplified or simulated.

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
└─────────────┘                         └──────────────┘
      │                                         │
      │                                         │ chrome.tabs
      ▼                                         ▼
   Web Page                              ┌──────────┐
                                          │  Popup   │
                                          │(UI only) │
                                          └──────────┘
```

### Key Files

- **manifest.json**: Extension configuration (Manifest V3)
- **background.js**: Service worker, handles context menus, storage, and messages
- **content.js**: Injected into web pages, handles text selection and tooltips
- **popup.html/js**: Extension popup interface for manual operations
- **favorites/**: User's favorite translations (separate feature module)
- **browser-bookmarks/**: Browser native bookmarks viewer (separate feature module)

### Message Passing

The extension uses `chrome.runtime.sendMessage` and `chrome.runtime.onMessage` for component communication:

- Content script → Background: Request translation, save favorites
- Popup → Background: Update statistics, save settings
- Background → Content script: Update settings

### Storage

Uses `chrome.storage.local` for:
- Favorites list (up to 200 items, auto-removes oldest)
- User settings (auto-translate toggle, context menu visibility)
- Translation statistics (daily/total counts)

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
- **Primary**: Light gray backgrounds (`#f5f5f5`, `#f8f9fa`)
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

## Feature Modules

### Current Features
1. **Word Selection Translation** (content.js + background.js)
2. **Favorites Management** (favorites/)
3. **Browser Bookmarks** (browser-bookmarks/)

### Adding New Features
1. Create feature directory with HTML/JS files
2. Update manifest.json `web_accessible_resources`
3. Add navigation button in popup.html
4. Add handler function in popup.js
5. Keep modules isolated - each feature should be self-contained

## Notes

- Translation functionality is currently simulated (appends 'x' to text)
- Extension uses Chinese language in UI
- No build tools or bundlers required
- Direct file editing is sufficient for development
