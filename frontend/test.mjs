import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = dirname(fileURLToPath(import.meta.url));
const root = dirname(frontend);
const output = join(frontend, '.test');
rmSync(output, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(frontend, 'tsconfig.test.json')],
  { stdio: 'inherit' },
);
// 화면 쪽 순수 로직(web/lib)의 테스트만 돌린다.
const folder = join(output, 'web', 'lib');
const tests = readdirSync(folder)
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => join(folder, file));
if (tests.length === 0) throw new Error('No frontend tests found');
execFileSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
