/**
 * Shared Storage Module
 * Lightweight wrapper for chrome.storage and chrome.runtime messaging.
 * No in-memory cache — each page loads fresh data on init.
 */

export async function loadData() {
  const data = await chrome.storage.local.get([
    'groups', 'tabs', 'timelineSnapshots', 'settings', 'recordings', 'recordingState'
  ]);

  return {
    groups: data.groups || [],
    tabs: data.tabs || {},
    timelineSnapshots: data.timelineSnapshots || [],
    settings: data.settings || {},
    recordings: data.recordings || [],
    recordingState: data.recordingState || {
      isRecording: false,
      recordingId: null,
      recordingName: '',
      startTime: null,
      tabCount: 0
    }
  };
}

export async function sendMessage(action, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Storage] Message error:', chrome.runtime.lastError);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: true });
      }
    });
  });
}
