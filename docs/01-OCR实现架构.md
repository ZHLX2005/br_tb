# OCR 功能实现架构

## 目录

- [1. 整体架构](#1-整体架构)
- [2. 核心模块](#2-核心模块)
- [3. 数据流转](#3-数据流转)
- [4. 关键技术](#4-关键技术)
- [5. 代码示例](#5-代码示例)

---

## 1. 整体架构

### 1.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户操作层                                │
│  用户点击 Popup 中的 "OCR识别" 按钮 / 按下快捷键                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Content Script (content-ocr.js)               │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │  区域选择模块     │    │  结果展示模块     │                   │
│  │  - 创建遮罩层     │    │  - 拖动面板       │                   │
│  │  - 鼠标事件监听   │    │  - 复制功能       │                   │
│  │  - 坐标计算       │    │  - 重新识别       │                   │
│  └──────────────────┘    └──────────────────┘                   │
└────────────────────────┬────────────────────────────────────────┘
                         │ chrome.runtime.sendMessage
                         │ { action: 'performOCR', rect: {...} }
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Background Service Worker (backgrounds/ocr.js)      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  handleOCRRequest()                                     │    │
│  │  - chrome.tabs.captureVisibleTab() 获取整页截图          │    │
│  │  - 返回 dataUrl 和 rect 区域信息                         │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────┘
                         │ sendResponse({ dataUrl, rect })
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Content Script (content-ocr.js)               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  cropImage() - 裁剪图片                                  │    │
│  │  - 创建 Canvas                                           │    │
│  │  - drawImage() 裁剪指定区域                              │    │
│  │  - toDataURL() 转换为 base64                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                         │                                        │
│                         ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  API 调用模块                                            │    │
│  │  - callOCRApiNonStream() 非流式调用                      │    │
│  │  - callOCRApiStream() 流式调用                          │    │
│  │  - 使用 fetch() 调用 GLM-4.5V API                       │    │
│  │  - SSE (Server-Sent Events) 解析流式数据                │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                       外部 API 服务                               │
│  智谱 AI GLM-4.5V Vision API                                     │
│  https://open.bigmodel.cn/api/paas/v4/chat/completions           │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 模块职责

| 模块 | 文件 | 主要职责 |
|------|------|----------|
| **区域选择** | content-ocr.js | 提供可视化区域框选界面 |
| **截图处理** | backgrounds/ocr.js | 获取页面截图 |
| **图片裁剪** | content-ocr.js | 裁剪出选定区域 |
| **API 调用** | content-ocr.js | 调用 OCR API 识别文字 |
| **结果展示** | content-ocr.js | 显示识别结果 |

---

## 2. 核心模块

### 2.1 区域选择模块

**文件**: `content/content-ocr.js`

**核心函数**:

```javascript
// 开始区域选择
function startSelection() {
  // 1. 创建遮罩层 (半透明黑色)
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    background: rgba(0, 0, 0, 0.3);
    cursor: crosshair;
  `;

  // 2. 创建选择框 (虚线边框)
  const selectionBox = document.createElement('div');
  selectionBox.style.cssText = `
    border: 2px dashed #6c757d;
    background: rgba(108, 117, 125, 0.1);
  `;

  // 3. 监听鼠标事件
  overlay.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}
```

**坐标校正**:
```javascript
function detectAndAdjustCoordinates(rect) {
  // 处理页面缩放、transform、devicePixelRatio
  const devicePixelRatio = window.devicePixelRatio || 1;
  const browserZoom = detectBrowserZoom();

  // 如果有缩放，调整坐标
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
```

### 2.2 截图处理模块

**文件**: `backgrounds/ocr.js`

**核心函数**:

```javascript
export async function handleOCRRequest(request) {
  const { rect } = request;

  // 使用 Chrome API 获取当前标签页的完整截图
  const dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: 'png'
  });

  return {
    success: true,
    dataUrl: dataUrl,  // 完整页面的 base64 图片
    rect: rect         // 用户选择的区域坐标
  };
}
```

**关键点**:
- `captureVisibleTab` 返回的是**物理像素**截图
- 需要考虑 `devicePixelRatio` 进行坐标校正

### 2.3 图片裁剪模块

**文件**: `content/content-ocr.js`

**核心函数**:

```javascript
function cropImage(dataUrl, rect) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      // 创建 Canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 设置画布大小为裁剪区域
      canvas.width = rect.width;
      canvas.height = rect.height;

      // 从原图中裁剪指定区域
      ctx.drawImage(
        img,
        rect.left, rect.top,      // 源图裁剪起点
        rect.width, rect.height,  // 源图裁剪大小
        0, 0,                     // 目标画布起点
        rect.width, rect.height   // 目标画布大小
      );

      // 转换为 base64
      const croppedDataUrl = canvas.toDataURL('image/png');
      resolve(croppedDataUrl);
    };

    img.src = dataUrl;
  });
}
```

**Canvas drawImage 参数说明**:
```
drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
```

### 2.4 API 调用模块

**文件**: `content/content-ocr.js`

**非流式调用**:

```javascript
async function callOCRApiNonStream(imageBase64, prompt) {
  const base64Data = imageBase64.split(',')[1];

  const response = await fetch(
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.apiKey}`
      },
      body: JSON.stringify({
        model: 'glm-4.5v',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: base64Data }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }],
        stream: false
      })
    }
  );

  const data = await response.json();
  return data.choices[0].message.content;
}
```

**流式调用 (SSE)**:

```javascript
async function callOCRApiStream(imageBase64, prompt) {
  const response = await fetch(apiUrl, {
    body: JSON.stringify({
      stream: true  // 启用流式输出
    }),
    signal: abortController.signal
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));

        if (data.choices[0].delta.content) {
          fullText += data.choices[0].delta.content;
          // 实时更新 UI
          updateResultText(fullText);
        }
      }
    }
  }
}
```

**SSE 数据格式**:
```
data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"识"}}]}

data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"别"}}]}

data: [DONE]
```

### 2.5 结果展示模块

**文件**: `content/content-ocr.js`

**功能特性**:
- ✅ 可拖动面板
- ✅ 截图预览
- ✅ 复制结果
- ✅ 重新识别
- ✅ 流式输出实时更新

---

## 3. 数据流转

### 3.1 完整流程

```
[1] 用户触发 OCR
     ↓
[2] content-ocr.js: startSelection()
     显示遮罩层和选择框
     ↓
[3] 用户拖动鼠标选择区域
     onMouseDown → onMouseMove → onMouseUp
     ↓
[4] 获取区域坐标 rect = { left, top, width, height }
     detectAndAdjustCoordinates() 坐标校正
     ↓
[5] 发送消息给 Background
     chrome.runtime.sendMessage({
       action: 'performOCR',
       rect: rect
     })
     ↓
[6] backgrounds/ocr.js: handleOCRRequest()
     chrome.tabs.captureVisibleTab() 获取完整截图
     ↓
[7] Background 返回截图
     sendResponse({ dataUrl, rect })
     ↓
[8] content-ocr.js: cropImage(dataUrl, rect)
     Canvas 裁剪出选定区域
     ↓
[9] 调用 OCR API
     fetch('https://open.bigmodel.cn/...')
     ↓
[10] API 返回识别结果
      非流式: 等待完整响应
      流式: SSE 逐字输出
      ↓
[11] 显示结果
      showResultPanel(text, image)
```

### 3.2 数据结构

**选择区域数据**:
```javascript
{
  left: 100,      // X 坐标
  top: 200,       // Y 坐标
  width: 300,     // 宽度
  height: 150     // 高度
}
```

**API 请求格式**:
```javascript
{
  model: "glm-4.5v",
  messages: [{
    role: "user",
    content: [
      { type: "image_url", image_url: { url: "base64..." } },
      { type: "text", text: "请识别图片中的文字" }
    ]
  }],
  stream: true/false
}
```

---

## 4. 关键技术

### 4.1 坐标系统处理

**问题**: 页面可能有各种变换（transform、zoom、scale），导致坐标不准确。

**解决方案**:
```javascript
function detectBrowserZoom() {
  const testDiv = document.createElement('div');
  testDiv.style.cssText = 'width: 100px;';
  document.body.appendChild(testDiv);

  const rect = testDiv.getBoundingClientRect();
  const zoom = rect.width / 100;  // 实际宽度 / 期望宽度

  document.body.removeChild(testDiv);
  return zoom;
}
```

### 4.2 Canvas 裁剪

**核心**: 使用 Canvas 的 `drawImage` 方法进行精确裁剪。

```javascript
ctx.drawImage(
  sourceImage,
  sourceX, sourceY, sourceWidth, sourceHeight,
  destX, destY, destWidth, destHeight
);
```

### 4.3 SSE 流式解析

**核心**: 逐行解析 Server-Sent Events 格式。

```javascript
while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      // 处理数据
    }
  }
}
```

### 4.4 AbortController

**用途**: 取消正在进行的 API 请求。

```javascript
const abortController = new AbortController();

fetch(url, {
  signal: abortController.signal  // 关联信号
});

// 取消请求
abortController.abort();
```

---

## 5. 代码示例

### 5.1 完整的 OCR 调用流程

```javascript
// 1. 开始选择
function startOCR() {
  startSelection();  // 显示选择界面
}

// 2. 完成选择后
async function performOCR(rect) {
  // 获取截图
  const response = await chrome.runtime.sendMessage({
    action: 'performOCR',
    rect: rect
  });

  // 裁剪图片
  const croppedImage = await cropImage(
    response.dataUrl,
    response.rect
  );

  // 调用 API
  const result = await callOCRApiNonStream(
    croppedImage,
    '请识别图片中的文字'
  );

  // 显示结果
  showResultPanel(result, croppedImage);
}
```

### 5.2 拖动面板实现

```javascript
function setupDraggable(panel) {
  const header = panel.querySelector('#ocr-panel-header');
  let isDragging = false;
  let startX, startY, initialX, initialY;

  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = panel.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    panel.style.left = (initialX + dx) + 'px';
    panel.style.top = (initialY + dy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}
```

---

## 总结

OCR 功能的核心实现：

1. **区域选择**: Canvas + 鼠标事件
2. **截图获取**: chrome.tabs.captureVisibleTab
3. **图片裁剪**: Canvas drawImage
4. **API 调用**: fetch + SSE
5. **结果展示**: 可拖动面板

**技术亮点**:
- 🎯 精确的坐标校正算法
- 🚀 支持 SSE 流式输出
- 🖱️ 可拖动的结果面板
- 🔄 支持重新识别
