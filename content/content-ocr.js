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
let isUserScrolling = false;  // 标记用户是否正在滚动

// API 配置
const API_CONFIG = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: 'd237351671da318126fb5bd2f1372a08.EdkVfX8wE0JtcZpP',
  model: 'glm-4.5v'
};

// ========== 性能优化工具函数 ==========

/**
 * 节流函数 - 限制函数执行频率
 * @param {Function} func - 要节流的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 节流后的函数
 */
function throttle(func, delay) {
  let lastCall = 0;
  let timeoutId = null;

  return function executedFunction(...args) {
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    if (remaining <= 0) {
      // 立即执行
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      func.apply(this, args);
    } else if (!timeoutId) {
      // 设置延迟执行，确保最后一次调用被执行
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        func.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * 防抖函数 - 延迟执行，只执行最后一次
 * @param {Function} func - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(func, delay) {
  let timeoutId = null;

  return function executedFunction(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * 使用 requestAnimationFrame 优化的节流
 * 适用于视觉更新场景
 * @param {Function} func - 要优化的函数
 * @returns {Function} 优化后的函数
 */
function throttleRAF(func) {
  let rafId = null;

  return function executedFunction(...args) {
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        func.apply(this, args);
        rafId = null;
      });
    }
  };
}

/**
 * 流速控制类 - 使用预加载缓冲机制实现平滑输出
 * 解决服务器推送不均导致的文字卡顿问题
 */
class StreamFlowController {
  /**
   * @param {Object} options - 配置选项
   * @param {number} options.preloadThreshold - 预加载阈值（字符数），达到此值开始输出，默认 100
   * @param {number} options.outputInterval - 输出间隔（毫秒），控制输出速率，默认 40ms (25fps)
   * @param {number} options.minBufferSize - 最小缓冲区大小，低于此值停止输出等待补充，默认 20
   * @param {number} options.chunkSize - 每次输出的字符数，默认 15
   */
  constructor(options = {}) {
    this.preloadThreshold = options.preloadThreshold ?? 80; // 预加载80字符后开始输出
    this.outputInterval = options.outputInterval ?? 35; // 每35ms输出一次
    this.minBufferSize = options.minBufferSize ?? 15; // 缓冲区最少保留15字符
    this.chunkSize = options.chunkSize ?? 12; // 每次输出12字符

    this.buffer = '';
    this.isStarted = false;
    this.isEnded = false;
    this.outputTimer = null;
    this.onFlushCallback = null;
  }

  /**
   * 启动输出定时器
   */
  startOutput(onFlush) {
    this.onFlushCallback = onFlush;

    const outputLoop = async () => {
      if (this.isEnded) {
        this.stop();
        return;
      }

      // 检查是否需要继续输出
      const shouldOutput =
        // 已开始输出且缓冲区有足够数据
        (this.isStarted && this.buffer.length > this.minBufferSize) ||
        // 缓冲区达到预加载阈值，首次开始输出
        (!this.isStarted && this.buffer.length >= this.preloadThreshold);

      if (shouldOutput && this.buffer.length > 0) {
        this.isStarted = true;

        // 计算本次输出的字符数
        const outputSize = Math.min(
          this.chunkSize,
          this.buffer.length - this.minBufferSize // 保持缓冲区不低于最小值
        );

        if (outputSize > 0) {
          const outputText = this.buffer.slice(0, outputSize);
          this.buffer = this.buffer.slice(outputSize);

          try {
            await this.onFlushCallback(outputText);
          } catch (e) {
            console.error('输出回调失败:', e);
          }
        }
      }

      // 继续下一轮
      this.outputTimer = setTimeout(outputLoop, this.outputInterval);
    };

    // 启动输出循环
    this.outputTimer = setTimeout(outputLoop, this.outputInterval);
  }

  /**
   * 添加数据到缓冲区
   * @param {string} data - 要添加的数据
   */
  add(data) {
    this.buffer += data;
  }

  /**
   * 标记数据流结束，输出剩余所有数据
   * @returns {Promise<void>}
   */
  async end() {
    this.isEnded = true;

    // 停止定时器
    this.stop();

    // 输出所有剩余数据
    if (this.buffer.length > 0 && this.onFlushCallback) {
      await this.onFlushCallback(this.buffer);
      this.buffer = '';
    }
  }

  /**
   * 停止输出定时器
   */
  stop() {
    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }
  }

  /**
   * 获取缓冲区状态
   */
  getBufferStatus() {
    return {
      bufferLength: this.buffer.length,
      isStarted: this.isStarted,
      isEnded: this.isEnded
    };
  }
}

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
    <div id="ocr-panel-header" style="
      padding: 15px 20px;
      background: #6c757d;
      color: white;
      font-size: 16px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      user-select: none;
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

  // 绑定拖动功能
  setupDraggable(panel);

  // 绑定滚动行为
  setupScrollBehavior(panel);

  return panel;
}

