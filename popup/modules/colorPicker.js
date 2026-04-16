/**
 * Popup ColorPicker Module
 * 颜色选择器组件
 */

import { getDefaultColors, getSelectedColor, setSelectedColor } from './groups.js';

/**
 * 渲染颜色选择器
 * @param {string} containerId - 容器ID
 * @param {Function} options.onSelect - 颜色选择回调
 */
export function renderColorPicker(containerId = 'colorPicker', { onSelect } = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const colors = getDefaultColors();
  const selected = getSelectedColor();

  container.innerHTML = colors.map(color => `
    <div class="color-option ${color === selected ? 'selected' : ''}"
         style="background: ${color}"
         data-color="${color}"></div>
  `).join('');

  container.querySelectorAll('.color-option').forEach(option => {
    option.addEventListener('click', () => {
      setSelectedColor(option.dataset.color);
      renderColorPicker(containerId, { onSelect });
      if (onSelect) {
        onSelect(option.dataset.color);
      }
    });
  });
}

/**
 * 重置颜色选择器到默认颜色
 * @param {string} containerId - 容器ID
 */
export function resetColorPicker(containerId = 'colorPicker') {
  setSelectedColor(getDefaultColors()[0]);
  renderColorPicker(containerId);
}
