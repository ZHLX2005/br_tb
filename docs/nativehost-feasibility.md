# NativeHost + npx + 本地数据湖：tabboard 同步架构 v3

> 替换 v2（"Go binary"）。本版用 **Node.js (npx) 作为 native host**，整个栈统一到 JS/Node。
> 核心理念不变：**一个 entry，两个 transport 入口（native host + CLI），同一套 registry**。
> 数据湖用 JSONL，写入由按钮触发，首次用 `npx @tabboard/host init` 初始化，skill 走 nx-tb 已有规范。

## 关键变更（vs v2 Go 版）

| 维度 | v2 (Go) | v3 (Node) |
|---|---|---|
| Native host 是什么 | 编译后的 `tabboard.exe` | 一个 `.mjs` 脚本，被 `node.exe` 启动 |
| 分发形式 | prebuilt binary (~10MB) + 跨平台编译 | npm 包 + Node 18+ 运行时（0 编译） |
| Windows 注册表 `path` | `C:\...\tabboard.exe` | `C:\...\node.exe` + `arguments: ["...\\bin\\tabboard.mjs"]` |
| Native host 入口 | 单独 `host.mjs` | **同一个** `bin/tabboard.mjs`（自动检测 stdin 是 pipe 还是 TTY） |
| Skill runtime | Node 调 Node（`exec.Command("node", ...)`） | **同进程 import**（零 fork） |
| Skill 文件后缀 | `run.mjs` 调外部 Node | `run.mjs` 直接 import 进来跑 |
| 跨平台 | 要 Go 工具链 + 3 个 OS 编译 | **只跟 Node 走**，Win/Mac/Linux 一份代码 |
| 总代码量 | ~700 行 | **~400 行** |
| MVP 估时 | 2 天 | **1.5 天** |
| 长期摩擦 | Go ↔ Node 数据类型转换、跨语言 trace | 零 |

→ 选 Node 不只是省事，是**消除了"两种语言"这个根本的认知开销**。所有代码都用 JS，所有数据都过 JSON，所有异步都是 Promise。

---

## TL;DR 架构图

```
                  ┌──────────────────────────────────────────┐
                  │  bin/tabboard.mjs  (单文件,双 transport) │
                  │  ┌──────────────────────────────────┐    │
                  │  │  Registry                        │    │
                  │  │    register("init",     Init)    │    │
                  │  │    register("backup",   Backup)  │    │
                  │  │    register("list",     List)    │    │
                  │  │    register("scan",     Scan)    │    │
                  │  │    register("skill",    RunSkill)│    │
                  │  └──────────────────────────────────┘    │
                  │       ▲                       ▲          │
        stdin/JSON│       │  process.stdin       │argv      │stdout
        (Chrome)  │       │  isTTY === false     │(npx)     │
                  └───────┼───────────────────────┼──────────┘
                          │                       │
        ┌─────────────────┘                       └──────────────────┐
        ▼                                                           ▼
  Chrome 扩展                                            用户终端
  popup 按钮 →                                       $ npx tabboard ...
  sendNativeMessage                                       (分析 / 订阅 / 爬虫)

       │ 写 (仅扩展 → host)                                  │ 读 (仅 npx → 脚本)
       ▼                                                     ▼
                  ┌──────────────────────────────────────────┐
                  │  ~/.tabboard/lake/  (JSONL 数据湖)       │
                  │    groups.jsonl, tabs.jsonl, notes.jsonl │
                  │    subscribe.jsonl, crawl.jsonl ...      │
                  │  ~/.tabboard/skills/ (skill 源,仿 nx-tb) │
                  │    <skill>/SKILL.md + run.mjs            │
                  │  ~/.tabboard/host.manifest.json (Chrome) │
                  └──────────────────────────────────────────┘
```

**关键不变量**：
- 扩展只能**写**数据湖（通过 native host），不能读——读是 npx 的活
- native host 进程**只写**不读——写完即 `process.exit(0)`，不持有长连接
- npx **只读**数据湖 + 跑 skill，不调 native host
- 一个 `Registry.register(name, handler)` 同时给两个 transport 用——**没有"分叉"的可能性**

---

