// Chrome Native Messaging 协议：4 字节 Little-Endian 长度前缀 + UTF-8 JSON。
// 单消息模型：本进程期望读 1 条、写 1 条、退出。
import { Buffer } from 'node:buffer';

const MAX_MSG = 100 * 1024 * 1024; // 100MB,防御性上限

// 阻塞读直到攒齐 length 字节。
// 用一次性 on('readable') + 累加 buffer,避免 readline 拆分 UTF-8 多字节字符。
function readExact(stdin, length) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.alloc(length);
    let got = 0;
    const onReadable = () => {
      while (got < length) {
        const chunk = stdin.read(length - got);
        if (chunk === null) return; // 等下一次 readable
        chunk.copy(buf, got);
        got += chunk.length;
      }
      stdin.off('readable', onReadable);
      stdin.off('end', onEnd);
      resolve(buf);
    };
    const onEnd = () => {
      stdin.off('readable', onReadable);
      reject(new Error(`stdin closed before ${length} bytes (got ${got})`));
    };
    stdin.on('readable', onReadable);
    stdin.on('end', onEnd);
  });
}

export async function readMessage(stdin) {
  const lenBuf = await readExact(stdin, 4);
  const len = lenBuf.readUInt32LE(0);
  if (len > MAX_MSG) throw new Error(`message too large: ${len} (max ${MAX_MSG})`);
  if (len === 0) throw new Error('empty message (length 0)');
  const body = await readExact(stdin, len);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch (e) {
    throw new Error(`invalid JSON: ${e.message}`);
  }
}

export function writeMessage(stdout, msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(body.length, 0);
  stdout.write(lenBuf);
  stdout.write(body);
}
