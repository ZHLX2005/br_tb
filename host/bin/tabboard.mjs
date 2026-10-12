#!/usr/bin/env node
// 单 entry:根据 stdin 是否有数据可读分流到 native host 或 CLI 模式。
//   - Chrome 启动 → stdin 是 pipe 且会写入 → host 模式(读 1 条 / 写 1 条 / 退)
//   - npx / 终端 → stdin 没有数据可读 → CLI 模式(argv 解析)
//
// 触发所有 commands 自注册后,再调 transport。
import { isatty } from 'node:tty';
import { runAsHost } from '../lib/host.mjs';
import { runAsCLI } from '../lib/cli.mjs';
import '../lib/commands/index.mjs';

// 检测 stdin 是否有真实数据可读。
// TTY → CLI;非 TTY → 等 50ms 短探针,期间 stdin 真的进了数据就 host 模式。
// 关键:不调用 read() / unshift(),因为 unshift 会把字节插到 buffer 头部,破坏后续长度前缀。
// 关键2:resolve 时必须把 readable/end listener 都清掉,否则 protocol.mjs 的 readExact
// 加上去会跟残留 listener 互相干扰,readable 事件不触发。
const stdinHasData = await new Promise((resolve) => {
  if (isatty(0)) return resolve(false);
  let done = false;
  const finish = (v) => {
    if (done) return;
    done = true;
    // 清掉 probe 自己挂的 listener
    process.stdin.removeListener('readable', onReadable);
    process.stdin.removeListener('end', onEnd);
    clearTimeout(timer);
    resolve(v);
  };
  const onReadable = () => {
    if (process.stdin.readableLength > 0) finish(true);
  };
  const onEnd = () => finish(false);
  process.stdin.on('readable', onReadable);
  process.stdin.on('end', onEnd);
  const timer = setTimeout(() => finish(false), 50);
});

if (stdinHasData) {
  await runAsHost();
} else {
  await runAsCLI(process.argv.slice(2));
}