## 1. 核心模式：一个 entry，两个 transport

### 1.1 Transport 分流（Node 端单文件搞定）

`bin/tabboard.mjs`：

```js
#!/usr/bin/env node
import { runAsHost } from '../lib/host.mjs';
import { runAsCLI } from '../lib/cli.mjs';
import { loadAllCommands } from '../lib/commands/index.mjs';

// 注册所有命令(handler 在 import 时自动 register)
loadAllCommands();

// Chrome 启动时 stdin 是 pipe;用户 npx 启动时是 TTY
const isStdio = !process.stdin.isTTY;
if (isStdio) {
  await runAsHost();
} else {
  await runAsCLI(process.argv.slice(2));
}
```

`lib/host.mjs`：

```js
import { readMessage, writeMessage } from './protocol.mjs';
import { Registry } from './registry.mjs';

// 一条消息一个生命周期
export async function runAsHost() {
  try {
    const req = await readMessage(process.stdin);
    const resp = Registry.handle(req.command, req);
    await writeMessage(process.stdout, resp);
  } catch (e) {
    await writeMessage(process.stdout, { status: 'error', message: e.message });
  }
  process.exit(0);  // ← 关键:立刻退,不持有长连接
}
```

`lib/cli.mjs`：

```js
import { Registry } from './registry.mjs';
import { parseArgs } from './argv.mjs';

export async function runAsCLI(argv) {
  if (argv.length === 0) { printHelp(); return; }
  const [command, ...rest] = argv;
  const req = parseArgs(rest);
  const resp = Registry.handle(command, req);
  if (resp.status === 'error') {
    console.error('错误: ' + resp.message);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(resp.data ?? {}, null, 2));
  }
}
```

### 1.2 Registry 自动注册

`lib/registry.mjs`：

```js
class RegistryClass {
  constructor() { this.handlers = new Map(); }
  register(name, handler) {
    if (this.handlers.has(name)) throw new Error('重复注册: ' + name);
    this.handlers.set(name, handler);
  }
  handle(name, req) {
    const h = this.handlers.get(name);
    if (!h) return { status: 'error', message: '未知命令: ' + name };
    try {
      return h(req) ?? { status: 'ok' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  }
}
export const Registry = new RegistryClass();
```

每个命令文件在 import 时自注册：

```js
// lib/commands/backup.mjs
import { Registry } from '../registry.mjs';
import { appendRecords } from '../lake.mjs';

function Backup(req) {
  const wrote = appendRecords(req.records ?? []);
  return { status: 'ok', data: { wrote } };
}

Registry.register('backup', Backup);
```

`lib/commands/index.mjs`：

```js
// 全部 import 一下,触发自注册
import './init.mjs';
import './backup.mjs';
import './list.mjs';
import './show.mjs';
import './scan.mjs';
import './skill.mjs';
import './subscribe.mjs';
import './crawl.mjs';
import './doctor.mjs';
```

→ **加新命令 = 加一个文件 + 在 index.mjs 多 import 一行**。两个 transport 立刻都能调。

### 1.3 协议（lib/protocol.mjs）

Chrome Native Messaging 标准：4 字节 Little-Endian 长度 + JSON body。Node 端实现：

```js
import { Buffer } from 'node:buffer';

export function readMessage(stdin) {
  return new Promise((resolve, reject) => {
    const lenBuf = Buffer.alloc(4);
    let got = 0;
    const onReadable = () => {
      // 攒 4 字节
      while (got < 4) {
        const chunk = stdin.read(4 - got);
        if (!chunk) return;
        chunk.copy(lenBuf, got);
        got += chunk.length;
      }
      const len = lenBuf.readUInt32LE(0);
      if (len > 100 * 1024 * 1024) return reject(new Error('消息过大: ' + len));
      // 攒 `len` 字节
      const data = Buffer.alloc(len);
      let dataGot = 0;
      while (dataGot < len) {
        const chunk = stdin.read(len - dataGot);
        if (!chunk) return;  // 等下一次 readable
        chunk.copy(data, dataGot);
        dataGot += chunk.length;
      }
      stdin.off('readable', onReadable);
      try { resolve(JSON.parse(data.toString('utf8'))); }
      catch (e) { reject(e); }
    };
    stdin.on('readable', onReadable);
    stdin.on('end', () => reject(new Error('stdin closed')));
  });
}

export function writeMessage(stdout, msg) {
  const data = Buffer.from(JSON.stringify(msg), 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(data.length, 0);
  stdout.write(lenBuf);
  stdout.write(data);
}
```

