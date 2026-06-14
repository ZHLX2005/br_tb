---
name: bili-recommend-agent
description: 当用户要求"B站智能推荐+自动评论分享到动态"、"agent 帮我刷B站发评论"、"AI筛选视频自动同步动态"、"用浏览器自动化在B站发布评论并推荐"时触发。基于 browser-harness + CDP 真实键入 + agent 智能选视频方案。**整体思路：agent 用 LLM 能力做视频语义筛选 → 自动发布真人感评论 + 同步到动态 → 关 tab**，核心是「agent 推荐+评论同步」组合而非单纯发布。
---

# bili-recommend-agent：B 站智能推荐 + 评论同步到动态

## 触发场景

- "用 AI 帮我刷 B 站并自动评论"
- "自动发布评论到 B 站视频 + 同步动态"
- "AI 筛选视频并自动评论"
- "agent 模式发布 B 站评论"
- "智能推荐 + 真人感评论"
- "刷 bot 的动态" / "做我的 bot 替我看视频"

## 前置条件

1. Chrome 已用 `--remote-debugging-port=9222` 启动（user-data-dir 固定，**保留 B 站登录态**）
2. 用户已登录 B 站
3. browser-harness daemon 可连接
4. 工作目录：`C:\Users\MINISFORUM\browser-harness\agent-workspace\`
5. **首次启动必须先 `/browser-harness-auto-launch` 走 Step 0** — 见下方"使用方法 → Step 0"

### Chrome 启动方式（Windows 11, 已验证 2026-06-14）

```powershell
# 绝对路径启动（chrome.exe 不一定在 PATH；Start-Process "chrome" 在某些机器会静默失败）
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222","--user-data-dir=C:\Users\MINISF~1\AppData\Local\Temp\chrome_dev"
sleep 5
curl -s -m 3 http://localhost:9222/json/version   # 确认已 LISTENING
```

> 旧写法 `Start-Process "chrome" -ArgumentList ...` 依赖 PATH 解析，本机（`D:\code\a_js\proj\js\test_feature`）实测失败 → 进程能起但 chrome.exe 找不到。**改用绝对路径**。

### DevToolsActivePort 探测失败的旁路

daemon 默认在 `$env:TEMP\chrome_dev\DevToolsActivePort` 找端口文件。新建 user-data-dir 第一次启动时**该文件可能没及时回写**（尽管 9222 已 LISTENING），导致 `RuntimeError: DevToolsActivePort not found`。

**旁路**：手动从 `/json/version` 拿 `webSocketDebuggerUrl`，再设环境变量：

```bash
WS=$(curl -s http://localhost:9222/json/version | python -c "import sys,json; print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
BU_CDP_WS="$WS" browser-harness -c "print(page_info())"
```

> 此旁路**不**需要 daemon 探测文件，直接用 WebSocket URL。后续所有 `browser-harness -c` 命令前都需带 `BU_CDP_WS=...`。

---

## 🎯 完整工作流（5 步）

```
T0  trigger (cron / 用户)
  │
  ▼
T1  05_scan_candidates.py  ─── 扫候选（单关键词 + 下拉 + 打印）
  │     ↓ stdout 输出 5min+ 视频清单
  ▼
T2  agent 智能决策          ─── 读标题 + bad_eg 过滤 + 选 1 个
  │     ↓ 写 pick.txt
  ▼
T3  06_publish_one.py     ─── 读 pick.txt → 打开 → 读评论 → 风格分析 → 生成 → 发布 → 关 tab
  │     ↓
  ▼
T4  验证 published_log    ─── 检查本次记录
  │
  ▼
T5  清理孤儿 tab          ─── 06 末尾已自动清理 page tabs
```

### T1 — 扫候选（05_scan_candidates.py）

**职责**：从 interest.md 拿第 1 个关键词 → 打开搜索结果 → 下拉触发懒加载 → 提取所有 5min+ 视频 → 写 candidates.json + stdout 打印

**执行规范**：
- 一次只扫**一个**关键词，不刷不多切
- 5min+ 时长约束（300s）+ 2h- 上限（7200s）
- 排除 `exclude_keywords` 黑名单
- 排除 `published_log.json` 里已发过的 BV（去重）
- 写 candidates.json 备用

**agent 等待信号**：stdout 打印的"=== 5min+ 过滤后 N 个 ==="行。

### T2 — agent 智能决策（这是 skill 的核心价值）

**职责**：用我（agent）自己的 LLM 语义判断，**不靠正则不靠 embedding**。

**执行规范**：
- 读 stdout 标题列表（或 Read candidates.json）
- 应用 `interest.md` 的 `bad_eg` 反例：
  - ❌ 卖课："X小时学会XX"、"保姆级全套"、"必学/必做/必看"
  - ❌ 培训机：黑马/尚硅谷/慕课/鱼皮
  - ❌ 资料包领引流
  - ❌ 标题党："学完薪资翻倍"
- 应用 `interest.md` 的 keywords **正向偏好**（如当前"程序历史/科普/休闲"）
- 排除已发过（published_log 查 BV）
- **必须有 1 个剩余候选才能继续**——否则结束本次 loop
- 选 1 个后写 pick.txt

**为什么 agent 决策是核心**：B 站冷启动账号主页推荐无意义；关键词正则/相似度/embedding 都不如 LLM 看到标题时的人类直觉。**我就是 LLM**。

**写 pick.txt 必做**：先 `Read`（确认存在 + 拿到旧内容做差异），再 `Write` 覆盖。`pick.txt` 已存在时直接 Write 会因 "File has not been read yet" 失败。

### 读取 candidates.json（Windows + Python 3 必读）

默认 `python` 指向 Python 2.7（Anaconda），中文 console 编码 GBK。直接 `python` 读 candidates.json 会双重翻车。

**用 WindowsApps 里的 Python 3.13 + 强制 UTF-8**：

```bash
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
  "C:\Users\MINISFORUM\AppData\Local\Microsoft\WindowsApps\python.exe" \
  -c "import json; d=json.load(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\candidates.json',encoding='utf-8')); print(len(d['candidates']))"
```

或者**写 .py 文件**（用 `# -*- coding: utf-8 -*-` 头 + `io.open(encoding='utf-8')`），上面 11 月版已验证。**不推荐**内联 f-string + 中文到 `python -c`（GBK 抛 `UnicodeEncodeError: illegal multibyte sequence`）。

### T3 — 发布（06_publish_one.py）

**职责**：读 pick.txt → 打开视频 → 读 3 条已有评论 → 风格分析 → 生成短句 → 真实键入 → 勾选同步动态 → 点击发布 → 验证 → 关闭所有 page tab

**执行规范**：
- **真实键入**：click_at_xy + Ctrl+A + Delete + type_text（**禁止 execCommand**）
- **B 站 web component**：递归 shadow root 拿真实元素
- **3 层 shadow root 路径**：`bili-comments → header-renderer → comment-box（也有自己的 shadow）→ #editor → rich-textarea → .brt-editor`
- **同步动态**：bili-checkbox 默认已勾选，未勾选时点击坐标
- **验证**：`foundOurs` 在**所有**评论里找（不用 `firstTxt`，B 站会插广告/置顶）
- **关 tab**：`Page.close` 关 video tab + `Target.closeTarget` 遍历关剩余 page tabs
- **写日志**：成功发布时追加到 `published_log.json`（含 `user_feedback: null` 字段）

### T4 — 验证

读 `published_log.json`，确认：
- 新条目存在
- BV 与 pick.txt 一致
- `comment` 字段非空
- `user_feedback` 留空（待用户后续填）

**完整验证脚本**（写 `agent-workspace/verify_last.py` 后执行）：

```python
# -*- coding: utf-8 -*-
import json, sys

WS = r"C:\Users\MINISFORUM\browser-harness\agent-workspace"
with open(f"{WS}/published_log.json", encoding="utf-8") as f:
    d = json.load(f)
with open(f"{WS}/pick.txt", encoding="utf-8") as f:
    pick = f.read().strip()

last = d["published"][-1]
checks = {
    "新条目存在": last.get("bv") is not None,
    "BV 一致":    last.get("bv") == pick,
    "评论非空":   bool(last.get("comment")),
    "同步动态":   last.get("synced_to_dynamic") is True,
    "feedback 留空": last.get("user_feedback") is None,
}
for k, v in checks.items():
    print(f"  {'✅' if v else '❌'} {k}")
print(f"\n总计发布: {len(d['published'])} 条")
print(f"最新 BV: {last['bv']}")
print(f"最新评论: {last['comment']}")
print(f"发布时间: {last['published_at']}")
sys.exit(0 if all(checks.values()) else 1)
```

执行：

```bash
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
  "C:\Users\MINISFORUM\AppData\Local\Microsoft\WindowsApps\python.exe" \
  "C:\Users\MINISFORUM\browser-harness\agent-workspace\verify_last.py"
```

### T5 — 清理

06 末尾已自动调用：
- `Page.close` 关当前 video tab
- 遍历剩余 page tab 用 `Target.closeTarget` 关
- 兜底再 `Page.close` 一次

**agent 不要再手动关 tab**（除非 06 失败需要兜底）。

---

## 核心文件索引

`C:\Users\MINISFORUM\browser-harness\agent-workspace\`

| 文件 | 用途 | 何时用 |
|------|------|--------|
| `interest.md` | 兴趣配置（关键词、短句库、bad_eg、时长阈值） | 切换内容域时改 |
| `05_scan_candidates.py` | 扫描器 | T1 步骤 |
| `06_publish_one.py` | 执行器 | T3 步骤 |
| `pick.txt` | agent 写的目标 BV | T2 步骤产出 |
| `candidates.json` | 05 输出的候选清单 | T2 步骤读取 |
| `published_log.json` | 已发布历史（去重+评价） | T4 步骤验证 |

**绝对不要** 在 skill 目录内复制脚本副本（开发阶段单一来源）。

---

## 核心原理

### 3 层 shadow root 路径（重要！每次发布都要走）

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

### 评论内容读取（递归 shadow 穿透）

```javascript
let node = rich;
while (node && node.shadowRoot) {
  const inner = node.shadowRoot.querySelector('p, span, div');
  if (!inner) break;
  node = inner;
}
const txt = (node ? node.textContent : rich.textContent).trim();
```

### parse_duration 启发式

```python
# 3 段 (h:mm:ss) 算后 > 4h → 视作 mm:ss:frame，丢弃第三段
# B 站搜索结果时长显示有 bug：18:03:13 实际是 18min
if len(nums) == 3 and (nums[0]*3600 + nums[1]*60 + nums[2]) > 14400:
    nums = nums[:2]
```

### 关键设计决策

| 决策 | 错误方案 | 正确方案 |
|------|---------|---------|
| **输入文本** | `execCommand('insertText')` | `click_at_xy` + `Ctrl+A` + `Delete` + `type_text` |
| **触发评论** | 直接 `scrollIntoView` | `scrollIntoView` + 等待 3s + `scrollBy(0, -200)` |
| **提取视频** | `[class*=title]`（被"不感兴趣"污染） | `a.bili-video-card__image--link` + 兄弟 `h3.bili-video-card__info--tit` |
| **时长筛选** | 靠标题判断 | DOM 读 `[class*=duration]` → `parse_duration` |
| **3 段时长解析** | 直接当 h:mm:ss | 启发式：>4h 视作 mm:ss:frame 丢弃第三段 |
| **读评论内容** | `textContent`（拿到 shadow CSS） | 递归穿透 `bili-rich-text` 的 shadow |
| **关闭 tab** | `Target.closeTarget` | `Page.close`（更可靠） |
| **视频选择** | 正则关键词 / 相似度 embedding | **agent 读标题自己判断**（LLM-as-selector） |
| **验证发布成功** | `firstTxt==our_comment` | **`foundOurs` 在所有评论里找**（B 站会插广告） |
| **去重** | 不去重 | `published_log.json` 加载已发 BV，扫描时跳过 |
| **清理 tab** | 只关 video tab | video + 遍历关所有 page tab（搜索 tab 残留） |

---

## 使用方法

### Step 0 — auto-launch（首次必做）

**先调 `/browser-harness-auto-launch` skill**，让 ensure_daemon 自动处理 Chrome 启动 + daemon 连接。

如果 `DevToolsActivePort not found` 报错（参见前置条件 → 旁路方案），手动走：

```powershell
# 1. 绝对路径启 Chrome
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222","--user-data-dir=C:\Users\MINISF~1\AppData\Local\Temp\chrome_dev"
# 2. 等就绪
sleep 5
# 3. 拿 WebSocket URL
$ws = (Invoke-RestMethod http://localhost:9222/json/version).webSocketDebuggerUrl
$env:BU_CDP_WS = $ws
# 4. 验证
browser-harness -c "print(page_info())"
```

> **后续所有 `browser-harness -c` 命令都需要带 `BU_CDP_WS=$ws` 前缀**（同一 PowerShell 会话内 `$env:` 会保留）。

### 完整工作流（agent 驱动）

```bash
# T1: 扫描候选
cd C:\Users\MINISFORUM\browser-harness\agent-workspace
browser-harness -c "exec(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\05_scan_candidates.py', encoding='utf-8').read())"
# → 打印 29 个 5min+ 视频标题

# T2: agent 自己读 stdout，评估匹配 interest.md，写 pick.txt
# (agent 智能决策，详见 T2 步骤)
echo "BV1xxx" > C:\Users\MINISFORUM\browser-harness\agent-workspace\pick.txt

# T3: 发布
browser-harness -c "exec(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\06_publish_one.py', encoding='utf-8').read())"
# → 发布成功 + 关闭所有 tab + 写 published_log.json
```

### interest.md 切换内容域

改 `keywords` + `phrases` + `bad_eg` 三处：

```yaml
# 程序历史/科普（当前默认）
keywords: [程序历史, 计算机历史, Linux 历史, 硅谷传奇, 技术趣闻]
phrases: [学到了, 涨知识, 故事真有意思, 老故事真好听]

# 考研
keywords: [考研数学, 考研英语, 考研政治]
phrases: [已收藏, 学到了, 今年必上岸]

# 美食
keywords: [探店, 深夜食堂, 美食测评]
phrases: [看着好香, 这家我去过, 种草了]

# 健身
keywords: [健身教程, 增肌, 减脂]
phrases: [跟着练了, 动作好标准, 今天打卡]
```

### 06 命令行参数

06 不支持 argv（被 browser-harness 的 `-c` 占用），从以下位置读 BV（按优先级）：
1. `pick.txt`（最常用，agent T2 步骤产出）
2. `TARGET_BV` 环境变量
3. `TARGET_BV.txt` 文件

### bad_eg 反例（agent 选视频时跳过）

完整列表在 `interest.md`，**核心原则**：

- ❌ "X小时学会XX"、"X天精通XX"、"保姆级完整教程" — 太浅 + 套路化卖课
- ❌ 黑马/尚硅谷/慕课/鱼皮等培训机结构化课程 — 培训课
- ❌ 标题含 "必学/必做/必看"、"学完薪资翻倍/拿下 offer" — 标题党 + 卖课焦虑
- ❌ 资料包领取引流贴（"点赞+评论+关注"）
- ❌ 标题含 "AI 编程/Claude Code 教程"（当前偏好是程序历史/科普，不是 AI 工具教程）

- ✅ 短时长（<30min）+ 个人讲解 = 真分享
- ✅ 短时长（<15min）+ 一句话犀利观点 = 优质
- ✅ 专题讲解（"从 LLM 到 Agent Skill"、"从夯到拉锐评"）
- ✅ 历史/科普/故事类（"Linux 故事"、"硅谷传奇"、"技术趣闻"）

---

## 已验证场景

✅ **自媒体向视频 + 智能选 + 评论**（`BV1xHn9z8EPX` Python 入门半小时）— 「确实，牛皮！」+ 同步动态 + 关 tab
✅ **8min 犀利观点视频 + 智能选**（`BV1ZkVg6hEeG` AI 会写代码之后世界变了）— 「嗯，受教了」+ 同步动态 + **清理全部 page tab**
✅ **12min 个人观点视频 + 智能选**（`BV1TMVp6VEoL` 未来五年思考模式）— 「确实，Mark 一下」+ 同步动态 + tab 清理
✅ **5min Fireship 犀利观点 + cron 触发**（`BV1CM5m6VEjb` 程序员炫技）— 「嗯，代码角度看挺优雅的~」+ 同步动态 + 累计 44 条（2026-06-14 17:53）

---

## 错误案例（高频坑点）

### 环境坑（agent 启动 / 跨平台）

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `Start-Process "chrome" -ArgumentList ...` | 本机 chrome.exe 不在 PATH 时**静默失败**（0 进程起来）| 用绝对路径 `"C:\Program Files\Google\Chrome\Application\chrome.exe"` |
| 启动后直接 `browser-harness -c` | daemon 在 `$env:TEMP\chrome_dev\DevToolsActivePort` 找不到文件，报 `RuntimeError: DevToolsActivePort not found` | 旁路：手动从 `/json/version` 拿 `webSocketDebuggerUrl`，设 `BU_CDP_WS=<url>` |
| `devtoolsActivePort` 文件不存在但 9222 已 LISTENING | daemon 死板读文件 | 改用 `BU_CDP_WS` 环境变量绕过（`curl /json/version` 拿 WS URL） |
| `python -c "print('中文')"` | Python 2.7 + GBK → SyntaxError 或乱码 | 用 `"C:\Users\MINISFORUM\AppData\Local\Microsoft\WindowsApps\python.exe"`（3.13）+ `PYTHONIOENCODING=utf-8 PYTHONUTF8=1` |
| `python` 解析路径用了 `2.7` | `print(f"...")` 缺括号 + 后续 `print` 输出错位 | 同上，强制 Python 3 |
| 写 `.py` 文件**没** `# -*- coding: utf-8 -*-` | 解释器按 GBK 解，docstring 中文 SyntaxError | 加编码声明或用 `io.open(encoding='utf-8')` |
| Write 已有文件前没 Read | "File has not been read yet" 错误 | 先 `Read` 再 `Write`（pick.txt / verify 脚本等都这样） |
| cron 触发后没收到 `Skill` 工具调用结果 | agent 会话被 /loop 重新调度 | 接受就好，下次 loop 自然重试 |

### B 站技术坑

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `execCommand('insertText')` 注入 | 触发 b 站"天青色等烟雨" placeholder 错位 | 用 `type_text` 走真实键盘事件 |
| `ed.innerHTML = ''` 清空 | 触发 b 站 web component state 异常 | `Ctrl+A` + `Delete` |
| 一次性 `scrollIntoView` 后立即操作 | shadow root 还没挂载 | 等待 3-4 秒让 web component 渲染 |
| `.title` 选视频 | 命中"不感兴趣"按钮 | 用 `a.bili-video-card__image--link` 锚点 |
| `[class*=title]` 选视频 | 命中 `.no-interest-title` | 用 `h3.bili-video-card__info--tit` |
| `textContent` 读评论 | 返回 shadow 里的 CSS 文本 | 递归穿透 `bili-rich-text` 的 shadow |
| 3 段时长 `59:35:01` 直接当 h:mm:ss | 误识别为 59h | 启发式：算后 >4h 当 mm:ss:frame |
| `firstTxt==our_comment` 验证 | B 站广告/置顶会让我们不是第 1 条 | `foundOurs` 在所有评论里找 |
| `Target.closeTarget` 关 tab | root session 参数错 | `Page.close` |
| 动画区番剧视频 | 评论机制不同 | 选自媒体 UP 视频 |
| 未登录就评论 | 失败 | 启动 Chrome 时 user-data-dir 保留登录态 |
| 06 末尾只关 video tab | 搜索/旧首页 tab 残留 | 遍历关所有 page tab |

### Python / 脚本坑

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 06 读 `sys.argv[1]` | 拿到的是 `-c` 参数 | 改读 `pick.txt` / `TARGET_BV` 环境变量 |
| 多刷新/多切换关键词 | 新账号 + 关键词正则匹配永远不准 | **agent 读标题自己选** |
| `f-string {v['k']}` 复杂表达式 | Python < 3.12 报错 | 提前算变量再 f-string |
| `os.path.dirname(__file__)` 在 exec 下 | 路径错位 | 用 hardcoded 绝对路径 |
| 内联多行 JS 到 browser-harness `-c` | 引号转义失败 | 写 `.py` 文件再 exec，或用 CDP evaluate_script |
| `cd` 在 browser-harness 内 | Shell cwd 被重置回主项目 | 用绝对路径 |
| 脚本里 exec 模式下 `if __name__ == "__main__"` | 不会触发 main() | 加 `else: main()` 分支 |
| docstring 含 `\U` 转义 | SyntaxError | 用 raw string `r"""..."""` |

### 产品/链路坑

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 用正则/embedding 替代 agent 选视频 | 冷启动账号永远不准 | **agent 是 LLM，让它自己读标题** |
| 多刷新/多关键词重试 | 主页推荐不会变好，浪费 token | 1 次就够，没合适就放弃 |
| 发布后不关 tab | 内存累积，OOM | 06 末尾自动遍历关 page tab |
| 重复推同一个视频 | 刷屏感 | published_log.json 去重 |
| 写文档不更新脚本路径 | 维护不一致 | 文档列"在哪、不在那" |
| 复制脚本到 skill/scripts | 双份维护漂移 | 单一来源：浏览器 workspace |

---

## 风控提示

- 单条评论"有意思"、"确实，牛皮"是低敏感度文案
- 批量发布需控制频率（建议间隔 30s+）
- AI 自动同步到动态可能被 B 站风控识别，账号风险自负
- cron 每小时触发但实际 LLM 跑一个完整流程（含智能筛选），非 24 个全发
- **cron 频率建议**：本机 /loop 1h 是上限，再密会被 B 站识别为机器行为。凌晨 2-6 点建议停掉（设为 recurring false 一次性到 2:00 触发一次后即停）
- 不要在短时间内大量操作
- `user_feedback` 字段机制：T4 留空待用户填；未来用 `published_log.json` 反向调整 interest.md 的 bad_eg 列表

---

## 相关 Skills

- **`browser-harness-auto-launch`** — 必先调，浏览器自动启动 + daemon 接管（**Step 0**）
- `injected-dom-toggle-pattern` — 注入式悬浮 UI 模式（不同场景）
- `dot-nav-sidebar` — 悬浮侧边栏交互模式
- `injected-progress-bar-design` — 视频进度条注入

---

## 未来扩展（不在本次范围）

- 自动读取 `published_log.json` 的 `user_feedback` 字段调整推荐
- LLM 真实风格生成（替换本地短句库）
- 多视频批量发布 + 时间间隔
- 用 Ollama 本地 LLM 跑语义筛选（绕开 agent 会话依赖）
