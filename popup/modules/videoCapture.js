/**
 * Popup Video Capture Module
 * 在 popup 中检测当前页面视频并添加到课程组
 */

import { escapeHtml, showToast } from './utils.js';

/**
 * 检测当前页面视频并处理添加逻辑
 */
export async function captureVideo(container) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab) {
      showToast(container, '无法获取当前标签页', 'error');
      return;
    }

    // 跳过特殊页面
    if (!activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://') || activeTab.url.startsWith('edge://') || activeTab.url === 'about:blank') {
      showToast(container, '当前页面不支持视频检测', 'error');
      return;
    }

    // 向 content script 发送检测请求
    let results;
    try {
      results = await chrome.tabs.sendMessage(activeTab.id, { action: 'detectVideos' });
    } catch (err) {
      showToast(container, '页面未加载完成或不存在视频', 'error');
      return;
    }

    if (!results || !results.videos || results.videos.length === 0) {
      showToast(container, '当前页面未检测到视频', 'warning');
      return;
    }

    const videos = results.videos;

    // 获取课程组列表
    const groupsResponse = await chrome.runtime.sendMessage({ action: 'getVideoGroups' });
    const videoGroups = groupsResponse.success ? (groupsResponse.videoGroups || []) : [];

    if (videoGroups.length === 0) {
      const create = await window.modal.confirm('还没有课程组，是否创建一个？', {
        title: '创建课程',
        confirmText: '创建',
        cancelText: '取消'
      });
      if (create) {
        await createVideoGroup(container);
      }
      return;
    }

    if (videos.length === 1) {
      // 只有一个视频，直接选择课程组
      await addVideoToGroupDialog(container, videos[0], videoGroups);
    } else {
      // 多个视频，先选择视频
      await selectVideoDialog(container, videos, videoGroups);
    }
  } catch (error) {
    showToast(container, '视频检测失败: ' + error.message, 'error');
  }
}

/**
 * 显示视频选择对话框（多个视频时）
 */
async function selectVideoDialog(container, videos, videoGroups) {
  const options = videos.map((v, i) =>
    `${i + 1}. ${v.title || '未命名'} (${formatDuration(v.duration)})`
  ).join('\n');

  const input = await window.modal.prompt(`检测到 ${videos.length} 个视频，请输入编号选择:\n\n${options}`, {
    title: '选择视频',
    defaultValue: '1',
    placeholder: '视频编号',
    confirmText: '下一步',
    cancelText: '取消'
  });

  if (!input) return;

  const index = parseInt(input) - 1;
  if (isNaN(index) || index < 0 || index >= videos.length) {
    showToast(container, '无效的选择', 'error');
    return;
  }

  await addVideoToGroupDialog(container, videos[index], videoGroups);
}

/**
 * 显示课程组选择对话框并添加视频
 */
async function addVideoToGroupDialog(container, video, videoGroups) {
  const options = videoGroups.map((g, i) =>
    `${i + 1}. ${g.name} (${g.videos.length} 个视频)`
  ).join('\n');

  const input = await window.modal.prompt(
    `视频: ${video.title || '未命名视频'} (${formatDuration(video.duration)})\n\n选择要添加到的课程:\n\n${options}`,
    {
      title: '添加视频到课程',
      defaultValue: '1',
      placeholder: '课程编号',
      confirmText: '添加',
      cancelText: '取消'
    }
  );

  if (!input) return;

  const index = parseInt(input) - 1;
  if (isNaN(index) || index < 0 || index >= videoGroups.length) {
    showToast(container, '无效的选择', 'error');
    return;
  }

  const group = videoGroups[index];

  const response = await chrome.runtime.sendMessage({
    action: 'addVideoToGroup',
    groupId: group.id,
    video: {
      title: video.title || video.pageTitle || '未命名视频',
      url: video.url,
      duration: video.duration || 0,
      watched: video.watched || 0,
      favicon: video.favicon || '',
      pageTitle: video.pageTitle || ''
    }
  });

  if (response.success) {
    showToast(container, `已添加到 "${group.name}"`, 'success');
  } else if (response.error === 'Video already in group') {
    showToast(container, '该视频已在课程中', 'warning');
  } else {
    showToast(container, '添加失败: ' + (response.error || ''), 'error');
  }
}

/**
 * 创建新课程组
 */
async function createVideoGroup(container) {
  const name = await window.modal.prompt('请输入课程名称:', {
    title: '新建课程',
    defaultValue: '新课程',
    placeholder: '课程名称',
    confirmText: '创建'
  });

  if (!name || !name.trim()) return;

  const response = await chrome.runtime.sendMessage({
    action: 'addVideoGroup',
    name: name.trim()
  });

  if (response.success) {
    showToast(container, '课程创建成功，请重新捕获视频', 'success');
  } else {
    showToast(container, '创建失败', 'error');
  }
}

/**
 * 格式化时长
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * 绑定视频捕获按钮事件
 */
export function bindVideoCaptureListener(container) {
  const btn = document.getElementById('captureVideoBtn');
  if (btn) {
    btn.addEventListener('click', () => captureVideo(container));
  }
}
