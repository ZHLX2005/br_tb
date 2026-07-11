/**
 * Popup Video Speed Control Module
 * 视频倍速控制 - 全局统一倍速
 */

import { showToast } from './utils.js';

const STORAGE_KEY = 'tabboard_global_video_speed';

/**
 * 加载全局倍速设置
 */
export async function loadVideoSpeedSetting() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const speed = result[STORAGE_KEY] ?? 1;
    updateSpeedUI(speed);
  } catch (err) {
    console.error('[Popup] Failed to load video speed:', err);
  }
}

/**
 * 更新 UI 显示当前倍速
 */
function updateSpeedUI(speed) {
  // 更新预设按钮选中状态
  document.querySelectorAll('.vp-speed-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
  });

  // 更新自定义输入框
  const customInput = document.getElementById('vpSpeedCustom');
  if (customInput) {
    customInput.value = speed;
  }
}

/**
 * 设置全局视频倍速
 */
async function setVideoSpeed(speed) {
  try {
    // 保存到 storage
    await chrome.storage.local.set({ [STORAGE_KEY]: speed });

    // 通知当前活动标签页
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (activeTab) {
      try {
        await chrome.tabs.sendMessage(activeTab.id, {
          action: 'setVideoSpeed',
          speed: speed
        });
      } catch (e) {
        // Content script 可能未加载或页面不支持，忽略
      }
    }

    // 更新 UI
    updateSpeedUI(speed);

    const label = speed === 1 ? '正常' : `${speed}x`;
    showToast(document.querySelector('.app'), `视频倍速已设置为 ${label}`, 'success');

  } catch (err) {
    console.error('[Popup] Failed to set video speed:', err);
    showToast(document.querySelector('.app'), '设置倍速失败', 'error');
  }
}

/**
 * 绑定倍速控制事件
 */
export function bindVideoSpeedEvents() {
  // 预设按钮点击
  document.querySelectorAll('.vp-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.dataset.speed);
      setVideoSpeed(speed);
    });
  });

  // 自定义速度应用按钮
  const applyBtn = document.getElementById('vpSpeedApplyBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const input = document.getElementById('vpSpeedCustom');
      if (input) {
        let speed = parseFloat(input.value);
        speed = Math.max(0.25, Math.min(4, speed));
        speed = Math.round(speed * 4) / 4;
        input.value = speed;
        setVideoSpeed(speed);
      }
    });
  }

  // 回车键触发应用
  const customInput = document.getElementById('vpSpeedCustom');
  if (customInput) {
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let speed = parseFloat(customInput.value);
        speed = Math.max(0.25, Math.min(4, speed));
        speed = Math.round(speed * 4) / 4;
        customInput.value = speed;
        setVideoSpeed(speed);
      }
    });
  }
}

/**
 * 初始化视频倍速控制
 */
export async function initVideoSpeedControl() {
  await loadVideoSpeedSetting();
  bindVideoSpeedEvents();

  // 监听来自 content script 的消息
  window.addEventListener('message', (event) => {
    if (event.data.type === 'TABBOARD_VIDEO_SPEED_CHANGED') {
      updateSpeedUI(event.data.speed);
    }
  });
}
