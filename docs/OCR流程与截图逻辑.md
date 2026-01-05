# OCR 流程与截图逻辑文档

## 概述

本文档详细说明了浏览器插件中 OCR（光学字符识别）功能的完整流程，重点解释截图获取逻辑和坐标计算机制。

---

## 一、完整的 OCR 操作链路

### 1.1 触发方式

用户可以通过以下两种方式启动 OCR：

| 方式 | 触发位置 | 实现文件 |
|------|----------|----------|
| **右键菜单** | 点击 "📷 OCR 区域识别" | `backgrounds/contextMenu.js` |
| **键盘快捷键** | 用户自定义快捷键（如 Ctrl+Shift+X） | `content/content-ocr.js` |

### 1.2 完整流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OCR 完整操作链路                                   │
└─────────────────────────────────────────────────────────────────────────────┘

  用户触发
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Content Script (content-ocr.js)                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ 1. 创建选择遮罩层 (overlay + selectionBox)                              ││
│  │ 2. 监听鼠标事件：mousedown → mousemove → mouseup                        ││
│  │ 3. 获取用户选择的区域坐标 (CSS 像素)                                     ││
│  │    rawRect = { left, top, width, height }                              ││
│  │                                                                         ││
│  │ 4. 坐标校正 (关键步骤!)                                                 ││
│  │    adjustedRect = detectAndAdjustCoordinates(rawRect)                  ││
│  │                                                                         ││
│  │    检测并校正：                                                         ││
│  │    • CSS transform matrix (缩放因子)                                    ││
│  │    • CSS zoom 属性                                                      ││
│  │    • 浏览器缩放级别                                                      ││
│  │    • devicePixelRatio                                                   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│    │
│    ▼ chrome.runtime.sendMessage({ action: 'performOCR', rect: adjustedRect })
│
├─────────────────────────────────────────────────────────────────────────────┤
│  Background Service Worker (backgrounds/messageHandler.js)                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ 收到消息：action = 'performOCR'                                         ││
│  │                                                                         ││
│  │ ❌ 问题：导入的 './ocr.js' 文件不存在！                                  ││
│  │ import { handleOCRRequest } from './ocr.js';  // ❌ 文件已被删除         ││
│  │                                                                         ││
│  │ 正常流程应该是：                                                         ││
│  │ 1. 使用 chrome.tabs.captureVisibleTab() 获取当前标签页的完整截图        ││
│  │    - 返回的是物理像素分辨率的图片 (base64 dataURL)                      ││
│  │ 2. 将截图 dataURL 和 rect 返回给 content script                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│    │
│    ▼ sendResponse({ success: true, dataUrl: ..., rect: ... })
│
├─────────────────────────────────────────────────────────────────────────────┤
│  Content Script (content-ocr.js) - 继续处理                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ performOCR() 函数接收到响应后：                                          ││
│  │                                                                         ││
│  │ 5. 裁剪图片 (关键步骤!)                                                 ││
│  │    croppedImage = await cropImage(dataUrl, rect)                        ││
│  │                                                                         ││
│  │    使用 Canvas API 裁剪：                                               ││
│  │    • 创建 canvas，大小为裁剪区域大小                                     ││
│  │    • ctx.drawImage(img, rect.left, rect.top, rect.width, rect.height,   ││
│  │                    0, 0, rect.width, rect.height)                       ││
│  │    • 转换为 base64 返回                                                 ││
│  │                                                                         ││
│  │ 6. 显示结果面板                                                         ││
│  │    ocrShowResultPanelWithImage(croppedImage, '正在识别中...')           ││
│  │                                                                         ││
│  │ 7. 调用 GLM-4.5V API                                                    ││
│  │    - 非流式：callOCRApiNonStream()                                      ││
│  │    - 流式：callOCRApiStream()                                           ││
│  │    - API: https://open.bigmodel.cn/api/paas/v4/chat/completions        ││
│  │    - 模型：glm-4.5v                                                     ││
│  │                                                                         ││
│  │ 8. 渲染结果                                                             ││
│  │    - 使用 marked.js 渲染 Markdown                                       ││
│  │    - 使用 katex 渲染 LaTeX 数学公式                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、截图逻辑详解

### 2.1 谁负责截图？

**结论：Background Service Worker 负责截图，使用 Chrome Extension API**

```
chrome.tabs.captureVisibleTab(null, { format: 'png' })
```

- **调用位置**：`backgrounds/ocr.js` 的 `handleOCRRequest()` 函数
- **API 说明**：
  - 只能在 background script 中调用（content script 无权限）
  - 返回当前可见标签页的完整截图
  - 返回格式：base64 编码的 PNG 图片（data URL）
  - **返回的是物理像素分辨率**，不是 CSS 像素

### 2.2 坐标计算逻辑

#### 问题背景

鼠标坐标系统和截图坐标系统不一致：

| 坐标类型 | 单位 | 来源 |
|----------|------|------|
| **鼠标坐标** | CSS 像素 | `event.clientX/Y` |
| **截图坐标** | 物理像素 | `captureVisibleTab()` 返回 |

#### 坐标调整流程（Content Script 负责）

