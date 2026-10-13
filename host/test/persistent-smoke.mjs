// 常驻模式测试:一个 host 进程内连续发 3 条消息(version/list/doctor)
// 预期:3 条响应 + 进程保持存活(= connectNative 语义)
// 结束:kill 模拟 port.disconnect()
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['bin/tabboard.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] });

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  child.stdin.write(Buffer.concat([len, body]));
}

const responses = [];
let buf = Buffer.alloc(0);
child.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const body = buf.subarray(4, 4 + len);
    buf = buf.subarray(4 + len);
    try { responses.push(JSON.parse(body.toString('utf8'))); } catch { /* 跳过 */ }
  }
});

send({ command: 'version' });
setTimeout(() => send({ command: 'list' }), 300);
setTimeout(() => send({ command: 'doctor' }), 600);

setTimeout(() => {
  console.log('收到响应数:', responses.length, '(期望 3)');
  for (const r of responses) {
    console.log(' -', r.status, JSON.stringify(r.data ?? r.message ?? {}).slice(0, 90));
  }
  console.log('进程保持存活(常驻语义):', child.exitCode === null ? 'YES' : 'NO(exit=' + child.exitCode + ')');
  child.kill();
  process.exit(responses.length === 3 && child.exitCode === null ? 0 : 1);
}, 1500);
