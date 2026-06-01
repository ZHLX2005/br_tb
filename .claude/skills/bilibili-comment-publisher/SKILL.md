---
name: bilibili-comment-publisher
description: 当用户要求"在B站视频下发布评论"、"自动评论并同步到动态"、"用浏览器自动化给B站视频评论"、"agent 帮我在B站写评论"时触发。基于 browser-harness + CDP 真实键入方案，已通过完整链路验证。专治 b 站 web component 嵌套 shadow root + placeholder 错位等坑。
---

# B 站视频评论 + 同步动态自动化

## 触发场景

- "用 AI 帮我刷 B 站并自动评论"
- "自动发布评论到 B 站视频 + 同步动态"
- "AI 筛选视频并自动评论"
- "agent 模式发布 B 站评论"

## 前置条件

1. Chrome 已用 `--remote-debugging-port=9222` 启动，user-data-dir 固定
2. 用户已登录 B 站（在 profile 里有 cookie）
3. browser-harness daemon 可连接

## 链路架构

```
01_extract_home_videos.py
   ↓ 提取首页推荐视频
02_get_editor_position.py
   ↓ 探测 editor 屏幕坐标
03_publish_comment.py
   ↓ 真实键入 + 勾选 + 发布 + 验证
```

## 核心原理

### 路径：3 层 shadow root

```
bili-comments
  └─ shadowRoot
      └─ bili-comments-header-renderer
          └─ shadowRoot
              └─ bili-comment-box
                  └─ shadowRoot ← box 也有自己的 shadow！
                      ├─ #editor → bili-comment-rich-textarea
                      │   └─ shadowRoot → .brt-editor (contenteditable)
                      ├─ bili-checkbox (含 input[type=checkbox] 控制同步动态)
                      └─ #pub > button (发布)
```

### 关键设计决策

| 决策 | 错误方案 | 正确方案 |
|------|---------|---------|
| **输入文本** | `document.execCommand('insertText')` | `click_at_xy` + `press_key("Ctrl+A")` + `press_key("Delete")` + `type_text` |
| **触发评论** | 直接 `scrollIntoView` | `scrollIntoView` + 等待 3s + `scrollBy(0, -200)` 微调 |
| **提取视频** | `[class*=title]`（被"不感兴趣"污染） | `a.bili-video-card__image--link` + 兄弟 `h3.bili-video-card__info--tit` |
| **时长筛选** | 靠标题判断 | DOM 读 `[class*=duration]` → `parse_duration` 转秒 |
| **读评论内容** | 直接 `textContent`（拿到 shadow 里的 CSS） | 递归穿透 `bili-rich-text` 的 shadow root |
| **关闭 tab** | `Target.closeTarget`（root session 参数错） | `Page.close` |

## 使用方法

**脚本放在 browser-harness 标准目录**（开发阶段，不在 skill 内重复维护）：
`C:\Users\MINISFORUM\browser-harness\agent-workspace\`

### 单视频发布

```bash
cd C:\Users\MINISFORUM\browser-harness\agent-workspace
browser-harness -c "exec(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\03_publish_comment.py', encoding='utf-8').read())"
```

修改 `03_publish_comment.py` 顶部 `COMMENT_TEXT` 即可换文案。

### 程序员向关键词搜索 + 评论 + 关 tab

```bash
cd C:\Users\MINISFORUM\browser-harness\agent-workspace
browser-harness -c "exec(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\05_search_and_publish.py', encoding='utf-8').read())"
```

05 搜索关键词组（可在脚本顶部 `KEYWORDS` 修改）：
- `AI 编程`、`Claude Code 教程`、`操作系统`、`Python 教程`、`Agent 开发`

参数（在 `04` 顶部）：
- `MIN_DURATION_SEC = 300` — 时长阈值（5 分钟）
- `TARGET_VIDEO_COUNT = 1` — 单次跑几个
- `TOP_N_COMMENTS = 5` — 读前几条评论分析风格
- `SYNC_TO_DYNAMIC = True` — 是否同步动态

输出示例：
```
[1] 提取首页 5min+ 视频...
    候选 15 个：
    1. BV1xxx 标题 11:50
[2] 选定: BV1xxx 标题 (50:11)
[3] 打开视频...
[4] 滚到评论区...
    读前 5 条评论...
[5] 分析风格 + 生成评论...
    风格: {'avg_len': 18, 'punct': '', 'common_suffix': '了'}
    生成: 「哈哈，已 star666」
[6] 发布评论...
    验证: {'editorEmpty': True, 'firstTxt': '哈哈，已 star666'}
    ✅ 发布成功
[7] 关闭视频 tab...
    ✅ tab 已关
```

### 链路编排

```python
# 在主流程里：
from extract_home_videos import extract_videos
from publish_comment import publish

videos = extract_videos()  # 返回 [{bv, title}, ...]
for v in videos[:5]:
    goto_url(f"https://www.bilibili.com/video/{v['bv']}/")
    wait_for_load()
    publish(COMMENT_TEXT, sync_to_dynamic=True)
```

## 已验证场景

✅ 自媒体向视频（`BV1Cc5e66E4g` 疯狂的石头影视解说）— 两次连续发布不同文案

## 错误案例（高频坑点）

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `execCommand('insertText')` 注入 | 触发 b 站"天青色等烟雨" placeholder 错位 | 用 `type_text` 走真实键盘事件 |
| `ed.innerHTML = ''` 清空 | 触发 b 站 web component state 异常 | `Ctrl+A` + `Delete` |
| 一次性 `scrollIntoView` 后立即操作 | shadow root 还没挂载 | 等待 3-4 秒让 web component 渲染 |
| `.title` 选视频 | 命中"不感兴趣"按钮 | 用 `a.bili-video-card__image--link` 锚点 |
| `textContent` 读评论 | 返回 shadow 里的 CSS 文本 | 递归穿透 `bili-rich-text` 的 shadow |
| 动画区番剧视频 | 评论机制不同 | 选自媒体 UP 视频（用户亲身验证） |
| 未登录就评论 | 失败 | 启动 Chrome 时 user-data-dir 保留登录态 |

## 风控提示

- 单条评论"有意思"、"来看看这个的评论"是低敏感度文案
- 批量发布需控制频率（建议间隔 30s+）
- AI 自动同步到动态可能被 B 站风控识别，账号风险自负
- 不要在短时间内大量操作

## 相关 Skills

- `browser-harness-auto-launch` — 浏览器自动启动
- `injected-dom-toggle-pattern` — 注入式悬浮 UI 模式（不同场景）
- `dot-nav-sidebar` — 悬浮侧边栏交互模式
