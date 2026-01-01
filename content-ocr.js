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
let currentCroppedImage = null;
let currentAbortController = null;

// API 配置
const API_CONFIG = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: 'd237351671da318126fb5bd2f1372a08.EdkVfX8wE0JtcZpP',
  model: 'glm-4.5v'
};

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
      <button id="ocr-restart-btn" style="
        flex: 1;
        padding: 8px 16px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.2s;
        display: none;
      ">🔄 重新识别</button>
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
  panel.querySelector('#ocr-restart-btn').addEventListener('click', restartOCR);

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

  // 显示重新识别按钮
  const restartBtn = document.getElementById('ocr-restart-btn');
  if (restartBtn) {
    restartBtn.style.display = 'block';
  }

  resultPanel.style.display = 'block';
}

// 显示结果面板（带图片和加载状态）
function showResultPanelWithImage(imageDataUrl, text) {
  if (!resultPanel) {
    resultPanel = createResultPanel();
  }

  // 显示图片预览
  const previewImg = document.getElementById('ocr-image-preview');
  if (imageDataUrl) {
    previewImg.src = imageDataUrl;
    previewImg.style.display = 'block';
  }

  // 设置加载文字
  document.getElementById('ocr-result-text').textContent = text;

  // 显示重新识别按钮
  const restartBtn = document.getElementById('ocr-restart-btn');
  if (restartBtn) {
    restartBtn.style.display = 'block';
  }

  resultPanel.style.display = 'block';
}

// 只更新结果文字
function updateResultText(text) {
  const resultTextElement = document.getElementById('ocr-result-text');
  if (resultTextElement) {
    resultTextElement.textContent = text;
  }
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
  // 从存储中获取 OCR 设置
  chrome.storage.local.get(['ocrSettings'], async (settingsResult) => {
    const ocrSettings = settingsResult.ocrSettings || {
      prompt: '请识别图片中的所有文字内容',
      stream: false
    };

    // 发送消息给 background script 获取截图
    // background script 会从 sender.tab.id 获取当前标签页 ID
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
          currentCroppedImage = croppedImage;

          // 先显示图片预览和加载状态
          showResultPanelWithImage(croppedImage, '正在识别中，请稍候...');

          // 使用存储中的设置
          const prompt = ocrSettings.prompt;
          const useStream = ocrSettings.stream;

          // 调用真实 OCR API
          if (useStream) {
            await callOCRApiStream(croppedImage, prompt);
          } else {
            const result = await callOCRApiNonStream(croppedImage, prompt);
            updateResultText(result);
          }
        } catch (error) {
          showResultPanel('识别失败: ' + error.message);
        }
      } else {
        showResultPanel('识别失败: ' + (response?.error || '未知错误'));
      }
    });
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
 * 非流式 OCR API 调用
 * @param {string} imageBase64 - 图片的 base64 数据
 * @param {string} prompt - 用户提示词
 * @returns {Promise<string>} OCR 识别结果
 */
async function callOCRApiNonStream(imageBase64, prompt = '请识别图片中的所有文字内容') {
  // 移除 data:image/png;base64, 前缀
  const base64Data = imageBase64.split(',')[1];

  const apiUrl = `${API_CONFIG.baseURL}/chat/completions`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.apiKey}`
      },
      body: JSON.stringify({
        model: API_CONFIG.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: base64Data
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ],
        thinking: {
          type: 'enabled'
        },
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // 返回识别结果
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content || '无法获取识别结果';
    }

    return '无法获取识别结果';
  } catch (error) {
    throw new Error('API 调用失败: ' + error.message);
  }
}

/**
 * 流式 OCR API 调用
 * @param {string} imageBase64 - 图片的 base64 数据
 * @param {string} prompt - 用户提示词
 */
async function callOCRApiStream(imageBase64, prompt = '请识别图片中的所有文字内容') {
  // 移除 data:image/png;base64, 前缀
  const base64Data = imageBase64.split(',')[1];

  const apiUrl = `${API_CONFIG.baseURL}/chat/completions`;

  // 创建 AbortController 用于取消请求
  currentAbortController = new AbortController();

  const resultTextElement = document.getElementById('ocr-result-text');
  if (!resultTextElement) return;

  let fullText = '';

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.apiKey}`
      },
      body: JSON.stringify({
        model: API_CONFIG.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: base64Data
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ],
        thinking: {
          type: 'enabled'
        },
        stream: true
      }),
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    // 清空加载状态，准备接收流式数据
    resultTextElement.textContent = '';

    // 读取流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            break;
          }

          try {
            const parsed = JSON.parse(data);

            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
              const delta = parsed.choices[0].delta;

              // 优先使用 content，如果有 reasoning_content 也可以处理
              const content = delta.content || delta.reasoning_content || '';

              if (content) {
                fullText += content;
                resultTextElement.textContent = fullText;

                // 自动滚动到底部
                resultTextElement.scrollTop = resultTextElement.scrollHeight;
              }
            }
          } catch (e) {
            // 忽略解析错误
            console.warn('解析 SSE 数据失败:', e);
          }
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      resultTextElement.textContent = fullText + '\n\n[请求已取消]';
    } else {
      throw new Error('API 调用失败: ' + error.message);
    }
  } finally {
    currentAbortController = null;
  }
}

/**
 * 重新识别（使用已保存的截图）
 */
async function restartOCR() {
  if (!currentCroppedImage) {
    alert('没有可用的截图，请重新选择区域');
    return;
  }

  // 从存储中获取最新的 OCR 设置
  chrome.storage.local.get(['ocrSettings'], async (settingsResult) => {
    const ocrSettings = settingsResult.ocrSettings || {
      prompt: '请识别图片中的所有文字内容',
      stream: false
    };

    const prompt = ocrSettings.prompt;
    const useStream = ocrSettings.stream;

    // 取消之前的请求
    if (currentAbortController) {
      currentAbortController.abort();
    }

    try {
      // 调用 OCR API
      if (useStream) {
        await callOCRApiStream(currentCroppedImage, prompt);
      } else {
        const result = await callOCRApiNonStream(currentCroppedImage, prompt);
        showResultPanel(result, currentCroppedImage);
      }
    } catch (error) {
      showResultPanel('识别失败: ' + error.message);
    }
  });
}

// 清理
function cleanup() {
  // 取消进行中的 API 请求
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }

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
