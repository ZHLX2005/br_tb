---
name: recent-browse
description: 列出最近浏览/收藏的标签页,按时间倒序。触发词:最近浏览、recent、recent tabs、刚看的。
---

# recent-browse

读 `tabs.jsonl`,按 `_ts` 倒序输出 top N 条。

## 用法

```bash
tabboard skill recent-browse --days 7 --limit 20
```

## 参数

- `--days N` — 只看最近 N 天(默认 7)
- `--limit N` — 最多返回 N 条(默认 20)
