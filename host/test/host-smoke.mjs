// smoke test: 模拟 Chrome spawn 写 native message 到 host,验证响应解析。
// 用法: node test/host-smoke.mjs
import { spawn } from 'node:child_process';

const HOST = new URL('../bin/tabboard.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const cases = [
  {
    name: 'backup',
    request: { command: 'backup', records: [{ kind: 'groups', data: { id: 'h1', name: 'smoke', ns: 'default' } }] },
    expectStatus: 'ok',
  },
  {
    name: 'list',
    request: { command: 'list', kind: 'groups' },
    expectStatus: 'ok',
  },
  {
    name: 'unknown',
    request: { command: 'nonsense' },
    expectStatus: 'error',
  },
];

let failed = 0;
for (const tc of cases) {
  const body = Buffer.from(JSON.stringify(tc.request), 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(body.length, 0);
  const input = Buffer.concat([lenBuf, body]);

  const child = spawn(process.execPath, [HOST], { stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdin.write(input);
  child.stdin.end();

  const chunks = [];
  for await (const c of child.stdout) chunks.push(c);
  const raw = Buffer.concat(chunks);

  if (raw.length < 4) {
    console.error(`[${tc.name}] FAIL: response too short (${raw.length} bytes)`);
    failed++;
    continue;
  }
  const len = raw.readUInt32LE(0);
  const respBody = raw.subarray(4, 4 + len).toString('utf8');
  const resp = JSON.parse(respBody);
  const ok = resp.status === tc.expectStatus;
  console.log(`[${tc.name}] ${ok ? 'OK' : 'FAIL'}: status=${resp.status}`);
  if (!ok) {
    console.error('  expected:', tc.expectStatus);
    console.error('  got:', JSON.stringify(resp));
    failed++;
  }

  child.kill();
}

process.exit(failed === 0 ? 0 : 1);
