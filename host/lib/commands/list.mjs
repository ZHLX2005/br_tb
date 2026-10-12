// list:列数据湖内容。
// 参数:
//   --kind <name>   只列某个 kind
//   --limit <n>     最多返回条数(默认 50)
//   --since <ms>    只返回 _ts >= since 的
import { Registry } from '../registry.mjs';
import { readJsonl, listKinds, kindStats, LAKE_DIR } from '../lake.mjs';

async function List(req) {
  const kind = typeof req.kind === 'string' ? req.kind : null;
  const limit = typeof req.limit === 'number' ? req.limit : 50;
  const sinceMs = typeof req.since === 'number' ? req.since : undefined;

  // 没指定 kind:列所有 kind 的元信息
  if (!kind) {
    const kinds = await listKinds();
    const stats = await kindStats();
    return {
      status: 'ok',
      data: {
        lakeDir: LAKE_DIR,
        kinds: kinds.map(k => ({ kind: k, ...stats[k] })),
      },
    };
  }

  // 指定 kind:读 records
  const records = await readJsonl(kind, { limit, sinceMs });
  return {
    status: 'ok',
    data: {
      lakeDir: LAKE_DIR,
      kind,
      count: records.length,
      records,
    },
  };
}

Registry.register('list', List);
