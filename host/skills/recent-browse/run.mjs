// recent-browse skill:读 tabs.jsonl 按 ts 倒序。
// ctx 通过 TABBOARD_SKILL_CTX 环境变量注入(JSON 字符串)。
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

const ctx = JSON.parse(process.env.TABBOARD_SKILL_CTX ?? '{}');
const args = ctx.args ?? [];
const days = Number(args[args.indexOf('--days') + 1] ?? 7);
const limit = Number(args[args.indexOf('--limit') + 1] ?? 20);

const lakeDir = ctx.lakeDir;
const tabsPath = join(lakeDir, 'tabs.jsonl');

const since = Date.now() - days * 86400_000;
const recent = [];

try {
  const rl = createInterface({ input: createReadStream(tabsPath, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if ((obj._ts ?? 0) < since) continue;
    recent.push(obj);
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

recent.sort((a, b) => (b._ts ?? 0) - (a._ts ?? 0));
const top = recent.slice(0, limit);

console.log(JSON.stringify({
  scope: `最近 ${days} 天`,
  total: recent.length,
  returned: top.length,
  tabs: top.map(t => ({
    id: t.id,
    groupId: t.groupId,
    title: t.title,
    url: t.url,
    ts: t._ts,
  })),
}, null, 2));