```javascript
// 文件：content/content-ocr.js
// 函数：detectAndAdjustCoordinates(rawRect)

function detectAndAdjustCoordinates(rect) {
  // 1. 检测 CSS transform
  const bodyStyle = window.getComputedStyle(document.body);
  const transform = bodyStyle.transform;
  const zoom = bodyStyle.zoom;

  // 2. 检测 devicePixelRatio
  const devicePixelRatio = window.devicePixelRatio || 1;

  // 3. 检测浏览器缩放级别
  const browserZoom = detectBrowserZoom();

  // 计算总缩放因子
  let scaleAdjustment = 1;

  // 提取 transform matrix 中的缩放
  if (transform && transform !== 'none') {
    const matrix = transform.match(/matrix\((.+)\)/);
    if (matrix) {
      const values = matrix[1].split(', ').map(parseFloat);
      const scaleX = values[0];
      const scaleY = values[3];
      scaleAdjustment *= ((scaleX + scaleY) / 2);
    }
  }

  // CSS zoom
  if (zoom && zoom !== '1' && zoom !== 'normal') {
    scaleAdjustment *= parseFloat(zoom);
  }

  // 浏览器缩放
  if (browserZoom !== 1) {
    scaleAdjustment *= browserZoom;
  }

  // 应用调整
  if (scaleAdjustment !== 1) {
    return {
      left: rect.left / scaleAdjustment,
      top: rect.top / scaleAdjustment,
      width: rect.width / scaleAdjustment,
      height: rect.height / scaleAdjustment
    };
  }

  // devicePixelRatio 调整（通常需要乘以）
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

#### 为什么需要这个调整？

1. **CSS Transform**：某些网站（如知乎）对 body 应用了 `transform: scale()`
2. **CSS Zoom**：部分网站使用 `zoom` 属性缩放页面
3. **浏览器缩放**：用户手动缩放页面（Ctrl + 滚轮）
4. **设备像素比**：高清屏（Retina）的 `devicePixelRatio > 1`

### 2.3 图片裁剪逻辑（Content Script 负责）

```javascript
// 文件：content/content-ocr.js
// 函数：cropImage(dataUrl, rect)

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
      // 参数：源图片, 源X, 源Y, 源宽, 源高, 目标X, 目标Y, 目标宽, 目标高
      ctx.drawImage(
        img,
        rect.left, rect.top, rect.width, rect.height,  // 源区域（从完整截图裁剪）
        0, 0, rect.width, rect.height                   // 目标区域（画布左上角）
      );

      // 转换为 base64
      const croppedDataUrl = canvas.toDataURL('image/png');
      resolve(croppedDataUrl);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
```

**关键点**：
- 使用 HTML5 Canvas API 进行裁剪
- `drawImage()` 从完整截图中提取选定区域
- 转换为 base64 格式发送给 API

---

## 三、当前系统问题

### 3.1 缺失的文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `backgrounds/ocr.js` | ❌ 已删除 | 在 commit `90107ea` "删除冗余的功能" 中被删除 |

### 3.2 错误的导入

```javascript
// backgrounds/messageHandler.js 第 7 行
import { handleOCRRequest } from './ocr.js';  // ❌ 文件不存在
```

这导致 Service Worker 无法加载，报错：
```
Service worker registration failed. Status code: 3
An unknown error occurred when fetching the script.
```

### 3.3 已删除的 ocr.js 内容

```javascript
/**
 * OCR 处理模块 - 负责处理 OCR 相关的截图和识别请求
 */

export async function handleOCRRequest(request) {
  try {
    const { rect } = request;

    console.log('[OCR] 收到 OCR 请求，区域:', rect);

    // 使用 captureVisibleTab 获取当前窗口的完整截图
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

    console.log('[OCR] 截图完成');

    return {
      success: true,
      dataUrl: dataUrl,
      rect: rect
    };

  } catch (error) {
    console.error('[OCR] 错误:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export function setupOCR() {
  console.log('[OCR] OCR 模块已初始化');
}
```

### 3.4 需要修复的地方

1. **恢复 `backgrounds/ocr.js` 文件**，或
2. **移除相关导入**（如果 OCR 功能不再需要）

---

## 四、关键文件说明

| 文件 | 作用 | 关键函数 |
|------|------|----------|
| `content/content-ocr.js` | Content Script，负责 UI 和 API 调用 | `startSelection()`, `detectAndAdjustCoordinates()`, `cropImage()`, `callOCRApiStream()` |
| `backgrounds/messageHandler.js` | Background，处理消息 | `setupMessageHandler()` |
| `backgrounds/contextMenu.js` | Background，右键菜单 | `setupContextMenu()`, `handleContextMenuClick()` |
| `backgrounds/ocr.js` | ❌ 缺失 | `handleOCRRequest()`, `setupOCR()` |

---

## 五、坐标系统总结

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              坐标系统对比                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  鼠标坐标 (CSS 像素)                                                         │
│  ├── 来源：event.clientX/Y                                                  │
│  ├── 单位：CSS 像素                                                         │
│  └── 需要转换为物理像素才能用于截图裁剪                                      │
│                                                                              │
│  截图坐标 (物理像素)                                                         │
│  ├── 来源：chrome.tabs.captureVisibleTab()                                  │
│  ├── 单位：物理像素 (devicePixelRatio × CSS像素)                            │
│  └── 返回完整标签页截图，需要裁剪                                            │
│                                                                              │
│  转换公式：                                                                   │
│  物理像素 = CSS像素 × devicePixelRatio × 缩放因子                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 六、修复建议

### 方案 A：恢复 OCR 功能

1. 恢复 `backgrounds/ocr.js` 文件
2. 恢复 `backgrounds/index.js` 中的 `setupOCR()` 调用

### 方案 B：完全移除 OCR

1. 移除 `messageHandler.js` 中的 `import { handleOCRRequest } from './ocr.js'`
2. 移除 `performOCR` 相关的消息处理逻辑
3. 从 `contextMenu.js` 移除 OCR 菜单项
4. 更新 manifest.json 移除相关权限（如果不再需要）

---

*文档生成时间：2026-01-05*
