/**
 * OCR 处理模块
 * 负责处理 OCR 相关的截图和识别请求
 */

/**
 * 处理 OCR 请求 - 使用 captureVisibleTab 获取截图
 * @param {Object} request - 请求对象，包含 rect 区域信息
 * @returns {Promise} OCR 识别结果
 */
export async function handleOCRRequest(request) {
  try {
    const { rect } = request;

    console.log('[OCR] 收到 OCR 请求，区域:', rect);

    // 使用 captureVisibleTab 获取当前窗口的完整截图
    // 注意：captureVisibleTab 第一个参数在 Manifest V3 中应该是 windowId
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

/**
 * 初始化 OCR 模块
 * 目前不需要额外的初始化逻辑
 */
export function setupOCR() {
  console.log('[OCR] OCR 模块已初始化');
}
