// Native host transport:Chrome 启动进程时 stdin 是 pipe(不是 TTY)。
// 消息循环模型 —— 读 1 条 / 处理 1 条 / 写 1 条,循环直到 stdin EOF:
//   - sendNativeMessage(单发):Chrome 收到响应后关闭管道 → EOF → 进程自然退出
//     (Chrome 对 sendNativeMessage 也会主动终止 host,双保险)
//   - connectNative(常驻):端口开着 → stdin 一直有 → host 常驻等下一条;
//     扩展侧 port.disconnect() / SW 休眠 → Chrome 杀进程
// 不调 process.exit —— 让 bin/tabboard.mjs 的顶层 await 链自然结束,避免 "unsettled
// top-level await" 警告。
import { readMessage, writeMessage } from './protocol.mjs';
import { Registry } from './registry.mjs';

export async function runAsHost() {
  while (true) {
    let req;
    try {
      req = await readMessage(process.stdin);   // stdin EOF → reject → 退出循环
    } catch (e) {
      if (process.env.TABBOARD_HOST_TRACE) {
        process.stderr.write(`[host] stdin 关闭(${e?.message ?? e}),共处理 ${globalThis.__hostServed ?? 0} 条\n`);
      }
      break;
    }
    globalThis.__hostServed = (globalThis.__hostServed ?? 0) + 1;
    let resp;
    try {
      resp = await Registry.handle(req?.command, req);   // handle 是 async,必须 await
    } catch (e) {
      resp = { status: 'error', message: `handler 异常: ${e?.message ?? e}` };
    }
    try {
      writeMessage(process.stdout, resp);
    } catch (e) {
      process.stderr.write(`host stdout 写失败: ${e?.message ?? e}\n`);
      break;   // stdout 断了(Chrome 已走) → 没必要继续
    }
  }
  // 自然 return,让 bin 顶层 await 链结束
}
