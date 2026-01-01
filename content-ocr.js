/**
 * OCR 区域选择和结果显示模块
 * 在当前网页上实现区域框选和 OCR 识别结果显示
 */

// 全局状态
let selectionBox = null;
let isSelecting = false;
let startX = 0;
let startY = 0;
let resultPanel = null;

// 创建选择框
function createSelectionBox() {
  const box = document.createElement('div');
  box.id = 'ocr-selection-box';
  box.style.cssText = `
    position: fixed;
    border: 2px dashed #6c757d;
    background: rgba(108, 117, 125, 0.1);
    pointer-events: none;
    z-index: 2147483647;
    display: none;
    box-shadow: 0 0 20px rgba(108, 117, 125, 0.3);
  `;
  document.body.appendChild(box);
  return box;
}

// 创建提示文字
function createInstruction() {
  const instruction = document.createElement('div');
  instruction.id = 'ocr-instruction';
  instruction.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #6c757d;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 2147483647;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  instruction.textContent = '🖱️ 按住鼠标左键拖动选择区域，按 ESC 取消';
  document.body.appendChild(instruction);
  return instruction;
}

// 创建结果面板
function createResultPanel() {
  const panel = document.createElement('div');
  panel.id = 'ocr-result-panel';
  panel.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    width: 400px;
    max-height: 600px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    z-index: 2147483647;
    display: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  `;

  panel.innerHTML = `
    <div style="
      padding: 15px 20px;
      background: #6c757d;
      color: white;
      font-size: 16px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    ">
      <span>📝 识别结果</span>
      <button id="ocr-close-result" style="
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      ">&times;</button>
    </div>
    <div style="
      padding: 15px 20px;
      background: #f8f9fa;
      border-bottom: 1px solid #e9ecef;
    ">
      <div style="
        font-size: 13px;
        font-weight: 600;
        color: #495057;
        margin-bottom: 10px;
      ">📷 截图预览</div>
      <img id="ocr-image-preview" style="
        width: 100%;
        border-radius: 8px;
        border: 1px solid #dee2e6;
        display: none;
      " alt="截图预览">
    </div>
    <div style="
      padding: 20px;
      max-height: 250px;
      overflow-y: auto;
      color: #333;
      font-size: 14px;
      line-height: 1.8;
      white-space: pre-wrap;
      word-wrap: break-word;
    " id="ocr-result-text">正在识别中...</div>
    <div style="
      padding: 12px 20px;
      background: #f8f9fa;
      border-top: 1px solid #e9ecef;
      display: flex;
      gap: 10px;
    ">
      <button id="ocr-copy-result" style="
        flex: 1;
        padding: 8px 16px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.2s;
      ">📋 复制</button>
      <button id="ocr-close-panel" style="
        flex: 1;
        padding: 8px 16px;
        background: #e9ecef;
        color: #495057;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.2s;
      ">关闭</button>
    </div>
  `;

  document.body.appendChild(panel);

  // 绑定按钮事件
  panel.querySelector('#ocr-close-result').addEventListener('click', hideResultPanel);
  panel.querySelector('#ocr-close-panel').addEventListener('click', hideResultPanel);
  panel.querySelector('#ocr-copy-result').addEventListener('click', copyResult);

  return panel;
}

// 显示结果面板
function showResultPanel(text, imageDataUrl = null) {
  if (!resultPanel) {
    resultPanel = createResultPanel();
  }
  document.getElementById('ocr-result-text').textContent = text;

  // 显示图片预览
  const previewImg = document.getElementById('ocr-image-preview');
  if (imageDataUrl) {
    previewImg.src = imageDataUrl;
    previewImg.style.display = 'block';
  } else {
    previewImg.style.display = 'none';
  }

  resultPanel.style.display = 'block';
}

// 隐藏结果面板
function hideResultPanel() {
  if (resultPanel) {
    resultPanel.style.display = 'none';
  }
}

// 复制结果
function copyResult() {
  const text = document.getElementById('ocr-result-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('ocr-copy-result');
    const originalText = btn.textContent;
    btn.textContent = '✓ 已复制';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1500);
  }).catch(err => {
    console.error('复制失败:', err);
    alert('复制失败，请手动复制');
  });
}

// 开始区域选择
function startSelection() {
  // 清除之前的选择框
  cleanup();

  // 创建 UI
  selectionBox = createSelectionBox();
  const instruction = createInstruction();

  // 添加遮罩层
  const overlay = document.createElement('div');
  overlay.id = 'ocr-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 2147483646;
    cursor: crosshair;
  `;
  document.body.appendChild(overlay);

  // 监听鼠标事件
  overlay.addEventListener('mousedown', onMouseDown);
  document.addEventListener('keydown', onKeyDown);

  // 监听页面滚动，滚动时隐藏选择框
  document.addEventListener('wheel', onScroll, { passive: true });
  document.addEventListener('touchmove', onScroll, { passive: true });

  // 显示提示
  setTimeout(() => {
    instruction.style.opacity = '1';
  }, 100);
}

