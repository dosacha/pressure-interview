// 앱(aeae0dd)의 순수 모듈과 테스트를 타입만 걷어 내 .mjs로 옮긴다. 모델 호출 없음.
// 실행(저장소 뿌리에서): node --no-warnings tools/port-app-src.mjs [--check]
// 생성물의 글자를 고치는 처리는 없다. 타입만 걷어 내고 import만 새 자리에 맞춘다(PATCHES 제외).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const check = process.argv.includes('--check');
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
  'src/interview/turn.service.spec.ts',
];

// 손으로 옮긴 모듈: 원본 경로 → { path: 저장소 뿌리 기준 새 경로, exports: 내보내는 이름 목록 }
const EXTERNAL = {
  'src/interview/turn.service.ts': { path: 'plugin/skills/pressure-interview/scripts/lib/turn.service.mjs', exports: ['TurnService'] },
};
// 타입을 걷어 내기 전 원본 글자 바꾸기: 원본 경로 → [[찾을 문자열, 바꿀 문자열], ...]. 찾는 글자가 없으면 오류.
const PATCHES = {
  'src/interview/turn.service.spec.ts': [
    [`async function service(queues: Record<string, unknown[]>) {
  const fake = fakeLlm(queues);
  const mod = await Test.createTestingModule({
    providers: [
      TurnService,
      { provide: LlmService, useValue: fake.llm },
      { provide: engineConfig.KEY, useValue: readEngineConfig({}) },
    ],
  }).compile();
  return { turn: mod.get(TurnService), calls: fake.calls };
}`,
      `async function service(queues: Record<string, unknown[]>) {
  const fake = fakeLlm(queues);
  return { turn: new TurnService(fake.llm as never, { maxConsecutive: 2, maxRegenerations: 1 }), calls: fake.calls };
}`],
  ],
};

const posix = path.posix;
const show = (p) => execFileSync('git', ['show', `${REF}:${p}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
const header = (s) => `// 생성된 파일이다. 손으로 고치지 않는다. 원본: ${s} @ ${REF}, 도구: tools/port-app-src.mjs\n`;
const patched = (s) => {
  let text = show(s);
  for (const [from, to] of PATCHES[s] ?? []) {
    if (!text.includes(from)) throw new Error(`PATCHES: ${s}에서 찾을 문자열이 없다: ${from}`);
    text = text.replace(from, () => to);
  }
  return text;
};
const libPath = (src) => `${LIB_ROOT}/${src.replace(/^src\//, '').replace(/\.ts$/, '.mjs')}`;
const testPath = (src) => `${TEST_ROOT}/${src.replace(/^src\//, '').replace(/\.spec\.ts$/, '.test.mjs')}`;
const rel = (fromFile, toFile) => {
  const r = posix.relative(posix.dirname(fromFile), toFile);
  return r.startsWith('.') ? r : `./${r}`;
};
const exportsOf = (js) => new Set([...js.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]));

// 1) 소스: 타입만 걷어 낸다. import는 뒤에서 고친다.
const stripped = new Map(SOURCES.map((s) => [s, stripTypeScriptTypes(patched(s), { mode: 'strip' })]));
const exported = new Map([...stripped].map(([s, js]) => [s, exportsOf(js)]));

// import 문 하나를 새 자리에 맞게 고친다. 옮기지 않는 모듈(타입, 엔티티 등)의 import와 타입이었던 이름은 뺀다.
function fixImports(js, srcFile, outFile) {
  return js.replace(/import\s+\{([^}]*)\}\s+from\s+'(\.[^']*)';?/g, (whole, names, spec) => {
    const target = `${posix.join(posix.dirname(srcFile), spec)}.ts`;
    const ext = EXTERNAL[target];
    if (!ext && !stripped.has(target)) return '';
    const have = ext ? new Set(ext.exports) : exported.get(target);
    const kept = names
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n && have.has(n.split(/\s+as\s+/)[0]));
    return kept.length ? `import { ${kept.join(', ')} } from '${rel(outFile, ext ? ext.path : libPath(target))}';` : '';
  });
}

const written = [];
for (const [s, js] of stripped) {
  const out = libPath(s);
  written.push([out, header(s) + fixImports(js, s, out)]);
}
// 2) 테스트: 같은 방식에 jest 대용 한 줄을 앞에 붙인다. 상대 경로가 아닌 import('@nestjs/testing' 등)는 지운다.
for (const s of SPECS) {
  const out = testPath(s);
  const js = fixImports(stripTypeScriptTypes(patched(s), { mode: 'strip' }), s, out).replace(/^import\s[^;]*?from\s+'[^.'][^']*';?\r?\n/gm, '');
  written.push([out, `${header(s)}import { describe, it, expect, jest } from '${rel(out, SHIM)}';\n${js}`]);
}
const differing = [];
for (const [file, text] of written) {
  if (check) {
    const now = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (now !== text) differing.push(file);
    continue;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
if (check) {
  if (differing.length) console.log(differing.join('\n'));
  process.exit(differing.length ? 1 : 0);
}
console.log(`wrote ${written.length} files`);
