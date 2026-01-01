// 全局变量
let currentImageBase64 = null;
let currentTabId = null;

// DOM 元素
const captureBtn = document.getElementById('captureBtn');
const recognizeBtn = document.getElementById('recognizeBtn');
const clearBtn = document.getElementById('clearBtn');
const imagePreview = document.getElementById('imagePreview');
const resultText = document.getElementById('resultText');
const previewSection = document.getElementById('previewSection');
const resultSection = document.getElementById('resultSection');
const emptyState = document.getElementById('emptyState');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const imageInfo = document.getElementById('imageInfo');

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  getCurrentTab();
});

// 绑定事件
function bindEvents() {
  captureBtn.addEventListener('click', captureScreen);
  recognizeBtn.addEventListener('click', recognizeImage);
  clearBtn.addEventListener('click', clearAll);
}

// 获取当前标签页
function getCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0) {
      currentTabId = tabs[0].id;
      setStatus(`当前标签: ${tabs[0].title}`);
    }
  });
}

// 截取当前页面
function captureScreen() {
  setStatus('正在截取屏幕...', true);

  // 使用 chrome.tabs.captureVisibleTab 截取当前标签页
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      setStatus(`错误: ${chrome.runtime.lastError.message}`);
      alert('截图失败: ' + chrome.runtime.lastError.message);
      return;
    }

    // 保存图片数据
    currentImageBase64 = dataUrl;

    // 显示预览
    displayPreview(dataUrl);

    // 启用识别按钮
    recognizeBtn.disabled = false;

    setStatus('截图成功！点击"开始识别"进行 OCR 识别');
    updateImageInfo(dataUrl);
  });
}

// 显示图片预览
function displayPreview(dataUrl) {
  imagePreview.src = dataUrl;
  imagePreview.classList.add('has-image');
  previewSection.style.display = 'block';
  emptyState.style.display = 'none';
  resultSection.style.display = 'none';
}

// 更新图片信息
function updateImageInfo(dataUrl) {
  // 计算图片大小（base64 长度大约是实际大小的 4/3）
  const sizeInBytes = Math.round((dataUrl.length - 'data:image/png;base64,'.length) * 0.75);
  const sizeInKB = (sizeInBytes / 1024).toFixed(2);
  imageInfo.textContent = `图片大小: ${sizeInKB} KB`;
}

// 识别图片（MVP 版本 - 返回固定结果）
function recognizeImage() {
  if (!currentImageBase64) {
    alert('请先截取屏幕');
    return;
  }

  setStatus('正在识别中...', true);
  recognizeBtn.disabled = true;

  // 模拟 API 调用延迟
  setTimeout(() => {
    // MVP: 返回固定结果
    const result = '截图成功,完成返回';

    displayResult(result);
    recognizeBtn.disabled = false;
    setStatus('识别完成');
  }, 1000);

  // TODO: 未来替换为真实 API 调用
  // callRealOCRApi(currentImageBase64);
}

// 调用真实 OCR API（示例，未来实现）
function callRealOCRApi(imageBase64) {
  // 移除 data:image/png;base64, 前缀
  const base64Data = imageBase64.split(',')[1];

  // TODO: 替换为你的真实 API endpoint
  const apiUrl = 'YOUR_API_ENDPOINT_HERE';

  fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image: base64Data,
      // 其他 API 需要的参数
    })
  })
  .then(response => response.json())
  .then(data => {
    // 根据你的 API 返回格式调整
    const result = data.text || data.result || '无法获取识别结果';
    displayResult(result);
    recognizeBtn.disabled = false;
    setStatus('识别完成');
  })
  .catch(error => {
    console.error('API Error:', error);
    displayResult('识别失败: ' + error.message);
    recognizeBtn.disabled = false;
    setStatus('识别失败');
  });
}

// 显示识别结果
function displayResult(text) {
  resultText.textContent = text;
  resultSection.style.display = 'block';
  emptyState.style.display = 'none';

  // 滚动到结果区域
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 清空所有内容
function clearAll() {
  currentImageBase64 = null;
  imagePreview.src = '';
  imagePreview.classList.remove('has-image');
  resultText.textContent = '';
  previewSection.style.display = 'none';
  resultSection.style.display = 'none';
  emptyState.style.display = 'block';
  statusBar.style.display = 'none';
  imageInfo.textContent = '';
  recognizeBtn.disabled = true;
  setStatus('就绪');
}

// 设置状态栏
function setStatus(text, isLoading = false) {
  statusText.textContent = text;
  statusBar.style.display = 'flex';

  if (isLoading) {
    statusText.classList.add('loading');
  } else {
    statusText.classList.remove('loading');
  }
}
