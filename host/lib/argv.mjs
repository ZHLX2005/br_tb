// 极简 argv 解析:只支持 --key value / --key=value / --flag / 位置参数。
// 复杂场景后续按需扩(目前够用)。
//
// 用法:
//   parseArgs(['--kind', 'tabs', '--limit', '50', 'g1'])
//   → { kind: 'tabs', limit: '50', positionals: ['g1'] }
//
// 数字自动转换('--limit 50' → { limit: 50 })。
// 列表用 --key a,b,c 自动转数组。

export function parseArgs(argv) {
  const out = { positionals: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out.positionals.push(a);
      continue;
    }
    const body = a.slice(2);
    const eq = body.indexOf('=');
    let key, val;
    if (eq >= 0) {
      key = body.slice(0, eq);
      val = body.slice(eq + 1);
    } else {
      key = body;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        val = next;
        i++;
      } else {
        val = true;
      }
    }
    out[key] = coerce(val, key);
  }
  return out;
}

function coerce(val, key) {
  if (val === true) return true;
  // --file / --kind 这类保持字符串
  // --limit / --days 数字
  if (/^(limit|days|hours|port|depth|top)$/.test(key)) {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  // --urls a,b,c → 数组
  if (key === 'urls' || key === 'ids') {
    return String(val).split(',').map(s => s.trim()).filter(Boolean);
  }
  return String(val);
}
