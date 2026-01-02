/**
 * 划词翻译/识别模块
 * 使用与 OCR 相同的固定面板结构，支持 LLM 文本处理
 */

// 全局状态
let resultPanel = null;
let lastSelection = '';
let currentAbortController = null;
let isUserScrolling = false;

// API 配置（与 OCR 相同）
const API_CONFIG = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: 'd237351671da318126fb5bd2f1372a08.EdkVfX8wE0JtcZpP',
  model: 'glm-4-flash'  // 使用更快的模型用于文本处理
};

// 设置状态
let settings = {
  autoTranslate: false,
  showContextMenu: true,
  translatePrompt: '请解释 %s'  // 默认提示词
};

// 标记设置是否已加载
let settingsInitialized = false;

// 收藏快捷键
let favoritesShortcut = null;
let favoritesShortcutPressed = false;

// ========== Marked.js + KaTeX 渲染（共享代码） ==========

let markedConfigured = false;

/**
 * 配置 marked.js（只执行一次）
 */
function configureMarked() {
  if (markedConfigured || typeof marked === 'undefined') return;

  marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false
  });

  markedConfigured = true;
}

/**
 * 渲染 LaTeX 数学公式为 HTML
 */
function renderLatex(latex, displayMode = false) {
  if (typeof katex === 'undefined') {
    console.error('KaTeX is not loaded');
    return `<code>${latex}</code>`;
  }

  let processedLatex = latex;
  processedLatex = processedLatex.replace(/\\ /g, '\\;');

  try {
    return katex.renderToString(processedLatex, {
      displayMode: displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'html'
    });
  } catch (error) {
    console.warn('KaTeX rendering failed:', error, 'for latex:', latex);
    return latex.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

/**
 * 使用 marked.js 渲染 Markdown，并渲染 KaTeX 数学公式
 */
async function renderMarkdown(markdown) {
  if (!markdown) return '';

  try {
    if (typeof marked === 'undefined') {
      console.error('marked.js is not loaded');
      return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    configureMarked();
    let html = marked.parse(markdown);

    // 渲染 LaTeX 数学公式
    html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, latex) => {
      return renderLatex(latex.trim(), true);
    });

    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
      return renderLatex(latex.trim(), true);
    });

    html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => {
      return renderLatex(latex.trim(), false);
    });

    html = html.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
      return renderLatex(latex.trim(), false);
    });

    // 处理括号内的 LaTeX 公式
    html = html.replace(/\(([^)]+)\)/g, (match, content) => {
      const hasMathSymbols = /[_^\\]|\\[a-zA-Z]|\\frac|\\sum|\\int|\\prod|[αβγδεζηθικλμνξπρστυφχψω]/.test(content);
      if (hasMathSymbols) {
        return '(' + renderLatex(content.trim(), false) + ')';
      }
      return match;
    });

    return html;
  } catch (error) {
    console.error('Markdown rendering failed:', error);
    return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ========== 面板管理 ==========

/**
 * 创建结果面板（与 OCR 相同的结构）
 */
function createResultPanel() {
  const panel = document.createElement('div');
  panel.id = 'selection-result-panel';
  panel.className = 'selection-result-panel';
  panel.style.display = 'flex';
  panel.style.visibility = 'hidden';

  panel.innerHTML = `
    <div class="panel-header">
      <span>📝 划词识别</span>
      <button id="selection-close-result">&times;</button>
    </div>
    <!-- 原文区域 -->
    <div class="original-text-section">
      <div class="section-title">📄 原文</div>
      <div id="selection-original-text" class="original-text-content"></div>
    </div>
    <!-- 主回答区域容器 -->
    <div class="content-section">
      <div id="selection-result-text">正在处理中...</div>
    </div>
    <!-- 底部按钮区域 -->
    <div class="footer-section">
      <button id="selection-copy-original">📋 复制原文</button>
      <button id="selection-copy-result">📋 复制结果</button>
      <button id="selection-add-favorites">⭐ 收藏</button>
      <button id="selection-close-panel">关闭</button>
    </div>
  `;

  document.body.appendChild(panel);

  // 绑定按钮事件
  panel.querySelector('#selection-close-result').addEventListener('click', hideResultPanel);
  panel.querySelector('#selection-close-panel').addEventListener('click', hideResultPanel);
  panel.querySelector('#selection-copy-original').addEventListener('click', copyOriginalText);
  panel.querySelector('#selection-copy-result').addEventListener('click', copyResult);
  panel.querySelector('#selection-add-favorites').addEventListener('click', addCurrentToFavorites);

  // 绑定拖动功能
  setupDraggable(panel);

  // 绑定滚动行为
  setupScrollBehavior(panel);

  return panel;
}

/**
 * 设置面板拖动功能
 */
function setupDraggable(panel) {
  const header = panel.querySelector('.panel-header');
  if (!header) return;

  let isDragging = false;
  let startX, startY, initialX, initialY;

  header.addEventListener('mousedown', (e) => {
    if (e.target.id === 'selection-close-result') return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = panel.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;

    header.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newX = initialX + dx;
    let newY = initialY + dy;

    const maxX = window.innerWidth - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    requestAnimationFrame(() => {
      panel.style.left = newX + 'px';
      panel.style.top = newY + 'px';
      panel.style.right = 'auto';
    });
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'move';
    }
  });
}

