# bilibili-comment-publisher

B 站视频评论 + 同步动态自动化。

## 文件清单

| 文件 | 位置 | 用途 |
|------|------|------|
| `SKILL.md` | 本 skill 目录 | skill 主文档 |
| `03_publish_comment.py` | browser-harness 标准目录 | 端到端发布（固定文案） |
| `04_recommend_and_publish.py` | browser-harness 标准目录 | 产品化：5min+ 首页筛选+风格模仿+关 tab |
| `05_search_and_publish.py` | browser-harness 标准目录 | 程序员向关键词搜索+5min+ 筛选+关 tab |

**脚本路径**：`C:\Users\MINISFORUM\browser-harness\agent-workspace\`

> **开发阶段** — 脚本放在 browser-harness 标准目录（agent-workspace），不在 skill 内重复维护，避免双份同步。

## 快速使用

```bash
# 固定文案发布（03）
browser-harness -c "exec(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\03_publish_comment.py', encoding='utf-8').read())"

# 5min+ 首页筛选（04）
browser-harness -c "exec(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\04_recommend_and_publish.py', encoding='utf-8').read())"

# 程序员向关键词搜索（05）
browser-harness -c "exec(open(r'C:\Users\MINISFORUM\browser-harness\agent-workspace\05_search_and_publish.py', encoding='utf-8').read())"
```

## 验证记录

| 视频 BV | 入口 | 文案 | 结果 |
|---------|------|------|------|
| BV1Cc5e66E4g | 03 | 有意思 | ✅ |
| BV1Cc5e66E4g | 03 | 来看看这个的评论 | ✅ |
| BV1WZ5k6eEEG（皮蛋 59min） | 04 | 经典永不过时啊 | ✅ |
| BV1gHLV68E9r（MC 空岛 50min） | 04 | 哈哈，已 star666 | ✅ + 关 tab |
| BV1qd4y177eA（操作系统） | 05 | 学到了了 | ✅（修后） |
| BV1TgVs6SEcm（Python 数据分析） | 05 | 学到了~ | ✅ + 关 tab |
