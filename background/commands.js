/**
 * 快捷键命令处理
 */

import { addCurrentTabToDefaultGroup } from './groups.js';
import { collectCurrentWindowTabs, collectOtherTabs, openTabboard } from './timeline.js';

// 快捷键命令处理
export function initCommands() {
  chrome.commands.onCommand.addListener((command) => {
    switch (command) {
      case 'add-current-tab':
        addCurrentTabToDefaultGroup();
        break;
      case 'collect-all-tabs':
        collectCurrentWindowTabs();
        break;
      case 'collect-other-tabs':
        collectOtherTabs();
        break;
      case 'open-tabboard':
        openTabboard();
        break;
      default:
        console.warn('Unknown command:', command);
    }
  });
}