/**
 * 设置面板滚动行为
 */
function setupScrollBehavior(panel) {
  const resultTextElement = panel.querySelector('#selection-result-text');
  if (!resultTextElement) return;

  let scrollTimeout = null;

  resultTextElement.addEventListener('scroll', () => {
    isUserScrolling = true;

    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    scrollTimeout = setTimeout(() => {
      isUserScrolling = false;
    }, 2000);
  });
}

/**
 * 显示结果面板
 */
async function showResultPanel(originalText, resultText) {
  if (!resultPanel) {
    resultPanel = createResultPanel();
  }

  // 显示原文
  const originalTextElement = document.getElementById('selection-original-text');
  if (originalTextElement) {
    originalTextElement.textContent = originalText;
  }

  // 渲染结果
  const resultTextElement = document.getElementById('selection-result-text');
  if (resultTextElement) {
    const html = await renderMarkdown(resultText);
    resultTextElement.innerHTML = html;
  }

  resultPanel.style.visibility = 'visible';
}

/**
 * 更新结果面板（用于流式输出）
 */
async function updateResultText(text) {
  const resultTextElement = document.getElementById('selection-result-text');
  if (resultTextElement) {
    const html = await renderMarkdown(text);
    resultTextElement.innerHTML = html;

    // 智能滚动
    const isAtBottom = resultTextElement.scrollHeight - resultTextElement.scrollTop - resultTextElement.clientHeight < 50;

    if (isAtBottom && !isUserScrolling) {
      resultTextElement.scrollTop = resultTextElement.scrollHeight;
    }
  }
}

/**
 * 隐藏结果面板
 */
function hideResultPanel() {
  if (resultPanel) {
    resultPanel.style.visibility = 'hidden';
  }
}

// ========== API 调用 ==========

/**
 * 调用 LLM API 处理文本（非流式）
 */
async function callLLMNonStream(text, prompt) {
  const apiUrl = `${API_CONFIG.baseURL}/chat/completions`;

  // 替换提示词中的占位符
  const finalPrompt = prompt.replace('%s', text);

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
            content: finalPrompt
          }
        ],
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content || '无法获取结果';
    }

    return '无法获取结果';
  } catch (error) {
    throw new Error('API 调用失败: ' + error.message);
  }
}

/**
 * 调用 LLM API 处理文本（流式）
 */
async function callLLMStream(text, prompt) {
  const apiUrl = `${API_CONFIG.baseURL}/chat/completions`;

  // 替换提示词中的占位符
  const finalPrompt = prompt.replace('%s', text);

  currentAbortController = new AbortController();

  const resultTextElement = document.getElementById('selection-result-text');
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
            content: finalPrompt
          }
        ],
        stream: true
      }),
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    // 清空加载状态
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

              if (delta.content) {
                fullText += delta.content;

                // 使用 Markdown 渲染
                const html = await renderMarkdown(fullText);
                resultTextElement.innerHTML = html;

                // 智能滚动
                const isAtBottom = resultTextElement.scrollHeight - resultTextElement.scrollTop - resultTextElement.clientHeight < 50;

                if (isAtBottom && !isUserScrolling) {
                  resultTextElement.scrollTop = resultTextElement.scrollHeight;
                }
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

  } catch (error) {
    if (error.name === 'AbortError') {
      resultTextElement.innerHTML = fullText + '\n\n<p style="color:#999;">[请求已取消]</p>';
    } else {
      throw new Error('API 调用失败: ' + error.message);
    }
  } finally {
    currentAbortController = null;
  }
}