/**
 * 设置面板滚动行为
 */
function setupScrollBehavior(panel) {
  const resultTextElement = panel.querySelector('#ocr-result-text');
  if (!resultTextElement) return;

  let scrollTimeout = null;

  // 监听滚动事件
  resultTextElement.addEventListener('scroll', () => {
    // 标记用户正在滚动
    isUserScrolling = true;

    // 清除之前的定时器
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    // 2秒后重置标志（假设用户2秒没有滚动就是停止了）
    scrollTimeout = setTimeout(() => {
      isUserScrolling = false;
    }, 2000);
  });
}

/**
 * 设置面板拖动功能
 */
function setupDraggable(panel) {
  const header = panel.querySelector('#ocr-panel-header');
  if (!header) return;

  let isDragging = false;
  let startX, startY, initialX, initialY;

  // 鼠标按下
  header.addEventListener('mousedown', (e) => {
    // 如果点击的是关闭按钮，不启动拖动
    if (e.target.id === 'ocr-close-result') return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    // 获取面板当前位置
    const rect = panel.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;

    // 改变鼠标样式
    header.style.cursor = 'grabbing';

    // 阻止文本选择
    e.preventDefault();
  });

  // 鼠标移动（使用 RAF 优化）
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // 计算新位置
    let newX = initialX + dx;
    let newY = initialY + dy;

    // 确保不超出视窗
    const maxX = window.innerWidth - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;

    // 限制边界
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    // 使用 RAF 优化位置更新
    requestAnimationFrame(() => {
      panel.style.left = newX + 'px';
      panel.style.top = newY + 'px';
      panel.style.right = 'auto'; // 清除 right 属性
    });
  });

  // 鼠标释放
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'move';
    }
  });
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

// 鼠标移动（使用 RAF 优化，减少重绘）
function onMouseMove(e) {
  if (!isSelecting) return;

  const currentX = e.clientX;
  const currentY = e.clientY;

  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);

  // 使用 RAF 优化的更新函数
  requestAnimationFrame(() => {
    if (selectionBox) {
      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';
    }
  });
}

// 鼠标释放
function onMouseUp(e) {
  if (!isSelecting) return;
  isSelecting = false;

  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);

  // 获取选择区域
  const rawRect = {
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
  if (rawRect.width < 10 || rawRect.height < 10) {
    cleanup();
    return;
  }

  // 检测并校正坐标
  const adjustedRect = detectAndAdjustCoordinates(rawRect);

  // 发送消息进行 OCR
  performOCR(adjustedRect);
}

/**
 * 检测并校正坐标系统差异
 * 某些网站（如知乎）可能有 CSS transform 或缩放，导致坐标偏差
 */
