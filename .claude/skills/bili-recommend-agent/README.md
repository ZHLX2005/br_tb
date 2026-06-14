# bili-recommend-agent

B 站智能推荐 + 评论同步到动态。**agent 智能选视频版**。

## 文件清单

**主文档**：
- `SKILL.md` — skill 描述、架构、关键决策、错误案例

**脚本路径**（开发阶段，统一在 browser-harness 标准目录）：
`C:\Users\MINISFORUM\browser-harness\agent-workspace\`

| 文件 | 用途 | 状态 |
|------|------|------|
| `05_scan_candidates.py` | 扫描器：单关键词搜索+下拉+打印候选 | ✅ |
| `06_publish_one.py` | 执行器：读 pick.txt → 发布 | ✅ |
| `03_publish_comment.py` | 固定文案发布（调试用） | ✅ |
| `04_recommend_and_publish.py` | 主页推荐筛选（已弃用） | ⚠️ 不推荐 |
| `05_search_and_publish.py` | 老版搜索+发布（已弃用） | ⚠️ 不推荐 |
| `interest.md` | 兴趣配置 | ✅ |
| `pick.txt` | agent 写的目标 BV | 06 读取 |
| `candidates.json` | 05 扫描输出 | agent 自己读 |
| `published_log.json` | 已发布历史（含 user_feedback） | 去重+评价 |

## 核心架构

```
[05_scan_candidates.py]
  单关键词 → 搜索页 → 下拉懒加载 → 打印 5min+ 候选标题
[agent 读标题，语义判断]
  自己评估匹配 interest.md 的程度 → 写 pick.txt
[06_publish_one.py]
  读 pick.txt → 打开视频 → 读评论 → 生成短句 → 发布 → 关 tab → 写日志
```

**核心洞察**：agent 自己是 LLM，比正则/embedding 更聪明。**让 agent 读标题自己选**，不做复杂的语义引擎。

## 快速使用

> **Step 0（首次必做）**：先调 `/browser-harness-auto-launch`，让 ensure_daemon 自动处理 Chrome + daemon。  
> 若 `DevToolsActivePort not found`，手动用绝对路径启 Chrome + 设 `BU_CDP_WS`（见 SKILL.md 旁路方案）。

```bash
# 1) 扫描
browser-harness -c "exec(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\05_scan_candidates.py', encoding='utf-8').read())"

# 2) agent 写 pick.txt（先 Read 再 Write）
echo "BV1xxx" > C:\Users\MINISFORUM\browser-harness\agent-workspace\pick.txt

# 3) 发布
browser-harness -c "exec(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\06_publish_one.py', encoding='utf-8').read())"

# 4) 验证（用 WindowsApps 里的 Python 3.13，强制 UTF-8）
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
  "C:\Users\MINISFORUM\AppData\Local\Microsoft\WindowsApps\python.exe" \
  "C:\Users\MINISFORUM\browser-harness\agent-workspace\verify_last.py"
```

## 验证记录

| 视频 BV | 入口 | 文案 | 结果 |
|---------|------|------|------|
| **BV1xHn9z8EPX** | 06 | **确实，牛皮！** | ✅ + 同步动态 + 关 tab + 写日志 |
| **BV1ZkVg6hEeG** | 06 | **嗯，受教了** | ✅ + 同步动态 + 清理全部 page tab |
| **BV1TMVp6VEoL** | 06 | **确实，Mark 一下** | ✅ + 同步动态 + tab 清理 |
| **BV1CM5m6VEjb** | 06（cron /loop 1h 触发） | **嗯，代码角度看挺优雅的~** | ✅ + 同步动态 + 累计 44 条（2026-06-14 17:53） |

## 切换内容域

改 `interest.md` 的 `keywords` 和 `phrases`，**脚本零修改**。
