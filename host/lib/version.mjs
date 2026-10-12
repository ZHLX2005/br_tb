// 版本号同步 package.json,单点真相。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
export const VERSION = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
