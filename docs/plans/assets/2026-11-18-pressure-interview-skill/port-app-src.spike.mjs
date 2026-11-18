// 계획 Task 1의 출발점. 2026-11-18에 이 파일로 앱의 소스 16개와 테스트 13개를 옮겨 테스트 118개가 통과했다. 모델 호출 없음.
// 실행: node --no-warnings port-app-src.spike.mjs <저장소 폴더> <출력 폴더>
// 생성물의 글자를 고치는 처리는 없다. 타입만 걷어 내고 import만 새 자리에 맞춘다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const [repo, outRoot] = process.argv.slice(2);
const REF = 'aeae0dd';
const LIB_ROOT = 'plugin/skills/pressure-interview/scripts/lib/app';
const TEST_ROOT = 'plugin/test/app';
const SHIM = 'plugin/test/jest-shim.mjs';

const SOURCES = [
  'src/interview/catalog.ts',
  'src/interview/naming.ts',
  'src/interview/rules.ts',
  'src/interview/calls/analyze.call.ts',
  'src/interview/calls/answer-key.call.ts',
  'src/interview/calls/clarify.call.ts',
  'src/interview/calls/job-role.call.ts',
  'src/interview/calls/leak.call.ts',
  'src/interview/calls/premise.call.ts',
  'src/interview/calls/question.call.ts',
  'src/interview/calls/review.call.ts',
  'src/interview/calls/verify.call.ts',
  'src/session/session-rules.ts',
  'src/memory/memory-rules.ts',
  'src/review/stats.ts',
  'src/review/review.view.ts',
];
const SPECS = [
  'src/interview/catalog.spec.ts',
  'src/interview/naming.spec.ts',
  'src/interview/rules.spec.ts',
  'src/interview/calls/answer-key.call.spec.ts',
  'src/interview/calls/calls.spec.ts',
  'src/interview/calls/clarify.call.spec.ts',
  'src/interview/calls/job-role.call.spec.ts',
  'src/interview/calls/premise.call.spec.ts',
  'src/interview/calls/question.call.spec.ts',
  'src/interview/calls/review.call.spec.ts',
  'src/session/session-rules.spec.ts',
  'src/memory/memory-rules.spec.ts',
  'src/review/stats.spec.ts',
];

const posix = path.posix;
const show = (p) => execFileSync('git', ['show', `${REF}:${p}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
const libPath = (src) => `${LIB_ROOT}/${src.replace(/^src\//, '').replace(/\.ts$/, '.mjs')}`;
const testPath = (src) => `${TEST_ROOT}/${src.replace(/^src\//, '').replace(/\.spec\.ts$/, '.test.mjs')}`;
const rel = (fromFile, toFile) => {
  const r = posix.relative(posix.dirname(fromFile), toFile);
  return r.startsWith('.') ? r : `./${r}`;
};
const exportsOf = (js) => new Set([...js.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]));

// 1) 소스: 타입만 걷어 낸다. import는 뒤에서 고친다.
const stripped = new Map(SOURCES.map((s) => [s, stripTypeScriptTypes(show(s), { mode: 'strip' })]));
const exported = new Map([...stripped].map(([s, js]) => [s, exportsOf(js)]));

// import 문 하나를 새 자리에 맞게 고친다. 옮기지 않는 모듈(타입, 엔티티 등)의 import와 타입이었던 이름은 뺀다.
function fixImports(js, srcFile, outFile) {
  return js.replace(/import\s+\{([^}]*)\}\s+from\s+'(\.[^']*)';?/g, (whole, names, spec) => {
    const target = `${posix.join(posix.dirname(srcFile), spec)}.ts`;
    if (!stripped.has(target)) return '';
    const kept = names
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n && exported.get(target).has(n.split(/\s+as\s+/)[0]));
    return kept.length ? `import { ${kept.join(', ')} } from '${rel(outFile, libPath(target))}';` : '';
  });
}

const written = [];
for (const [s, js] of stripped) {
  const out = libPath(s);
  written.push([out, fixImports(js, s, out)]);
}
// 2) 테스트: 같은 방식에 jest 대용 한 줄을 앞에 붙인다.
for (const s of SPECS) {
  const out = testPath(s);
  const js = fixImports(stripTypeScriptTypes(show(s), { mode: 'strip' }), s, out);
  written.push([out, `import { describe, it, expect, jest } from '${rel(out, SHIM)}';\n${js}`]);
}
for (const [file, text] of written) {
  const abs = path.join(outRoot, file);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}
console.log(`wrote ${written.length} files`);