// ========== 处理选中文本 ==========

/**
 * 处理选中的文本
 */
async function processSelectedText(selectedText) {
  if (!selectedText || selectedText === lastSelection) return;

  lastSelection = selectedText;

  // 显示面板和加载状态
  if (!resultPanel) {
    resultPanel = createResultPanel();
  }

  // 显示原文
  const originalTextElement = document.getElementById('selection-original-text');
  if (originalTextElement) {
    originalTextElement.textContent = selectedText;
  }

  // 显示加载状态
  const resultTextElement = document.getElementById('selection-result-text');
  if (resultTextElement) {
    resultTextElement.textContent = '正在处理中...';
  }

  resultPanel.style.visibility = 'visible';

  // 获取提示词设置
  chrome.storage.local.get(['selectionSettings'], async (result) => {
    const selectionSettings = result.selectionSettings || {
      prompt: '请解释 %s',
      stream: true
    };

    const prompt = selectionSettings.prompt;
    const useStream = selectionSettings.stream;

    // 取消之前的请求
    if (currentAbortController) {
      currentAbortController.abort();
    }

    try {
      if (useStream) {
        await callLLMStream(selectedText, prompt);
      } else {
        const apiResult = await callLLMNonStream(selectedText, prompt);
        await updateResultText(apiResult);
      }
    } catch (error) {
      await showResultPanel(selectedText, '处理失败: ' + error.message);
    }
  });
}

// ========== 按钮功能 ==========

/**
 * 复制原文
 */
function copyOriginalText() {
  const originalTextElement = document.getElementById('selection-original-text');
  if (originalTextElement) {
    const text = originalTextElement.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('selection-copy-original');
      const originalText = btn.textContent;
      btn.textContent = '✓ 已复制';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1500);
    }).catch(err => {
      console.error('复制失败:', err);
    });
  }
}

/**
 * 复制结果
 */
function copyResult() {
  const resultTextElement = document.getElementById('selection-result-text');
  if (resultTextElement) {
    const text = resultTextElement.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('selection-copy-result');
      const originalText = btn.textContent;
      btn.textContent = '✓ 已复制';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1500);
    }).catch(err => {
      console.error('复制失败:', err);
    });
  }
}

/**
 * 添加当前文本到收藏
 */
function addCurrentToFavorites() {
  const originalTextElement = document.getElementById('selection-original-text');
  if (originalTextElement) {
    const text = originalTextElement.textContent;
    addToFavorites(text, window.location.href);
    showFavoriteNotification(text);
  }
}

/**
 * 收藏文本到本地存储
 */
function addToFavorites(text, url) {
  chrome.runtime.sendMessage({
    action: 'addToFavorites',
    text: text,
    url: url,
    timestamp: new Date().toISOString()
  });
}

/**
 * 显示收藏成功提示
 */
function showFavoriteNotification(text) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #6c757d;
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 2147483647;
    font-size: 14px;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = `已收藏: "${text.length > 30 ? text.substring(0, 30) + '...' : text}"`;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    }, 300);
  }, 3000);
}

// ========== 收藏快捷键 ==========

/**
 * 检查快捷键是否匹配
 */
function checkFavoritesShortcut(e) {
  if (!favoritesShortcut) {
    return e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key === 'Control';
  }

  return (
    e.ctrlKey === favoritesShortcut.ctrlKey &&
    e.altKey === favoritesShortcut.altKey &&
    e.shiftKey === favoritesShortcut.shiftKey &&
    e.metaKey === favoritesShortcut.metaKey &&
    e.key.toLowerCase() === favoritesShortcut.key.toLowerCase()
  );
}

/**
 * 获取快捷键的主键
 */
function getShortcutMainKey() {
  if (!favoritesShortcut) {
    return 'Control';
  }
  return favoritesShortcut.key;
}

