// doctor:健康检查。一次性跑 6 项,看环境是否就绪。
//   1. Node 版本
//   2. 数据湖目录可写
//   3. host.manifest.json 存在且合法
//   4. Windows 注册表是否注册(Windows only)
//   5. 内置 skill 是否已复制
//   6. 上次 backup 时间
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Registry } from '../registry.mjs';
import { TABBOARD_DIR, LAKE_DIR, SKILLS_DIR, STATE_DIR } from '../lake.mjs';
import { VERSION } from '../version.mjs';
import { runPowerShell } from '../registry-windows.mjs';

async function checkNode() {
  return {
    name: 'node-version',
    ok: true,
    detail: { version: process.version, execPath: process.execPath },
  };
}

async function checkLakeWritable() {
  try {
    await writeFile(join(LAKE_DIR, '.doctor-write-test'), 'ok', 'utf8');
    return { name: 'lake-writable', ok: true, path: LAKE_DIR };
  } catch (e) {
    return { name: 'lake-writable', ok: false, path: LAKE_DIR, error: e.message };
  }
}

async function checkManifest() {
  const path = join(TABBOARD_DIR, 'host.manifest.json');
  if (!existsSync(path)) {
    return { name: 'manifest-exists', ok: false, path, error: 'host.manifest.json 不存在,运行 tabboard init' };
  }
  try {
    const m = JSON.parse(await readFile(path, 'utf8'));
    const checks = {
      hasName: typeof m.name === 'string',
      hasPath: typeof m.path === 'string',
      hasArgs: Array.isArray(m.arguments),
      typeIsStdio: m.type === 'stdio',
      hasOrigins: Array.isArray(m.allowed_origins) && m.allowed_origins.length > 0,
    };
    const allOk = Object.values(checks).every(Boolean);
    return {
      name: 'manifest-valid',
      ok: allOk,
      path,
      detail: { checks, manifest: m },
    };
  } catch (e) {
    return { name: 'manifest-valid', ok: false, path, error: e.message };
  }
}

async function checkRegistry() {
  if (process.platform !== 'win32') {
    return { name: 'registry', ok: true, skipped: true, reason: '非 Windows 平台' };
  }
  // 真一行 PowerShell,所有语句用 ; 分隔,避免 Node 侧把多行字符串塞给 -Command 时
  // 因为空白/换行处理不一致导致的 parser error。
  const script = [
    `$paths = @('HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.tabboard.tb','HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.tabboard.tb')`,
    `$found = @()`,
    `foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { $found += $p } }`,
    `if ($found.Count -gt 0) { Write-Output ($found -join '|'); exit 0 } else { exit 1 }`,
  ].join('; ');
  const r = await runPowerShell(script);
  return {
    name: 'registry',
    ok: r.ok,
    detail: r.ok
      ? { paths: r.code === 0 ? 'present' : 'absent (exit 1)' }
      : { error: r.stderr || '注册表查询失败' },
  };
}

async function checkSkills() {
  const expected = ['recent-browse', 'favorites-analyze', 'subscribe', 'crawl'];
  const present = [];
  const missing = [];
  for (const s of expected) {
    const p = join(SKILLS_DIR, s, 'SKILL.md');
    if (existsSync(p)) present.push(s);
    else missing.push(s);
  }
  return {
    name: 'skills-installed',
    ok: missing.length === 0,
    detail: { present, missing, skillsDir: SKILLS_DIR },
  };
}

async function checkLastBackup() {
  const path = join(STATE_DIR, 'last_backup.json');
  if (!existsSync(path)) {
    return { name: 'last-backup', ok: true, detail: { present: false } };
  }
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    return { name: 'last-backup', ok: true, detail: { present: true, ...data } };
  } catch (e) {
    return { name: 'last-backup', ok: false, error: e.message };
  }
}

async function Doctor() {
  const checks = await Promise.all([
    checkNode(),
    checkLakeWritable(),
    checkManifest(),
    checkRegistry(),
    checkSkills(),
    checkLastBackup(),
  ]);
  const allOk = checks.every(c => c.ok);
  // 始终 status: 'ok' —— 诊断结果是数据,不是命令错误。
  // allOk 字段单独表达健康度,前端/agent 自行判断。
  return {
    status: 'ok',
    data: {
      version: VERSION,
      tabboardDir: TABBOARD_DIR,
      allOk,
      checks,
      summary: allOk
        ? '所有检查通过。'
        : `${checks.filter(c => !c.ok).length} 项异常:${checks.filter(c => !c.ok).map(c => c.name).join(', ')}`,
    },
  };
}

Registry.register('doctor', Doctor);
