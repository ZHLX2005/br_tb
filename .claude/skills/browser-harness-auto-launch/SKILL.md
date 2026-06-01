---
name: browser-harness-auto-launch
description: 当需要使用 browser-harness 进行浏览器自动化、网页爬取、CDP 操作、数据提取时触发。核心原则是：自己启动浏览器，不询问用户。
---
# Browser Harness — 自动启动与执行

加载依赖的 /browser-harness 这个skill 启动浏览器 



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

Windows 下手动兜底命令（**固定 user-data-dir 路径**为 `$env:TEMP\chrome_dev`）：

```powershell
Start-Process "chrome" -ArgumentList "--remote-debugging-port=9222","--user-data-dir=$env:TEMP\chrome_dev"
```

> **为什么固定 user-data-dir？**
> - 让 CDP 端口（9222）有唯一对应的 Chrome 实例，避免和用户日常 Chrome 冲突
> - 关闭调试 Chrome 时不会影响用户的书签/历史
> - `$env:TEMP\chrome_dev` 是临时目录，重启系统自动清理

启动后**先 sleep 3 秒**等待 Chrome 就绪，再执行 browser-harness：

```bash
sleep 3 && browser-harness -c 'new_tab("https://example.com"); print(page_info())'
```

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

| 错误操作                              | 实际后果                                                                                                      | 正确做法                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 问用户"Chrome 打开了吗"               | 打断用户、降低效率                                                                                            | 直接执行 browser-harness，`ensure_daemon()` 会自动处理                    |
| 内联复杂 JS 到 browser-harness `-c` | 引号转义失败，SyntaxError                                                                                     | 写 `.py` 文件再 `exec(open('file').read())`，或改用 CDP evaluate_script |
| 直接拼接 `href` 和 origin           | Bilibili 的 `href` 可能已带 `//www.bilibili.com`，导致 `https://www.bilibili.com//www.bilibili.com/...` | 用正则提取 path：`href.match(/\/video\/BV[a-zA-Z0-9]+/)`，再拼接          |
| SPA 分页点击后立即提取                | 拿到的是旧页面数据                                                                                            | 点击后 `sleep(2)` 或等待特定元素变化                                      |
| 假设页面一次性渲染全部内容            | 懒加载导致漏数据                                                                                              | 先 `scroll_down(800)` 多次再提取                                          |
| 用 `goto_url` 替代 `new_tab`      | 覆盖用户当前正在使用的标签页                                                                                  | 首导航用 `new_tab(url)`                                                   |

## B站视频课程组提取与导入

### 完整工作流

**Step 1：提取 BV 号链接**

从 B站合集页 / UP主空间 / 收藏夹页面提取所有视频链接：

```python
from agent_helpers import *

goto_url("https://space.bilibili.com/xxxx/channel/collectiondetail?sid=xxxx")
wait_for_load()
sleep(2)

# 先滚动加载全部内容
for i in range(10):
    scroll_down(800)
    sleep(1)

# 提取 BV 号链接
links = js("""
  const set = new Set();
  document.querySelectorAll('a[href*="/video/BV"]').forEach(a => {
    const href = a.getAttribute('href');
    const m = href.match(/\\/video\\/(BV[a-zA-Z0-9]+)/);
    if (m) set.add('https://www.bilibili.com/video/' + m[1]);
  });
  return Array.from(set);
""")
print(links)
```

**Step 2：保存为 txt**

```python
with open('course_videos.txt', 'w', encoding='utf-8') as f:
    for url in links:
        f.write(url + '\\n')
```

**Step 3：输出规范 txt 文件**

Agent 只需输出规范的 `course_videos.txt`，每行一个视频链接，用户自行在 TabBoard 中导入：

```
https://www.bilibili.com/video/BV1PS4y1A7za
https://www.bilibili.com/video/BV1hF411M7b5
https://www.bilibili.com/video/BV1J44y1o7gf
...
```

用户拿到 txt 后，在 TabBoard 视频进度页点击「批量导入」→ 选择课程组 → 上传文件即可。TabBoard 会自动打开每个链接检测视频元数据（标题、时长）并添加到课程组。

### B站提取注意事项

| 页面类型                | 提取方式                           | 注意                                                                   |
| ----------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| **合集页**        | `a[href*="/video/BV"]`           | 可能混有推荐视频，需按 DOM 结构过滤（如只取 `.video-list` 内的链接） |
| **收藏夹**        | 同上                               | 收藏夹可能跨页，需翻页提取                                             |
| **UP主空间-投稿** | 同上                               | 投稿视频可能非常多，按时间范围筛选后再提取                             |
| **单个视频页**    | `a[href*="/video/BV"]`（推荐区） | 不推荐，推荐区混有大量无关视频                                         |

### 过滤无关链接

合集页底部或侧边栏常有「推荐视频」，需过滤：

```javascript
// 只取合集列表容器内的链接（选择器因页面结构而异）
const container = document.querySelector('.video-list, .collection-list, #video-list');
const anchors = container ? container.querySelectorAll('a[href*="/video/BV"]') : document.querySelectorAll('a[href*="/video/BV"]');
```

### href 拼接陷阱

B站 `href` 可能已带 `//www.bilibili.com`，直接拼接会出双域名：

```javascript
// 错误
const url = 'https://www.bilibili.com' + href;  // href="//www.bilibili.com/video/BV1xx" → 双域名

// 正确
const m = href.match(/\\/video\\/(BV[a-zA-Z0-9]+)/);
const url = m ? 'https://www.bilibili.com/video/' + m[1] : null;
```

## 坑点速查

1. **daemon 自动启动** — 不要手动 `ensure_daemon()`，run.py 已内置
2. **首导航用 new_tab** — `goto_url` 会覆盖用户当前标签页
3. **evaluate_script 无转义问题** — 当 browser-harness 字符串反复失败时，切换到 CDP
4. **sleep 是必要等待** — SPA 页面、XHR 请求、懒加载都需要显式 sleep，不要依赖 `wait_for_load()` alone
5. **去重用 Set** — 同一页面可能存在多个指向同一视频的 `<a>` 标签（标题 + 缩略图）
6. **B站推荐区污染** — 合集页底部的推荐视频会混入提取结果，必须用容器范围过滤
7. **合集页滚动加载** — B站合集页通常懒加载，需多次 `scroll_down(800)` 才能加载全部视频