### 1.4 与 v2 (Go) 版的对照

| 维度 | Go 版 | Node 版 |
|---|---|---|
| 协议层代码 | 80 行 | **50 行**（无 binary 编码烦恼） |
| Registry 类 | 27 行 | **20 行**（Map + register/handle） |
| handler 函数 | `func(req Request) Response` | `function(req) { status, data \| message }` |
| 自注册 | `func init() { Registry.Register(...) }` | `Registry.register(...)` 写在文件顶层,import 时触发 |
| 异步 | goroutine + channel | `async/await` + Promise |
| 错误处理 | `if err != nil { return Response{Status:error} }` | `try { } catch { return { status:'error' } }` 或直接抛 |
| 跨 transport 复用 | 100% | 100% |

**总代码量估算（含 host 入口、协议、registry、所有命令、init）：~400 行 Node**（v2 Go 是 ~700 行）。

---

## 2. 数据湖：JSONL 格式

### 2.1 文件布局

```
~/.tabboard/
├── host.manifest.json       # Chrome native messaging 注册表锚点
├── lake/
│   ├── groups.jsonl         # 每行一个 group 对象
│   ├── tabs.jsonl           # 每行一个 tab 对象(扁平,带 groupId)
│   ├── notes.jsonl
│   ├── recordings.jsonl
│   ├── videoGroups.jsonl
│   ├── leetcodeProgress.jsonl
│   ├── subscribe.jsonl
│   └── crawl.jsonl
├── skills/                  # 仿 nx-tb skill 源
│   ├── recent-browse/
│   │   ├── SKILL.md
│   │   └── run.mjs
│   ├── favorites-analyze/
│   │   ├── SKILL.md
│   │   └── run.mjs
│   ├── subscribe/
│   │   ├── SKILL.md
│   │   └── run.mjs
│   └── crawl/
│       ├── SKILL.md
│       └── run.mjs
├── state/
│   └── last_backup.json     # {ts, fileCount, totalBytes}
└── VERSION
```

### 2.2 lake.mjs（核心 I/O）

```js
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

export const LAKE_DIR = process.env.TABBOARD_LAKE_DIR
  ?? (process.env.HOME || process.env.USERPROFILE) + '/.tabboard/lake';

// ---- 写 ----
export async function appendRecords(records) {
  // 按 kind 分桶,每桶追加到对应 .jsonl
  const buckets = new Map();
  for (const r of records) {
    if (!buckets.has(r.kind)) buckets.set(r.kind, []);
    buckets.get(r.kind).push(JSON.stringify({ ...r.data, _ts: Date.now() }));
  }
  let wrote = 0;
  for (const [kind, lines] of buckets) {
    const path = join(LAKE_DIR, kind + '.jsonl');
    await mkdir(dirname(path), { recursive: true });
    // 一次 syscall 写完一个 kind 的所有行(批 append)
    await appendFile(path, lines.join('\n') + '\n', 'utf8');
    wrote += lines.length;
  }
  return wrote;
}

// ---- 读 ----
export async function readJsonl(kind, { limit, filter } = {}) {
  const path = join(LAKE_DIR, kind + '.jsonl');
  const out = [];
  try {
    const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line);
      if (filter && !filter(obj)) continue;
      out.push(obj);
      if (limit && out.length >= limit) break;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return out;
}
```

### 2.3 写并发保证

- **单写者**：popup 一次只能开一个,按钮是用户手动触发 → 实际不会并发
- **OS `O_APPEND` 原子性**：POSIX 与 Windows 都保证单次 write < PIPE_BUF 原子；批 append 一次性写多行也是单 syscall
- **真正并发只可能跨进程**(扩展 ↔ npx),但 npx **不写**——npx 只读
- **读并发**：Node `readline` 逐行扫,过程中允许追加(扫到新行 = 看到追加)。不实现查询引擎,过滤用 JS function 即可

