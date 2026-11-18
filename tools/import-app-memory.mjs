// 앱(PostgreSQL)의 assumption_records를 스킬의 memory.json으로 한 번 옮기는 개발자 도구. 스킬에 싣지 않는다.
// 실행: node tools/import-app-memory.mjs [--container pressure-interview-db] [--db interview] [--user interview]
// DB에는 select만 보낸다. 파일을 직접 실행했을 때만 Docker와 파일에 닿는다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../plugin/skills/pressure-interview/scripts/lib/config.mjs';
import { openStore } from '../plugin/skills/pressure-interview/scripts/lib/store.mjs';

const SELECT =
  "select coalesce(json_agg(r), '[]') from (select id, axis, statement, status, encounters, last_seen_at, created_at from assumption_records order by created_at, id) r";

export function toRecords(rows) {
  return rows.map((r) => ({
    id: r.id,
    axis: r.axis,
    statement: r.statement,
    status: r.status,
    encounters: r.encounters,
    lastSeenAt: new Date(r.last_seen_at),
    createdAt: new Date(r.created_at),
  }));
}

function option(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

function main(argv) {
  const config = loadConfig();
  if (!config?.dataDir || !fs.existsSync(config.dataDir)) {
    console.log('면접 폴더가 정해져 있지 않다. 스킬의 설정을 먼저 실행한 뒤 다시 하라.');
    return 1;
  }
  const store = openStore(config.dataDir);
  if (store.readMemory().length > 0) {
    console.log(`${path.join(config.dataDir, 'memory.json')}에 이미 기록이 있어 쓰지 않았다.`);
    return 1;
  }
  const out = execFileSync(
    'docker',
    [
      'exec',
      option(argv, 'container', 'pressure-interview-db'),
      'psql',
      '-U',
      option(argv, 'user', 'interview'),
      '-d',
      option(argv, 'db', 'interview'),
      '-At',
      '-c',
      SELECT,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const records = toRecords(JSON.parse(out));
  store.writeMemory(records);
  const byStatus = {};
  for (const r of records) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const parts = Object.entries(byStatus).map(([s, n]) => `${s} ${n}`);
  console.log(`기록 ${records.length}개를 옮겼다${parts.length ? ` (${parts.join(', ')})` : ''}.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