// 鼠标按下
function onMouseDown(e) {
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;

  selectionBox.style.left = startX + 'px';
  selectionBox.style.top = startY + 'px';
  selectionBox.style.width = '0px';
  selectionBox.style.height = '0px';
  selectionBox.style.display = 'block';

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// 鼠标移动
function onMouseMove(e) {
  if (!isSelecting) return;

  const currentX = e.clientX;
  const currentY = e.clientY;

  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);

  selectionBox.style.left = left + 'px';
  selectionBox.style.top = top + 'px';
  selectionBox.style.width = width + 'px';
  selectionBox.style.height = height + 'px';
}

// 鼠标释放
function onMouseUp(e) {
  if (!isSelecting) return;
  isSelecting = false;

  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);

  // 获取选择区域
  const rect = {
    left: parseInt(selectionBox.style.left),
    top: parseInt(selectionBox.style.top),
    width: parseInt(selectionBox.style.width),
    height: parseInt(selectionBox.style.height)
  };

  // 移除遮罩和提示
  const overlay = document.getElementById('ocr-overlay');
  const instruction = document.getElementById('ocr-instruction');
  if (overlay) overlay.remove();
  if (instruction) instruction.remove();

  // 立即隐藏选择框（完成后不再显示）
  if (selectionBox) {
    selectionBox.style.display = 'none';
  }

  // 如果选择区域太小，忽略
  if (rect.width < 10 || rect.height < 10) {
    cleanup();
    return;
  }

  // 发送消息进行 OCR
  performOCR(rect);
}

// 键盘事件（ESC 取消）
function onKeyDown(e) {
  if (e.key === 'Escape') {
    cleanup();
  }
}

// 页面滚动事件
function onScroll() {
  // 滚动时隐藏选择框
  if (selectionBox && selectionBox.style.display === 'block') {
    selectionBox.style.display = 'none';
  }
}

// 执行 OCR
async function performOCR(rect) {
  // 显示加载状态
  showResultPanel('正在识别中，请稍候...');

  // 发送消息给 background script 获取截图
  chrome.runtime.sendMessage({
    action: 'performOCR',
    rect: rect
  }, async (response) => {
    if (chrome.runtime.lastError) {
      showResultPanel('识别失败: ' + chrome.runtime.lastError.message);
      return;
    }

    if (response && response.success && response.dataUrl) {
      try {
        // 在 content script 中裁剪图片
        const croppedImage = await cropImage(response.dataUrl, response.rect);

        // TODO: 调用真实的 OCR API
        // const result = await callOCRApi(croppedImage);

        // MVP: 返回固定结果，同时显示截图预览
        const result = '截图成功,完成返回';
        showResultPanel(result, croppedImage);
      } catch (error) {
        showResultPanel('识别失败: ' + error.message);
      }
    } else {
      showResultPanel('识别失败: ' + (response?.error || '未知错误'));
    }
  });
}

/**
 * 裁剪图片
 * @param {string} dataUrl - 原始图片的 base64
 * @param {Object} rect - 裁剪区域 { left, top, width, height }
 * @returns {Promise<string>} 裁剪后的图片 base64
 */
function cropImage(dataUrl, rect) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 设置画布大小为裁剪区域大小
      canvas.width = rect.width;
      canvas.height = rect.height;

      // 裁剪图片
      ctx.drawImage(
        img,
        rect.left, rect.top, rect.width, rect.height,
        0, 0, rect.width, rect.height
      );

      // 转换为 base64
      const croppedDataUrl = canvas.toDataURL('image/png');
      resolve(croppedDataUrl);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * 调用真实 OCR API（示例，未来实现）
 * @param {string} imageBase64 - 图片的 base64 数据
 * @returns {Promise<string>} OCR 识别结果
 */
async function callOCRApi(imageBase64) {
  // 移除 data:image/png;base64, 前缀
  const base64Data = imageBase64.split(',')[1];

  // TODO: 替换为你的真实 API endpoint
  const apiUrl = 'YOUR_API_ENDPOINT_HERE';

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: base64Data,
        // 其他 API 需要的参数
      })
    });

    const data = await response.json();

    // 根据你的 API 返回格式调整
    return data.text || data.result || '无法获取识别结果';
  } catch (error) {
    throw new Error('API 调用失败: ' + error.message);
  }
}

// 清理
function cleanup() {
  const overlay = document.getElementById('ocr-overlay');
  const instruction = document.getElementById('ocr-instruction');
  if (overlay) overlay.remove();
  if (instruction) instruction.remove();
  if (selectionBox) {
    selectionBox.remove();
    selectionBox = null;
  }
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('wheel', onScroll);
  document.removeEventListener('touchmove', onScroll);
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startOCRSelection') {
    startSelection();
    sendResponse({ success: true });
  } else if (request.action === 'closeOCRResult') {
    hideResultPanel();
    sendResponse({ success: true });
  }
});

// 页面卸载时清理
window.addEventListener('unload', cleanup);