### 2.4 不需要 compaction

JSONL 是 append-only,但本场景单条 ~200B,即使 10 年累计 ~5MB/文件。compaction 是优化项,不是必需。

---

## 3. 写触发：按钮 + npx 首次初始化

### 3.1 扩展侧按钮（popup）

复用本会话已加的 `exportAllStorage`：

```js
// popup.js 新增"同步到本地"按钮
async function onSyncToLocalClick() {
  // 1) 拿全量 storage
  const all = await chrome.storage.local.get(null);

  // 2) 转成 records 数组
  const records = [];
  for (const [key, value] of Object.entries(all)) {
    if (Array.isArray(value)) {
      for (const item of value) records.push({ kind: key, data: item });
    } else if (value && typeof value === 'object') {
      records.push({ kind: key, data: value });
    } else {
      records.push({ kind: key, data: { value } });
    }
  }

  // 3) 发给 native host
  const resp = await chrome.runtime.sendNativeMessage('com.tabboard.tb', {
    command: 'backup',
    records
  });
  if (resp?.status === 'ok') {
    showToast(`已同步 ${resp.data.wrote} 条到本地`);
  } else {
    showToast('同步失败: ' + resp?.message, 'error');
  }
}
```

**单写者保证**：popup 一次只能开一个,IPC 通道断开后 Chrome 不再持有 host 句柄 → 无 race。

### 3.2 首次初始化（npx init）

```bash
$ npx -y @tabboard/host init
```

`lib/commands/init.mjs` 的职责：

```js
import { writeFile, mkdir, cp, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Registry } from '../registry.mjs';
import { runRegAdd } from '../registry-windows.mjs';  // 仅 Windows

const TABBOARD_DIR = (process.env.HOME || process.env.USERPROFILE) + '/.tabboard';
const EXTENSION_ID = '6orv4jipupwr3nk75hnq2bosj63rwlus';  // ← 本会话已生成
const HOST_NAME = 'com.tabboard.tb';

async function Init() {
  // 1) 创建目录
  await mkdir(join(TABBOARD_DIR, 'lake'), { recursive: true });
  await mkdir(join(TABBOARD_DIR, 'skills'), { recursive: true });
  await mkdir(join(TABBOARD_DIR, 'state'), { recursive: true });

  // 2) 复制内置 skills(随包发布)
  const pkgSkills = resolve(fileURLToPath(import.meta.url), '../../../skills');
  for (const skill of ['recent-browse', 'favorites-analyze', 'subscribe', 'crawl']) {
    await cp(join(pkgSkills, skill), join(TABBOARD_DIR, 'skills', skill), { recursive: true });
  }

  // 3) 写 host.manifest.json
  const nodeExe = process.execPath;  // ← 关键:捕获当前 Node 路径
  const scriptPath = resolve(fileURLToPath(import.meta.url), '../..', 'bin', 'tabboard.mjs');
  const manifest = {
    name: HOST_NAME,
    description: 'TabBoard Native Host',
    path: nodeExe,
    arguments: [scriptPath],
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
  };
  await writeFile(join(TABBOARD_DIR, 'host.manifest.json'),
                  JSON.stringify(manifest, null, 2), 'utf8');

  // 4) 写 Windows 注册表
  await runRegAdd(HOST_NAME, join(TABBOARD_DIR, 'host.manifest.json'));

  return { status: 'ok', data: {
    tabboardDir: TABBOARD_DIR,
    nodeExe,
    scriptPath,
    extensionId: EXTENSION_ID,
    next: '在扩展里点"同步到本地",然后运行 `npx tabboard list` 查看'
  }};
}

Registry.register('init', Init);
```

`registry-windows.mjs`（PowerShell reg add 包装）：

