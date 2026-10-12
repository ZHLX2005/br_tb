// Native host transport:Chrome 启动进程时 stdin 是 pipe(不是 TTY)。
// 单消息模型 —— 读 1 条,处理 1 条,写 1 条。
// 失败也要写一条 error 响应,Chrome 端 sendNativeMessage 才能拿到 message。
// 不调 process.exit —— 让 bin/tabboard.mjs 的顶层 await 链自然结束,避免 "unsettled
// top-level await" 警告。
import { readMessage, writeMessage } from './protocol.mjs';
import { Registry } from './registry.mjs';

export async function runAsHost() {
  let resp;
  try {
    const req = await readMessage(process.stdin);
    resp = await Registry.handle(req?.command, req);  // ← 必须 await:handle 现在是 async
  } catch (e) {
    resp = { status: 'error', message: `host 读取失败: ${e?.message ?? e}` };
  }
  try {
    writeMessage(process.stdout, resp);
  } catch (e) {
    process.stderr.write(`host stdout 写失败: ${e?.message ?? e}\n`);
  }
  // 自然 return,让 bin 顶层 await 链结束
}
