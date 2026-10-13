// 版本号:优先读 package.json(源码运行);编译成单 exe 后读不到,回退到硬编码。
// ⚠️ 改版本号时两处都要动:package.json + 这里 FALLBACK_VERSION。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FALLBACK_VERSION = '0.0.1';

function readVersion() {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  } catch {
    return FALLBACK_VERSION;   // bun build --compile 的单 exe:package.json 已不在磁盘上
  }
}

export const VERSION = readVersion();