```js
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';

export async function runRegAdd(hostName, manifestPath) {
  // Chrome + Edge 都注册,HKCU 不需要管理员
  for (const regPath of [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${hostName}`,
  ]) {
    await new Promise((resolve, reject) => {
      const ps = spawn('powershell', [
        '-NoProfile', '-Command',
        `New-Item -Path '${regPath}' -Force | Set-ItemProperty -Value '${manifestPath.replace(/\\/g, '\\\\')}'`
      ], { stdio: 'ignore' });
      ps.on('close', code => code === 0 ? resolve() : reject(new Error('reg add failed: ' + code)));
    });
  }
}
```

### 3.3 写流程时间线

```
用户场景 A(扩展先):
  装扩展 → popup 加数据 → 点"同步到本地" → Chrome 尝试启动 host
  → 找不到 host(未注册)→ 弹"未找到 native host"
  → 提示用户:"请先在终端运行 npx -y @tabboard/host init"
  → 用户跑 init → 写注册表 + 复制 skills
  → 用户回扩展再点同步 → 成功

用户场景 B(npx 先):
  跑 npx -y @tabboard/host init → 装好
  装扩展 → popup 加数据 → 点"同步到本地" → 成功(无需提示)
```

---

## 4. Skill 系统：照搬 nx-tb 规范

`D:\code\a_js\proj\js\test_feature\nx-tb\assets\nx-tb\SKILL.md` + `groups.json` + `install/inject-root.mjs` 的 pattern 直接复用。

### 4.1 一个 skill 的样子

```
~/.tabboard/skills/recent-browse/
├── SKILL.md              # frontmatter: name, description, 触发词
└── run.mjs               # Node 脚本,接收 ctx,输出结果
```

`run.mjs` 的 IO 约定：

```js
// 收到 ctx(从主进程 fork/exec 时注入):
//   { args: ["--days", "7"], lakeDir: "~/.tabboard/lake", extensionId: "..." }
// 输出: 任意 JSON 到 stdout;日志到 stderr
// 退出: 0 = ok,非 0 = 失败

import { readJsonl } from '../_shared/lake-readers.mjs';

const ctx = JSON.parse(await readStdin());
const days = parseInt(ctx.args.find(a => ctx.args[ctx.args.indexOf(a) - 1] === '--days') ?? '7');
const tabs = await readJsonl(ctx.lakeDir, 'tabs', { limit: 100 });
const since = Date.now() - days * 86400_000;
const recent = tabs
  .filter(t => (t._ts ?? 0) > since)
  .sort((a, b) => (b._ts ?? 0) - (a._ts ?? 0))
  .slice(0, 20);
console.log(JSON.stringify({ count: recent.length, tabs: recent }, null, 2));
```

### 4.2 主进程的 skill dispatch（同进程！）

v2 Go 版要 `exec.Command("node", ...)` fork 子进程。**v3 Node 版直接 import 跑**——零 fork 零 IPC：

```js
// lib/commands/skill.mjs
import { Registry } from '../registry.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const SKILLS_DIR = process.env.TABBOARD_SKILLS_DIR
  ?? (process.env.HOME || process.env.USERPROFILE) + '/.tabboard/skills';

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]+?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const [k, ...rest] = line.split(':');
    if (k && rest.length) out[k.trim()] = rest.join(':').trim();
  }
  return out;
}

