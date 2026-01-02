# Markdown 与公式渲染实现文档

## 目录
1. [渲染架构概述](#渲染架构概述)
2. [Markdown 渲染流程](#markdown-渲染流程)
3. [LaTeX 公式渲染](#latex-公式渲染)
4. [代码实现细节](#代码实现细节)
5. [实际应用示例](#实际应用示例)

---

## 渲染架构概述

本插件使用 **Marked.js** 进行 Markdown 渲染，结合 **KaTeX** 进行数学公式渲染，实现富文本输出。

### 技术栈

| 库名称 | 用途 | 特点 |
|--------|------|------|
| Marked.js | Markdown → HTML 转换 | 快速、轻量、可配置 |
| KaTeX | LaTeX 数学公式渲染 | 高性能、无依赖、高质量 |

### 架构设计

```
LLM 响应文本
     │
     ▼
┌─────────────────────────┐
│  公式检测与占位符替换    │  ← 优先提取 LaTeX 公式
└─────────────────────────┘
     │
     ▼ (带占位符的文本)
┌─────────────────────────┐
│    Marked.js 解析        │  ← Markdown → HTML
└─────────────────────────┘
     │
     ▼ (HTML + 占位符)
┌─────────────────────────┐
│    KaTeX 渲染公式        │  ← 替换占位符为公式
└─────────────────────────┘
     │
     ▼
  最终 HTML 输出
```

---

## Markdown 渲染流程

### 1. 配置阶段（一次性）

**文件位置**: [`content/content.js:118-132`](../content/content.js#L118-L132)

```javascript
let markedConfigured = false;

function configureMarked() {
  if (markedConfigured || typeof marked === 'undefined') return;

  // 配置 Marked.js 选项
  marked.setOptions({
    breaks: true,      // 支持 GitHub 风格的换行
    gfm: true,         // GitHub Flavored Markdown
    headerIds: false,  // 不生成 header id (避免 XSS)
    mangle: false      // 不转义邮箱地址
  });

  markedConfigured = true;
}
```

**配置项说明**:

| 选项 | 值 | 说明 |
|------|-----|------|
| `breaks` | `true` | 单个换行符转换为 `<br>` |
| `gfm` | `true` | 启用 GitHub 扩展语法（表格、删除线、任务列表等） |
| `headerIds` | `false` | 不生成确定性 id，防止 XSS 攻击 |
| `mangle` | `false` | 不混淆邮箱地址 |

**为什么只配置一次？**
- `marked.setOptions()` 会修改全局配置
- 重复配置会覆盖之前的设置
- 使用标志位 `markedConfigured` 避免重复调用

### 2. 渲染流程

**文件位置**: [`content/content.js:163-206`](../content/content.js#L163-L206)

```javascript
async function renderMarkdown(markdown) {
  if (!markdown) return '';

  try {
    // 1. 确保已配置
    configureMarked();

    // 2. Markdown → HTML
    let html = marked.parse(markdown);

    // 3. 渲染 LaTeX 公式
    html = html.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, latex) => {
      return renderLatex(latex.trim(), true);  // 块级公式
    });

    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
      return renderLatex(latex.trim(), true);  // 块级公式
    });

    html = html.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, latex) => {
      return renderLatex(latex.trim(), false);  // 行内公式
    });

    html = html.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
      return renderLatex(latex.trim(), false);  // 行内公式
    });

    // 4. 处理括号内的公式
    html = html.replace(/\(([^)]+)\)/g, (match, content) => {
      const hasMathSymbols = /[_^\\]|\\[a-zA-Z]|\\frac|\\sum|\\int|\\prod|[α-ω]/.test(content);
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
```

**渲染顺序的重要性**:

1. **先处理块级公式** (`\[...\]`, `$$...$$`)
   - 最长匹配优先，避免误识别
   - 例如：`\[x^2\]` 不会被误识别为行内公式

2. **再处理行内公式** (`\(...\)`、`$...$`)
   - 较短的匹配模式
   - 避免与块级公式冲突

3. **最后处理括号公式** (`(x^2)`)
   - 使用启发式规则（检测数学符号）
   - 避免误识别普通英文括号

---

## LaTeX 公式渲染

### 支持的公式格式

| 格式 | 示例 | 渲染模式 | 使用场景 |
|------|------|----------|----------|
| `\[...\]` | `\[x^2 + y^2 = r^2\]` | 块级 | 标准 LaTeX 块级公式 |
| `$$...$$` | `$$E = mc^2$$` | 块级 | Markdown 习惯用法 |
| `\(...\)` | `\(α + β\)` | 行内 | 标准 LaTeX 行内公式 |
| `$...$` | `$\sum_{i=1}^{n}$` | 行内 | 简写形式 |
| `(x^2)` | `(8 = 2^3)` | 行内 | 启发式识别 |

### KaTeX 配置

**文件位置**: [`content/content.js:137-158`](../content/content.js#L137-L158)

```javascript
function renderLatex(latex, displayMode = false) {
  if (typeof katex === 'undefined') {
    console.error('KaTeX is not loaded');
    return `<code>${latex}</code>`;
  }

  // 预处理：特殊格式转换
  let processedLatex = latex.replace(/\\ /g, '\\;');

  try {
    return katex.renderToString(processedLatex, {
      displayMode: displayMode,    // 块级或行内模式
      throwOnError: false,        // 出错时不抛异常
      strict: 'ignore',            // 宽松模式
      trust: false,                // 不信任输入（安全）
      output: 'html'               // 输出 HTML
    });
  } catch (error) {
    console.warn('KaTeX rendering failed:', error);
    return latex.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
```

**配置项说明**:

| 选项 | 值 | 说明 |
|------|-----|------|
| `displayMode` | `true/false` | 块级模式居中显示，行内模式内联显示 |
| `throwOnError` | `false` | 解析失败时显示原始文本，不中断渲染 |
| `strict` | `'ignore'` | 宽松模式，忽略非标准语法警告 |
| `trust` | `false` | 不信任输入，防止注入攻击 |
| `output` | `'html'` | 输出 HTML 格式 |

### 特殊格式处理

**问题**: AI 输出的公式可能包含非标准格式

例如：
```latex
010\ 111\ 011  # 反斜杠+空格，表示间距
```

**解决方案**: 预处理转换为标准 LaTeX

```javascript
// 将 \ `（反斜杠+空格）转换为 LaTeX 的间距命令
processedLatex = processedLatex.replace(/\\ /g, '\\;');
```

转换后：
```latex
010\;111\;011  # 标准间距命令
```

### 公式检测规则

#### 1. 美元符号格式验证

为了避免误识别普通文本为公式（如 `$100`），需要验证：

```javascript
html = html.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
  // 检查是否包含数学符号
  if (/[\\α-ωΑ-Ω\s+\-*=^_{}/()]/.test(latex)) {
    return renderLatex(latex.trim(), false);
  }
  return match;  // 不是公式，保持原样
});
```

**识别为公式的条件**:
- 包含反斜杠命令 (`\alpha`, `\sum`)
- 包含希腊字母 (`α`, `β`, `ω`)
- 包含数学符号 (`+`, `-`, `*`, `=`, `^`, `_`, `{`, `}`)

#### 2. 括号公式启发式规则

```javascript
html = html.replace(/\(([^)]+)\)/g, (match, content) => {
  // 必须同时满足：
  // 1. 包含下标或上标 (_^)
  // 2. 不包含连续 3 个以上英文字母
  const hasMathSymbols = /[_^\\]|\\[a-zA-Z]|\\frac|\\sum|[α-ω]/.test(content);

  if (hasMathSymbols) {
    return '(' + renderLatex(content.trim(), false) + ')';
  }
  return match;
});
```

**示例**:
- `(x^2 + y^2)` → ✅ 识别为公式
- `(8 = 2^3)` → ✅ 识别为公式
- `(apple)` → ❌ 不识别（纯英文）
- `(3 + 5)` → ❌ 不识别（无数学符号）

---

## 代码实现细节

### 1. 划词翻译模块 (content.js)

**渲染函数**:
- `configureMarked()` - 配置 marked.js
- `renderLatex()` - 渲染 LaTeX 公式
- `renderMarkdown()` - 完整渲染流程

**调用位置**:
```javascript
// 非流式结果显示
async function showResultPanel(originalText, resultText) {
  const html = await renderMarkdown(resultText);
  resultTextElement.innerHTML = html;
}

// 流式输出更新
async function updateResultText(text) {
  const html = await renderMarkdown(text);
  resultTextElement.innerHTML = html;
}
```

### 2. OCR 模块 (content-ocr.js)

**渲染函数**（命名带 `ocr` 前缀避免冲突）:
- `ocrConfigureMarked()` - 配置 marked.js
- `ocrRenderLatex()` - 渲染 LaTeX 公式
- `ocrRenderMarkdown()` - 完整渲染流程

**为什么需要命名前缀？**
- 所有 content scripts 共享同一全局作用域
- 避免变量名冲突（如 `markedConfigured`）
- 使用 IIFE 或前缀是常见做法

### 3. 流式输出渲染优化

**问题**: 流式输出时，每次都完整渲染整个文本效率低

**解决方案**: 使用 `requestAnimationFrame` 优化

```javascript
const mainOutputCallback = (textChunk) => {
  return new Promise((resolve) => {
    requestAnimationFrame(async () => {
      fullMainText += textChunk;
      const html = await renderMarkdown(fullMainText);
      resultTextElement.innerHTML = html;
      resolve();
    });
  });
};
```

**优化效果**:
- 浏览器在下一帧渲染，避免阻塞
- 自动合并多次更新
- 用户体验更流畅

---

## 实际应用示例

### 示例 1: 简单 Markdown

**输入**:
```markdown
# 数学公式

这是一段行内公式 $E = mc^2$ 的例子。

块级公式示例：
$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$
```

**输出**:
```html
<h1>数学公式</h1>
<p>这是一段行内公式 <span class="katex">E = mc^2</span> 的例子。</p>
<p>块级公式示例：</p>
<div class="katex-display">
  \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
</div>
```

### 示例 2: 复杂文档

**输入**:
```markdown
## 概率论

### 条件概率

$$P(A|B) = \frac{P(A \cap B)}{P(B)}$$

### 贝叶斯定理

对于事件 $A_1, A_2, \dots, A_n$：
$$P(A_k|B) = \frac{P(B|A_k)P(A_k)}{\sum_{i=1}^{n}P(B|A_i)P(A_i)}$$
```

**渲染流程**:
1. Markdown 解析：标题、段落结构
2. 块级公式渲染：独立居中显示
3. 行内公式渲染：嵌入段落中
4. KaTeX 应用样式：数学字体、符号

### 示例 3: 思考模式渲染

**文件位置**: [`content/content.js:565-576`](../content/content.js#L565-L576)

```javascript
const thinkingOutputCallback = (textChunk) => {
  return new Promise((resolve) => {
    requestAnimationFrame(async () => {
      fullThinkingText += textChunk;
      const html = await renderMarkdown(fullThinkingText);
      thinkingContent.innerHTML = html;  // 思考区域独立渲染
      resolve();
    });
  });
};
```

**特点**:
- 思考内容和主回答分别渲染
- 使用相同的渲染函数
- 独立的 DOM 容器
- 可折叠显示

---

## 总结

### 渲染流程要点

1. **配置一次**: `markedConfigured` 标志避免重复配置
2. **公式优先**: 先提取公式避免被 Markdown 解析破坏
3. **顺序处理**: 块级 → 行内 → 括号，避免冲突
4. **错误容忍**: `throwOnError: false` 确保渲染不中断

### 性能优化

1. **RAF 优化**: `requestAnimationFrame` 合并更新
2. **异步渲染**: `async/await` 避免阻塞主线程
3. **完整渲染**: 流式输出时渲染完整文本（Marked.js 足够快）

### 安全考虑

1. **XSS 防护**: `headerIds: false` 不生成确定性 id
2. **输入验证**: `trust: false` 不信任用户输入
3. **HTML 转义**: 错误时转义 `<` 和 `>`

---

**相关文档**:
- [06-库文件注入机制.md](./06-库文件注入机制.md) - 了解 Marked.js 和 KaTeX 如何注入
- [07-JS注入与性能优化.md](./07-JS注入与性能优化.md) - 深入性能优化策略

**版本**: v1.0
**最后更新**: 2026-01-02
