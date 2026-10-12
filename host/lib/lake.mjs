// JSONL 数据湖读写。append-only,无 compaction(单条 ~200B,10 年 ~5MB/文件)。
//
// 路径解析优先级:
//   1. TABBOARD_LAKE_DIR 环境变量(测试用)
//   2. ~/.tabboard/lake(默认)
//
// 写语义:按 kind 分桶,每桶一次性 appendFile(单 syscall,跨进程原子追加)。
// 读语义:逐行 JSON.parse,允许流式追加期间读到新行。
import { appendFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { createInterface } from 'node:readline';

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || '.';
}

export const TABBOARD_DIR =
  process.env.TABBOARD_DIR ?? join(homeDir(), '.tabboard');

export const LAKE_DIR =
  process.env.TABBOARD_LAKE_DIR ?? join(TABBOARD_DIR, 'lake');

export const SKILLS_DIR =
  process.env.TABBOARD_SKILLS_DIR ?? join(TABBOARD_DIR, 'skills');

export const STATE_DIR =
  process.env.TABBOARD_STATE_DIR ?? join(TABBOARD_DIR, 'state');

function pathForKind(kind) {
  // kind 必须是简单标识符,防止路径穿越
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(kind)) {
    throw new Error(`非法 kind: '${kind}'(只允许字母/数字/下划线)`);
  }
  return join(LAKE_DIR, `${kind}.jsonl`);
}

// ---- 写 ----

// records: [{ kind, data }, ...]
// 返回写入条数
export async function appendRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return 0;
  await mkdir(LAKE_DIR, { recursive: true });

  // 按 kind 分桶
  const buckets = new Map();
  const now = Date.now();
  for (const r of records) {
    if (!r || typeof r.kind !== 'string' || r.data === undefined) {
      throw new Error('每条 record 必须有 kind:string 和 data:非 undefined');
    }
    if (!buckets.has(r.kind)) buckets.set(r.kind, []);
    const line = JSON.stringify({ ...r.data, _ts: now });
    buckets.get(r.kind).push(line);
  }

  let wrote = 0;
  for (const [kind, lines] of buckets) {
    const path = pathForKind(kind);
    // 一次 syscall 写完一个 kind 的所有行(批追加,跨进程原子)
    await appendFile(path, lines.join('\n') + '\n', 'utf8');
    wrote += lines.length;
  }
  return wrote;
}

// ---- 读 ----

// readJsonl(kind, { limit, sinceMs, filter })
//   kind: 字符串
//   limit: 最多返回条数
//   sinceMs: 只返回 _ts >= sinceMs 的
//   filter: (obj) => bool,返回 false 跳过
export async function readJsonl(kind, { limit, sinceMs, filter } = {}) {
  const path = pathForKind(kind);
  if (!existsSync(path)) return [];

  const out = [];
  const rl = createInterface({
    input: createReadStream(path, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); }
    catch { continue; } // 跳过坏行
    if (sinceMs !== undefined && (obj._ts ?? 0) < sinceMs) continue;
    if (filter && !filter(obj)) continue;
    out.push(obj);
    if (limit && out.length >= limit) break;
  }
  return out;
}

// 列出所有 kind(扫 .jsonl 文件)
export async function listKinds() {
  try {
    const entries = await readdir(LAKE_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
      .map(e => basename(e.name, extname(e.name)))
      .sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// 单条记录查找
export async function findRecord(kind, id) {
  const records = await readJsonl(kind);
  return records.find(r => r.id === id) ?? null;
}

// 统计每个 kind 的条数
export async function kindStats() {
  const kinds = await listKinds();
  const out = {};
  for (const k of kinds) {
    const path = pathForKind(k);
    try {
      const s = await stat(path);
      out[k] = { bytes: s.size, mtime: s.mtimeMs };
    } catch {
      out[k] = { bytes: 0 };
    }
  }
  return out;
}