async function RunSkill(req) {
  const [name, ...args] = req.args ?? [];
  if (name === 'list') {
    // 列已装 skill:扫目录读 SKILL.md frontmatter
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
    const skills = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const mdPath = join(SKILLS_DIR, e.name, 'SKILL.md');
        if (!existsSync(mdPath)) return null;
        const meta = parseFrontmatter(readFileSync(mdPath, 'utf8'));
        return { name: e.name, ...meta };
      })
      .filter(Boolean);
    return { status: 'ok', data: { skills } };
  }

  // 跑指定 skill:dynamic import 跑 run.mjs
  const runPath = join(SKILLS_DIR, name, 'run.mjs');
  if (!existsSync(runPath)) return { status: 'error', message: 'skill 不存在: ' + name };

  // 注入 ctx 到 process.env,skill 自己读
  process.env.TABBOARD_SKILL_CTX = JSON.stringify({
    args, lakeDir: LAKE_DIR, extensionId: EXTENSION_ID
  });
  try {
    await import(pathToFileURL(runPath).href);
    return { status: 'ok' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

Registry.register('skill', RunSkill);
```

→ **零 fork**: skill 在主进程里 dynamic import 跑,所有变量共享(数据湖路径、registry、配置)。调试时打 `console.log` 直接出现在主进程 stdout,不用分两个窗口看。

### 4.3 内置 skill 列表（v0）

| skill | 触发词 | 行为 |
|---|---|---|
| `recent-browse` | "最近浏览" / "recent" | 读 `tabs.jsonl`,按 ts 倒序,输出 top N |
| `favorites-analyze` | "收藏分析" | 读 `groups.jsonl` + `tabs.jsonl`,输出每组标签数、URL 去重数、Top 域 |
| `subscribe` | "加订阅" | 追加一行到 `subscribe.jsonl` |
| `crawl` | "抓订阅" | 读 `subscribe.jsonl` 逐个 fetch,结果追加到 `crawl.jsonl` |

---

## 5. 完整 CLI 表面

```bash
npx tabboard init                                # 首次初始化(创建数据湖 + 写注册表 + 复制 skills)
npx tabboard list [--kind tabs] [--limit 50]     # 列数据湖
npx tabboard show <kind> <id>                    # 查单条记录
npx tabboard backup --file <json>                # (CLI 写,等同按钮但从文件读)
npx tabboard skill list                          # 列出已装 skill
npx tabboard skill <name> [--args ...]           # 跑 skill
npx tabboard subscribe add <url>                 # 加订阅
npx tabboard crawl [--limit 5]                   # 抓订阅
npx tabboard doctor                              # 健康检查
npx tabboard version                             # 版本
```

每个 `npx tabboard <cmd>` 对应 `Registry.register('<cmd>', handler)`。同样,这些 name 也能从 native host 调（扩展发 `{command: "list", ...}`）。

---

## 6. 与本会话已完成工作的衔接

| 已完成 | 怎样接 v3 |
|---|---|
| `exportAllStorage` / `importAllStorage` 在 `group-model.js` | **完全复用** —— popup 的"同步到本地"按钮内部调 `exportAllStorage()` 拿全量,转 records 发给 native host |
| manifest 的 `key` 字段(扩展 ID `6orv4jipupwr3nk75hnq2bosj63rwlus`) | npx init 时写进 `host.manifest.json` 的 `allowed_origins` |
| popup 的"数据备份"区(导出/导入按钮) | 旁边**加 1 个"同步到本地"按钮**,共用 `exportAllStorage` 拉数据 |
| `.gitignore` 加 `keys/*` | 同样管 native host 路径(`@tabboard/host` 不进 git,只进 npm 包) |
| `nx-tb` 脚手架(skill CLI + Web 面板) | **skill 体系直接复用** —— v3 的 `skill/<name>/run.mjs` 和 nx-tb 的 `actions.js` 是同一种东西 |

**零返工。**

---

## 7. 实施 phases

### Phase 1:Node 包骨架 + CLI + stdio + init（一次性全部）

- npm 包结构：`@tabboard/host`
- `bin/tabboard.mjs` 单文件双 transport 分流
- `lib/protocol.mjs` + `lib/registry.mjs` + `lib/lake.mjs`
- 5 个内置命令: `init` / `list` / `show` / `backup` / `doctor`
- **估时:1 天 / ~400 行**

### Phase 2:扩展侧"同步到本地"按钮

- popup 新增按钮,复用 `exportAllStorage`
- 通过 `chrome.runtime.sendNativeMessage('com.tabboard.tb', {command:'backup', records:[...]})` 调
- 不需要 background relay(单消息,短生命周期)
- **估时:0.5 天 / +30 行 JS**

### Phase 3:Skill 系统(4 个内置 skill)

- `recent-browse` / `favorites-analyze` / `subscribe` / `crawl` 各一个 `run.mjs`
- 同进程 dynamic import,零 fork
- **估时:1 天 / ~200 行 JS**

### Phase 4:npm 发布 + GitHub Actions

- 复用 nx-tb 的 `npm-publish.yml` 模板
- **无 prebuilt binary 步骤**(纯 JS 包,体积小)
- **估时:0.25 天**

### Phase 5(可选):Web 面板

- 仿 nx-tb 加 HTTP server + React 面板,展示数据湖
- **估时:2 天 / 复用 nx-tb scaffold**

**总估时:~5 天**(含可选 Web 面板) / **MVP(Phase 1+2) 1.5 天**

---

## 8. 文件树（最终态）

```
@tabboard/host/                      # npm 包根
├── package.json                     # bin: { tabboard: "./bin/tabboard.mjs" }
├── bin/
│   └── tabboard.mjs                 # 单 entry,自动检测 transport
├── lib/
│   ├── protocol.mjs                 # 4B-LE + JSON 编解码
│   ├── registry.mjs                 # Registry 类
│   ├── lake.mjs                     # JSONL 读写
│   ├── host.mjs                     # native host transport
│   ├── cli.mjs                      # CLI transport
│   ├── argv.mjs                     # argv → req 对象
│   ├── registry-windows.mjs         # Windows reg add 包装
│   └── commands/
│       ├── index.mjs                # 全部 import 触发自注册
│       ├── init.mjs                 # 创建数据湖 + 写注册表 + 复制 skills
│       ├── backup.mjs               # 写 records 到 JSONL
│       ├── list.mjs                 # 读 JSONL
│       ├── show.mjs                 # 查单条
│       ├── scan.mjs                 # 扫最近浏览(简版)
│       ├── skill.mjs                # 跑 skill
│       ├── subscribe.mjs            # 加订阅
│       ├── crawl.mjs                # 抓订阅(简版)
│       └── doctor.mjs               # 健康检查
├── skills/                          # 内置 skill 源(init 时复制到 ~/.tabboard/skills/)
│   ├── recent-browse/{SKILL.md, run.mjs}
│   ├── favorites-analyze/{SKILL.md, run.mjs}
│   ├── subscribe/{SKILL.md, run.mjs}
│   └── crawl/{SKILL.md, run.mjs}
└── README.md
```

→ 整个包**不到 1MB**,npm 发布 0 摩擦。

---

## 9. 未决问题(本会话内不动,先记下来)

1. **跨平台 Node 路径检测**: Windows 上 Node 路径在 Volta/nvm/系统安装时不同。`init` 用 `process.execPath` 捕获当前 Node,**能解决 99% 场景**;但用户从 A Node 跑 init,后来切到 B Node,host 仍指向 A Node → 失效
   → v0 不处理(用户自负责);后续可加 `tabboard repair` 子命令重写
2. **macOS / Linux 支持**: nativeMessaging 注册机制类似但路径不同(macOS 用 `~/Library/Application Support/<name>/`,Linux 用 `~/.config/<name>/` + `org.chromium.chromium.native-messaging-allowed-hosts`)
   → 先 Windows(用户当前环境),其他 OS 后置
3. **数据隐私**: 数据湖是明文 JSONL,无加密。机器被他人访问能直接读到
   → v0 不做加密(用户机器本地数据,信任本地用户)
4. **与 chrome.storage 的同步方向**: 当前是 chrome.storage → 数据湖(单向)。改了数据湖怎么办?
   → 暂时**单向**,未来加 `import` 命令反向同步回 chrome.storage
5. **skill 权限模型**: `crawl` skill 会从公网 fetch
   → v0 不限速,用户自负责;后续加 `--rate-limit` flag
6. **错误诊断**: host 启动失败、注册表写失败、协议错位——统一靠 `tabboard doctor` 自检
   → 已在 Phase 1 内

---

## 10. 何时启动

短期(本会话已落地):
- ✅ 数据备份(导出 JSON / 重新导入) — popup 按钮
- ✅ 稳定扩展 ID(`6orv4jipupwr3nk75hnq2bosj63rwlus`) — manifest key
- ✅ v3 可行性分析(本文件) — Node 版架构

下一步(下个会话):
- **Phase 1**(Node 包骨架,1 天)
- **Phase 2**(扩展按钮,0.5 天)
- 跑通后用户能:`npx -y @tabboard/host init` → 装扩展 → 点同步 → `npx tabboard list` 看到数据

**MVP 1.5 天,比 v2 Go 版少 0.5 天,且没有 Go 工具链依赖。**

后续:
- Phase 3 / 4(skill + npm 发布)— 1.25 天
- Phase 5(Web 面板,可选)— 2 天