function detectAndAdjustCoordinates(rect) {
  // 1. 检测页面是否有 transform 或 scale
  const bodyStyle = window.getComputedStyle(document.body);
  const transform = bodyStyle.transform || bodyStyle.webkitTransform;
  const zoom = bodyStyle.zoom;

  // 2. 获取设备像素比
  const devicePixelRatio = window.devicePixelRatio || 1;

  // 3. 检测浏览器缩放级别（通过检测实际像素和CSS像素的比值）
  const browserZoom = detectBrowserZoom();

  // 计算总的缩放因子
  let scaleAdjustment = 1;

  // 如果有 transform matrix，提取缩放因子
  if (transform && transform !== 'none') {
    const matrix = transform.match(/matrix\((.+)\)/);
    if (matrix) {
      const values = matrix[1].split(', ').map(parseFloat);
      // transform: matrix(a, b, c, d, tx, ty)
      // a 和 d 是 X 和 Y 方向的缩放
      const scaleX = values[0];
      const scaleY = values[3];
      scaleAdjustment *= ((scaleX + scaleY) / 2);
    }
  }

  // 如果有 CSS zoom
  if (zoom && zoom !== '1' && zoom !== 'normal') {
    scaleAdjustment *= parseFloat(zoom);
  }

  // 考虑浏览器缩放
  if (browserZoom !== 1) {
    scaleAdjustment *= browserZoom;
  }

  // 如果有缩放，调整坐标
  if (scaleAdjustment !== 1 && Math.abs(scaleAdjustment - 1) > 0.01) {
    console.log(`检测到页面缩放: ${scaleAdjustment.toFixed(3)}, 调整坐标`);

    return {
      left: rect.left / scaleAdjustment,
      top: rect.top / scaleAdjustment,
      width: rect.width / scaleAdjustment,
      height: rect.height / scaleAdjustment
    };
  }

  // 如果没有检测到缩放，但 devicePixelRatio 不是 1，也需要调整
  // 因为 captureVisibleTab 返回的是物理像素，而鼠标坐标是 CSS 像素
  if (devicePixelRatio !== 1) {
    return {
      left: rect.left * devicePixelRatio,
      top: rect.top * devicePixelRatio,
      width: rect.width * devicePixelRatio,
      height: rect.height * devicePixelRatio
    };
  }

  return rect;
}

/**
 * 检测浏览器缩放级别
 * 通过创建一个 100px 的测试元素并检查其实际宽度
 */
function detectBrowserZoom() {
  const testDiv = document.createElement('div');
  testDiv.style.cssText = 'position: absolute; width: 100px; height: 100px; visibility: hidden; pointer-events: none;';
  document.body.appendChild(testDiv);

  const rect = testDiv.getBoundingClientRect();
  const zoom = rect.width / 100;

  document.body.removeChild(testDiv);

  return zoom;
}

// 键盘事件（ESC 取消）
function onKeyDown(e) {
  if (e.key === 'Escape') {
    cleanup();
  }
}

