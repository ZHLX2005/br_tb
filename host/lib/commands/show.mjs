// show:按 id 查单条。
// 参数:positionals[0] = kind, positionals[1] = id
import { Registry } from '../registry.mjs';
import { findRecord } from '../lake.mjs';

async function Show(req) {
  const [kind, id] = req.positionals ?? [];
  if (!kind || !id) {
    return { status: 'error', message: '用法: tabboard show <kind> <id>' };
  }
  const record = await findRecord(kind, id);
  if (!record) {
    return { status: 'error', message: `${kind} 中找不到 id=${id}` };
  }
  return { status: 'ok', data: { kind, record } };
}

Registry.register('show', Show);
