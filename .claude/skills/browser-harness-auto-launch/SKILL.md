---
name: browser-harness-auto-launch
description: 当需要使用 browser-harness 进行浏览器自动化、网页爬取、CDP 操作、数据提取时触发。核心原则是：自己启动浏览器，不询问用户。
---

# Browser Harness — 自动启动与执行

## 触发条件

- "用 browser-harness 打开/抓取/爬取..."
- "提取网页内容"
- "CDP 操作"
- "浏览器自动化"
- 任何涉及 browser-harness、网页截图、DOM 提取的任务

## 核心原则

**不要问用户 Chrome 是否已打开。自己去启动、自己去连接、自己去重试。**

## 自动启动流程

### Step 1: 直接执行 browser-harness

```bash
browser-harness -c 'print(page_info())'
```

`run.py` 内部会调用 `ensure_daemon()`，它会自动：
1. 查找本地已运行的 Chrome（端口 9222）
2. 如果找到，直接连接
3. 如果没找到，自动启动 Chrome（带 `--remote-debugging-port=9222`）

**你不需要、也不应该手动启动 Chrome。**

### Step 2: 如果连接失败（极少数）

Windows 下手动兜底：
```powershell
Start-Process "chrome" -ArgumentList "--remote-debugging-port=9222","--user-data-dir=$env:TEMP\chrome_dev"
```

然后再执行 browser-harness。

## 脚本编写规范

### 避免内联复杂字符串

browser-harness `-c` 参数对引号和转义极度敏感。**复杂脚本不要内联**，先写文件再执行：

```bash
# 错误：内联多行字符串，转义地狱
browser-harness -c 'js("""...""")'  # 极易失败

# 正确：写 .py 文件后执行
browser-harness -c "exec(open('extract.py').read())"
```

### 优先使用 evaluate_script (CDP)

当 browser-harness 内联脚本反复因转义失败时，**切换到 mcp__chrome-devtools__evaluate_script**：

```javascript
// 直接执行，无 shell 转义问题
() => {
  const links = new Set();
  document.querySelectorAll('a[href*="/video/BV"]').forEach(a => {
    const href = a.getAttribute('href');
    const match = href.match(/\/video\/BV[a-zA-Z0-9]+/);
    if (match) links.add('https://www.bilibili.com' + match[0]);
  });
  return Array.from(links);
}
```

## 典型工作流模板

### 网页数据提取

```python
from agent_helpers import *

# 1. 导航
goto_url("https://example.com")
wait_for_load()
sleep(2)

# 2. 滚动加载（如需）
for i in range(5):
    scroll_down(800)
    sleep(1)

# 3. 提取
result = js("""
  // DOM extraction logic
""")
print(result)
```

### 分页遍历

SPA 分页（无刷新）：点击后 `sleep(2)` 等待 DOM 更新，再提取。

```python
while True:
    # extract current page
    result = js("...")
    
    # check next
    has_next = js("...")
    if not has_next: break
    
    # click next
    js("document.querySelector('.next-page').click()")
    sleep(2)  # wait for XHR + re-render
```

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 问用户"Chrome 打开了吗" | 打断用户、降低效率 | 直接执行 browser-harness，`ensure_daemon()` 会自动处理 |
| 内联复杂 JS 到 browser-harness `-c` | 引号转义失败，SyntaxError | 写 `.py` 文件再 `exec(open('file').read())`，或改用 CDP evaluate_script |
| 直接拼接 `href` 和 origin | Bilibili 的 `href` 可能已带 `//www.bilibili.com`，导致 `https://www.bilibili.com//www.bilibili.com/...` | 用正则提取 path：`href.match(/\/video\/BV[a-zA-Z0-9]+/)`，再拼接 |
| SPA 分页点击后立即提取 | 拿到的是旧页面数据 | 点击后 `sleep(2)` 或等待特定元素变化 |
| 假设页面一次性渲染全部内容 | 懒加载导致漏数据 | 先 `scroll_down(800)` 多次再提取 |
| 用 `goto_url` 替代 `new_tab` | 覆盖用户当前正在使用的标签页 | 首导航用 `new_tab(url)` |

## 坑点速查

1. **daemon 自动启动** — 不要手动 `ensure_daemon()`，run.py 已内置
2. **首导航用 new_tab** — `goto_url` 会覆盖用户当前标签页
3. **evaluate_script 无转义问题** — 当 browser-harness 字符串反复失败时，切换到 CDP
4. **sleep 是必要等待** — SPA 页面、XHR 请求、懒加载都需要显式 sleep，不要依赖 `wait_for_load()` alone
5. **去重用 Set** — 同一页面可能存在多个指向同一视频的 `<a>` 标签（标题 + 缩略图）