// 页面滚动事件（使用节流优化）
const onScroll = throttle(() => {
  // 滚动时隐藏选择框
  if (selectionBox && selectionBox.style.display === 'block') {
    selectionBox.style.display = 'none';
  }
}, 100);

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
 * 流式 OCR API 调用（使用预加载缓冲机制实现平滑输出）
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

  // 从存储中获取流速设置
  const flowRateSettings = await new Promise((resolve) => {
    chrome.storage.local.get(['ocrSettings'], (result) => {
      const ocrSettings = result.ocrSettings || {};
      resolve(ocrSettings.flowRate || {
        level: 3,
        outputInterval: 35,
        chunkSize: 12
      });
    });
  });

  // 创建流速控制器 - 使用用户配置的流速参数
  const flowController = new StreamFlowController({
    preloadThreshold: 80,                   // 预加载 80 字符后开始输出
    outputInterval: flowRateSettings.outputInterval,  // 用户配置的输出间隔
    minBufferSize: 15,                       // 缓冲区最少保留 15 字符
    chunkSize: flowRateSettings.chunkSize              // 用户配置的每次输出字符数
  });

  console.log(`[OCR] 使用流速档位: Lv${flowRateSettings.level}, 间隔: ${flowRateSettings.outputInterval}ms, 块大小: ${flowRateSettings.chunkSize}`);

  /**
   * 输出回调函数 - 更新 DOM
   * @param {string} textChunk - 要显示的文本块
   */
  const outputCallback = (textChunk) => {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        const resultTextElement = document.getElementById('ocr-result-text');
        if (!resultTextElement) {
          resolve();
          return;
        }

        fullText += textChunk;
        resultTextElement.textContent = fullText;

        // 智能滚动：只有当用户在底部时才自动滚动
        // 检测用户是否在底部（允许 50px 的误差范围）
        const isAtBottom = resultTextElement.scrollHeight - resultTextElement.scrollTop - resultTextElement.clientHeight < 50;

        if (isAtBottom && !isUserScrolling) {
          // 用户在底部且没有主动滚动，自动滚动到最新内容
          resultTextElement.scrollTop = resultTextElement.scrollHeight;
        }
        // 如果用户向上滚动了，不再自动滚动，让用户自由查看前面的内容

        resolve();
      });
    });
  };

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

    // 启动输出定时器
    flowController.startOutput(outputCallback);

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
                // 添加数据到缓冲区（非阻塞）
                flowController.add(content);
              }
            }
          } catch (e) {
            // 忽略解析错误
            console.warn('解析 SSE 数据失败:', e);
          }
        }
      }
    }

    // 数据接收完毕，结束输出并刷新剩余数据
    await flowController.end();

  } catch (error) {
    if (error.name === 'AbortError') {
      // 停止输出定时器
      flowController.stop();
      resultTextElement.textContent = fullText + '\n\n[请求已取消]';
    } else {
      flowController.stop();
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
  } else if (request.action === 'updateShortcut') {
    // 更新快捷键
    currentShortcut = request.shortcut;
    console.log('OCR 快捷键已更新:', formatShortcutForLog(currentShortcut));
    sendResponse({ success: true });
  } else if (request.action === 'clearShortcut') {
    // 清除快捷键
    currentShortcut = null;
    console.log('OCR 快捷键已清除');
    sendResponse({ success: true });
  }
});

// 页面卸载时清理
window.addEventListener('unload', cleanup);

// ========== 快捷键功能 ==========

// 当前注册的快捷键
let currentShortcut = null;

// 加载快捷键设置
function loadShortcut() {
  chrome.storage.local.get(['ocrShortcut'], (result) => {
    if (result.ocrShortcut) {
      currentShortcut = result.ocrShortcut;
      console.log('OCR 快捷键已加载:', formatShortcutForLog(currentShortcut));
    }
  });
}

// 格式化快捷键用于日志输出
function formatShortcutForLog(shortcut) {
  const parts = [];
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.shiftKey) parts.push('Shift');
  if (shortcut.metaKey) parts.push('Meta');
  parts.push(shortcut.key);
  return parts.join('+');
}

// 检查键盘事件是否匹配快捷键
function isShortcutMatch(e, shortcut) {
  if (!shortcut) return false;

  return (
    e.ctrlKey === shortcut.ctrlKey &&
    e.altKey === shortcut.altKey &&
    e.shiftKey === shortcut.shiftKey &&
    e.metaKey === shortcut.metaKey &&
    e.key === shortcut.key
  );
}

// 监听键盘事件
document.addEventListener('keydown', (e) => {
  // 如果当前正在选择区域，不触发快捷键
  if (isSelecting) return;

  // 如果快捷键未设置，不处理
  if (!currentShortcut) return;

  // 检查是否匹配快捷键
  if (isShortcutMatch(e, currentShortcut)) {
    e.preventDefault();
    e.stopPropagation();

    console.log('触发 OCR 快捷键:', formatShortcutForLog(currentShortcut));

    // 启动 OCR 选择
    startSelection();
  }
});

// 初始化时加载快捷键
loadShortcut();
