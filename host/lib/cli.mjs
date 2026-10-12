// CLI transport:argv → req → Registry.handle → stdout/stderr。
// 输出格式:
//   - 默认:人类可读(JSON.stringify with indent)
//   --json flag:裸 JSON(agent / 脚本友好)
//   - 错误:stderr + exit 1
import { Registry } from './registry.mjs';
import { parseArgs } from './argv.mjs';
import { VERSION } from './version.mjs';

const HELP = `tabboard · TabBoard native host + 数据湖 CLI

用法:
  tabboard <command> [args]
  tabboard --json <command> [args]   机器可读输出
  tabboard --help
  tabboard --version

可用命令:
{{COMMANDS}}

数据湖位置: {{LAKE_DIR}}
环境变量覆盖: TABBOARD_LAKE_DIR / TABBOARD_SKILLS_DIR / TABBOARD_DIR
`;

function buildHelp() {
  const cmds = Registry.list();
  return HELP
    .replace('{{COMMANDS}}', cmds.length ? `  ${cmds.join('\n  ')}` : '  (尚未注册)')
    .replace('{{LAKE_DIR}}', process.env.TABBOARD_LAKE_DIR ?? '<默认 ~/.tabboard/lake>');
}

export async function runAsCLI(argv) {
  // 全局 flag 先摘
  let json = false;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { json = true; continue; }
    if (a === '--help' || a === '-h') {
      console.log(buildHelp());
      return;
    }
    if (a === '--version' || a === '-V') {
      console.log(VERSION);
      return;
    }
    rest.push(a);
  }

  if (rest.length === 0) {
    console.log(buildHelp());
    return;
  }

  const [command, ...args] = rest;
  let req;
  try {
    req = parseArgs(args);
  } catch (e) {
    fail({ status: 'error', message: e.message }, json);
    return;
  }

  const resp = await Registry.handle(command, req);  // ← await 是关键
  if (resp.status === 'error') {
    fail(resp, json);
    return;
  }
  ok(resp, json);
}

function ok(resp, json) {
  if (json) {
    console.log(JSON.stringify(resp, null, 2));
  } else if (resp.data === undefined || resp.data === null) {
    // 纯成功,无数据
    if (resp.message) console.log(resp.message);
  } else if (typeof resp.data === 'string') {
    console.log(resp.data);
  } else {
    console.log(JSON.stringify(resp.data, null, 2));
  }
}

function fail(resp, json) {
  if (json) {
    console.log(JSON.stringify(resp, null, 2));
  } else {
    console.error('错误: ' + resp.message);
    if (resp.available?.length) {
      console.error('可用命令: ' + resp.available.join(', '));
    }
  }
  process.exitCode = 1;
}
