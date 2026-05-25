---
name: browser-js-inject
description: 通过 browser-harness 或 CDP 向浏览器注入 JS 脚本并执行自动化测试，确保稳定可靠的跨平台执行
---

# Browser JS 注入与测试稳定执行

## 触发场景

- 需要向浏览器页面注入 JS 提取数据
- 需要编写控制台脚本供用户直接执行
- 使用 browser-harness 进行浏览器自动化
- 通过 CDP (Chrome DevTools Protocol) 执行 JS

## 核心原则

**先避坑，再执行。** Windows + 中文环境 + browser-harness 的组合有极高的编码和进程坑点率。

---

## 执行流程

### Step 1: 确保 Chrome CDP 可连接

```bash
# 检查端口
browser-harness --doctor

# 若 CDP 不可连，先杀现有 Chrome 再启动（Windows 单例问题）
powershell -Command "Stop-Process -Name chrome -Force; Start-Sleep -Seconds 2; Start-Process 'chrome' -ArgumentList '--remote-debugging-port=9222','--user-data-dir=C:\temp\chrome_harness'"

# 验证
curl -s http://127.0.0.1:9222/json/version
```

### Step 2: browser-harness 正确调用格式

**必须**使用 heredoc，**禁用** `-c` 参数：

```bash
# ✅ 正确
export BU_CDP_URL=http://127.0.0.1:9222
browser-harness <<'PY'
new_tab("https://example.com")
wait_for_load()
wait(2)
result = js("document.title")
print(result)
PY

# ❌ 错误 — 不支持 -c
browser-harness -c "print(page_info())"
```

### Step 3: JS 脚本编写规范

#### 3.1 选择器策略

优先 CSS Selector，必要时 XPath fallback：

```javascript
// 优先：CSS 选择器
const links = document.querySelectorAll('a[href*="/video/BV"]');

// 兜底：XPath
const xpathResult = document.evaluate(
  '//a[contains(@href, "/video/BV")]',
  document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
);
```

#### 3.2 去重策略

SPA 页面中同一视频可能有多个 `<a>` 标签（缩略图 + 标题）：

```javascript
// ✅ 用 Map 按 BV 号去重，保持顺序
const results = new Map();
document.querySelectorAll('a[href*="/video/BV"]').forEach(a => {
  const m = a.getAttribute('href').match(/BV[a-zA-Z0-9]+/);
  if (m && !results.has(m[0])) {
    results.set(m[0], 'https://www.bilibili.com/video/' + m[0]);
  }
});
const urls = Array.from(results.values());
```

#### 3.3 异步翻页等待

SPA 页面点击后需显式等待，不要依赖 `wait_for_load()`：

```javascript
// ✅ browser-harness 内
clickNextPage();
wait(2500);  // SPA 异步加载

// ✅ 控制台脚本内
await sleep(2500);
```

#### 3.4 安全限制

```javascript
// 防死循环：最大页数限制
if (pageNum > 20) {
  console.log('[安全限制] 超过最大页数');
  break;
}
```

### Step 4: Windows 编码避坑（生死攸关）

| 场景 | 坑点 | 正确做法 |
|------|------|---------|
| 输出中文到控制台 | `UnicodeEncodeError: 'gbk' codec can't encode` | **禁止直接 print 中文**，写入文件 |
| 读取 JS 脚本文件 | Python 默认 `gbk`，UTF-8 脚本报错 | `open('file.js', encoding='utf-8')` |
| browser-harness 返回 JSON | `json.dumps` + 中文 + stdout = 崩溃 | 结果写入 `.json` 文件，再读取 |

#### 结果输出模板（browser-harness）

```python
# ✅ 正确：写入文件
urls = js("window.__extractedUrls")
with open('result.json', 'w', encoding='utf-8') as f:
    import json
    json.dump(urls, f, ensure_ascii=False, indent=2)
print('Saved', len(urls), 'items')

# ❌ 错误：直接 print 中文列表
print(json.dumps(urls, ensure_ascii=False))  # Windows 会炸
```

### Step 5: MCP CDP vs browser-harness 选择

| 场景 | 推荐工具 | 原因 |
|------|---------|------|
| 复杂自动化流程（翻页、等待、截图） | **browser-harness** | 内置 `js()`, `wait()`, `scroll()`，错误信息更友好 |
| 单次简单 JS 执行 | MCP `chrome_javascript` | 无需 heredoc，无编码问题 |
| 获取页面可见文本/HTML | MCP `chrome_get_web_content` | 快速读取 |
| SPA 数据提取 | **browser-harness `js()`** | `chrome_get_web_content` 对 SPA 常返回空/残缺 |

**重要：** 当 `chrome_get_web_content` 返回空或 `<body></body>` 时，立即切换到 `js()` 通过 DOM 查询。

---

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `browser-harness -c '...'` | 参数不支持，直接报错 | `browser-harness <<'PY' ... PY` |
| 已有 Chrome 时启动 `--remote-debugging-port` | 单例模式合并进程，端口未开 | 先 `Stop-Process -Name chrome` |
| 直接 `print(json.dumps(..., ensure_ascii=False))` | Windows GBK 编码报错 | 写入 `encoding='utf-8'` 文件 |
| `open('script.js').read()` 无 encoding | GBK 解码 UTF-8 中文失败 | `open('script.js', encoding='utf-8')` |
| MCP `chrome_get_web_content` 取 SPA | 返回空或残缺 DOM | 改用 `js()` 直接操作 DOM |
| 点击翻页后立即提取 | 拿到旧页面数据 | 点击后 `wait(2500)` |
| 用 `Set` 去重但不做 URL 归一化 | `BVxxx?spm=...` 和 `BVxxx` 被视为不同 | 提取 BV 号作为 key |
| 内联复杂多行 JS 到 `-c` | 引号转义地狱，SyntaxError | 写文件再 `exec(open('file').read())` |
| `goto_url` 覆盖用户当前标签 | 丢失用户正在浏览的页面 | 首导航用 `new_tab(url)` |

---

## 控制台脚本交付规范

当用户要求"写个脚本让我在控制台执行"时：

1. **必须**使用 IIFE + async：
   ```javascript
   (async function() { ... })();
   ```

2. **必须**把结果挂到 `window` 上，方便验证：
   ```javascript
   window.__myResult = urls;
   ```

3. **必须**输出多种格式（序号列表、JSON、纯文本）：
   ```javascript
   console.log(urls.join('\n'));  // 用户最容易复制
   console.log(JSON.stringify(urls, null, 2));  // 程序员友好
   ```

4. **必须**在 browser-harness 中先测试验证，确认输出数量正确后再交付

---

## 测试检查清单

- [ ] `browser-harness --doctor` 通过或 CDP 端口可 curl
- [ ] 脚本在 browser-harness 中执行无报错
- [ ] 提取数量与用户预期一致（如 50 个）
- [ ] 翻页逻辑正确（非第一页也能执行）
- [ ] 无重复链接
- [ ] 控制台版本可直接复制粘贴执行
