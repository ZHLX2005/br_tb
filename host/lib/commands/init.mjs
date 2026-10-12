// init:首次初始化。
//   1. 创建 ~/.tabboard/{lake,skills,state}/
//   2. 复制内置 skills 到 ~/.tabboard/skills/
//   3. 写 host.manifest.json(Chrome native messaging 锚点)
//   4. 写 Windows 注册表(Chrome + Edge)
//   5. 输出下一步建议
import { mkdir, writeFile, cp, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Registry } from '../registry.mjs';
import {
  TABBOARD_DIR, LAKE_DIR, SKILLS_DIR, STATE_DIR,
} from '../lake.mjs';
import { registerHost } from '../registry-windows.mjs';

const EXTENSION_ID = '6orv4jipupwr3nk75hnq2bosj63rwlus';  // 与 manifest key 一致
const HOST_NAME = 'com.tabboard.tb';

// 内置 skill(随包发布) → 复制到 ~/.tabboard/skills/
const BUILTIN_SKILLS = ['recent-browse', 'favorites-analyze', 'subscribe', 'crawl'];

async function Init(req) {
  const dryRun = req.dryRun === true || req['dry-run'] === true;
  const skipRegistry = req['skip-registry'] === true;
  const nodeExe = process.execPath;
  // init.mjs 在 lib/commands/,要回到 bin/tabboard.mjs 需要 .. .. 退出两层
  const entryPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'bin', 'tabboard.mjs'
  );

  const steps = [];

  // 1) 目录
  if (!dryRun) {
    await mkdir(LAKE_DIR, { recursive: true });
    await mkdir(SKILLS_DIR, { recursive: true });
    await mkdir(STATE_DIR, { recursive: true });
    steps.push({ step: 'mkdir', ok: true, paths: [LAKE_DIR, SKILLS_DIR, STATE_DIR] });
  } else {
    steps.push({ step: 'mkdir', ok: true, dryRun: true, paths: [LAKE_DIR, SKILLS_DIR, STATE_DIR] });
  }

  // 2) 复制内置 skills
  // init.mjs 在 lib/commands/,包根在 .. ..,skills 在包根下
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pkgSkills = join(pkgRoot, 'skills');
  const skillCopies = [];
  for (const skill of BUILTIN_SKILLS) {
    const src = join(pkgSkills, skill);
    const dst = join(SKILLS_DIR, skill);
    try {
      await access(src);
    } catch {
      continue;  // 内置 skill 文件未打包,跳过
    }
    if (!dryRun) {
      await cp(src, dst, { recursive: true });
    }
    skillCopies.push({ name: skill, src, dst });
  }
  steps.push({ step: 'skills', ok: true, dryRun, count: skillCopies.length, items: skillCopies });

  // 3) host.manifest.json
  const manifest = {
    name: HOST_NAME,
    description: 'TabBoard Native Host',
    path: nodeExe,
    arguments: [entryPath],
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
  const manifestPath = join(TABBOARD_DIR, 'host.manifest.json');
  if (!dryRun) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }
  steps.push({ step: 'manifest', ok: true, dryRun, path: manifestPath, manifest });

  // 4) 注册表(仅 Windows,非 dryRun)
  let registryResult = null;
  if (process.platform === 'win32' && !skipRegistry) {
    if (!dryRun) {
      registryResult = await registerHost(HOST_NAME, manifestPath);
    } else {
      registryResult = { ok: true, dryRun: true };
    }
    steps.push({ step: 'registry', ok: registryResult.ok, dryRun, result: registryResult });
  } else {
    steps.push({
      step: 'registry',
      ok: true,
      skipped: true,
      reason: process.platform !== 'win32' ? '非 Windows 平台' : '用户指定 --skip-registry',
    });
  }

  // 5) version 标记
  const versionPath = join(TABBOARD_DIR, 'VERSION');
  if (!dryRun) {
    const { VERSION } = await import('../version.mjs');
    await writeFile(versionPath, VERSION, 'utf8');
  }
  steps.push({ step: 'version', ok: true, path: versionPath });

  return {
    status: 'ok',
    data: {
      tabboardDir: TABBOARD_DIR,
      extensionId: EXTENSION_ID,
      hostName: HOST_NAME,
      nodeExe,
      entryPath,
      manifestPath,
      steps,
      next: dryRun
        ? 'dry-run 完成,无副作用。再次运行不带 --dry-run 真正初始化。'
        : '初始化完成。在扩展里点"同步到本地",然后运行 `tabboard list` 查看。',
    },
  };
}

Registry.register('init', Init);