// 监听键盘事件（用于收藏快捷键）
document.addEventListener('keydown', (e) => {
  if (checkFavoritesShortcut(e)) {
    if (favoritesShortcutPressed) return;
    favoritesShortcutPressed = true;

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText) {
      addToFavorites(selectedText, window.location.href);
      showFavoriteNotification(selectedText);
    }
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === getShortcutMainKey().toLowerCase()) {
    favoritesShortcutPressed = false;
  }
});

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (selectedText && favoritesShortcutPressed) {
    addToFavorites(selectedText, window.location.href);
    showFavoriteNotification(selectedText);
  }
});

// ========== 文本选择监听 ==========

document.addEventListener('mouseup', (e) => {
  // 检查设置是否已初始化，以及是否启用了自动翻译
  if (!settingsInitialized) {
    return;
  }

  if (!settings.autoTranslate) {
    return;
  }

  // 延迟一小段时间确保选择完成
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    // 如果有选中文本且与上次不同
    if (selectedText && selectedText !== lastSelection) {
      processSelectedText(selectedText);
    } else if (!selectedText) {
      // 没有选中文本时不隐藏面板，让用户手动关闭
      lastSelection = '';
    }
  }, 100);
});

// ========== 监听来自后台的消息 ==========

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateSettings') {
    settings = { ...settings, ...request.settings };
    sendResponse({ success: true });
  } else if (request.action === 'updateSelectionSettings') {
    // 更新划词翻译设置
    if (request.selectionSettings) {
      if (request.selectionSettings.prompt) {
        settings.translatePrompt = request.selectionSettings.prompt;
      }
    }
    sendResponse({ success: true });
  } else if (request.action === 'showTranslation') {
    // 兼容旧的消息格式
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (selectedText) {
      processSelectedText(selectedText);
    }
  } else if (request.action === 'updateFavoritesShortcut') {
    favoritesShortcut = request.shortcut;
    sendResponse({ success: true });
  } else if (request.action === 'clearFavoritesShortcut') {
    favoritesShortcut = null;
    sendResponse({ success: true });
  } else if (request.action === 'processSelection') {
    // 新增：处理选中文本的消息
    if (request.text) {
      processSelectedText(request.text);
      sendResponse({ success: true });
    }
  }
});

// ========== 点击页面其他地方时的事件 ==========

document.addEventListener('click', (e) => {
  // 如果点击的不是面板内部，也不是在选择文本，则隐藏面板
  if (resultPanel && !resultPanel.contains(e.target)) {
    // 不自动隐藏，让用户手动关闭
  }
});

// ========== 监听 ESC 键 ==========

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideResultPanel();
  }
});

// ========== 初始化 ==========

/**
 * 加载设置
 */
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings', 'selectionSettings'], (result) => {
      const defaultSettings = {
        autoTranslate: false,
        showContextMenu: true
      };

      if (result.settings) {
        settings = { ...defaultSettings, ...result.settings };
      } else {
        settings = { ...defaultSettings };
      }

      // 加载划词设置
      if (result.selectionSettings) {
        settings.translatePrompt = result.selectionSettings.prompt || '请解释 %s';
      }

      settingsInitialized = true;
      resolve(settings);
    });
  });
}

/**
 * 加载收藏快捷键
 */
function loadFavoritesShortcut() {
  chrome.storage.local.get(['favoritesShortcut'], (result) => {
    if (result.favoritesShortcut) {
      favoritesShortcut = result.favoritesShortcut;
    } else {
      favoritesShortcut = null;
    }
  });
}

// 监听 storage 变化
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.settings) {
      settings = { ...settings, ...changes.settings.newValue };
      settingsInitialized = true;
    }

    if (changes.favoritesShortcut) {
      favoritesShortcut = changes.favoritesShortcut.newValue;
    }

    if (changes.selectionSettings) {
      const newSettings = changes.selectionSettings.newValue;
      if (newSettings.prompt) {
        settings.translatePrompt = newSettings.prompt;
      }
    }
  }
});

// 立即加载设置
loadSettings().then(() => {
  console.log('[划词] 设置加载完成');
});

loadFavoritesShortcut();
