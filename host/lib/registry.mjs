// 全局命令注册表。CLI 和 native host 两条 transport 都从这里 dispatch,
// 同一个 handler 函数服务两个入口 —— 注册一次,两路都通。
//
// handler 函数签名：
//   function(req) → { status: 'ok', data?, message? }
//                  | { status: 'error', message }
// 抛异常等价于返回 { status: 'error', message: e.message }。

class RegistryClass {
  constructor() {
    this.handlers = new Map();
    this._frozen = false;  // 第一次 handle 时冻结,防止延迟 import 导致重复注册
  }

  register(name, handler) {
    if (this._frozen) {
      throw new Error(`registry 已冻结,无法注册 '${name}'(所有命令应在 handle() 前 import)`);
    }
    if (this.handlers.has(name)) {
      throw new Error(`重复注册命令: '${name}'`);
    }
    if (typeof handler !== 'function') {
      throw new Error(`handler 必须是函数: '${name}'`);
    }
    this.handlers.set(name, handler);
  }

  has(name) {
    return this.handlers.has(name);
  }

  list() {
    return [...this.handlers.keys()];
  }

  // 冻结防止后续 import 干扰。调用一次即可。
  freeze() {
    this._frozen = true;
  }

  // 异步 handler(async function)也要支持,await。
  async handle(name, req) {
    this._frozen = true;  // 第一次 handle 时也冻结
    const h = this.handlers.get(name);
    if (!h) {
      return {
        status: 'error',
        message: `未知命令: '${name}'。运行 'tabboard help' 查看可用命令。`,
        available: this.list(),
      };
    }
    try {
      const result = await h(req ?? {});
      // 容忍 handler 返回 undefined / null,统一为 ok
      if (result === undefined || result === null) return { status: 'ok' };
      if (typeof result !== 'object') {
        return { status: 'error', message: `handler 返回非对象: ${typeof result}` };
      }
      if (result.status !== 'ok' && result.status !== 'error') {
        return { status: 'error', message: `handler 缺少 status 字段: '${name}'` };
      }
      return result;
    } catch (e) {
      return { status: 'error', message: e?.message ?? String(e) };
    }
  }
}

export const Registry = new RegistryClass();
