// backup:写 records 到数据湖。
// 入参:
//   - records: [{ kind, data }, ...]  (Chrome 端发)
//   - file: <path>                     (CLI 端从 JSON 文件读,文件内容同 records 数组)
// 副作用:写 state/last_backup.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Registry } from '../registry.mjs';
import { appendRecords, TABBOARD_DIR, STATE_DIR } from '../lake.mjs';

async function Backup(req) {
  let records;
  if (Array.isArray(req.records)) {
    records = req.records;
  } else if (req.file) {
    const raw = await readFile(req.file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { status: 'error', message: `--file 内容必须是 records 数组,收到: ${typeof parsed}` };
    }
    records = parsed;
  } else {
    return { status: 'error', message: '缺少 records 或 --file 参数' };
  }

  const wrote = await appendRecords(records);

  // 写元信息
  await mkdir(STATE_DIR, { recursive: true });
  const state = {
    ts: new Date().toISOString(),
    wrote,
    kinds: [...new Set(records.map(r => r.kind))],
  };
  await writeFile(join(STATE_DIR, 'last_backup.json'), JSON.stringify(state, null, 2), 'utf8');

  return {
    status: 'ok',
    data: { wrote, kinds: state.kinds, ts: state.ts, lakeDir: TABBOARD_DIR },
  };
}

Registry.register('backup', Backup);
