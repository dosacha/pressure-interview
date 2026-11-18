// 테스트용 가짜 claude. claudeCommand를 [node, 이 파일]로 두면 돈다. PI_FAKE_DIR의 폴더를 쓴다.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.PI_FAKE_DIR;
const args = process.argv.slice(2);
const log = (entry) => fs.appendFileSync(path.join(dir, 'calls.jsonl'), `${JSON.stringify(entry)}\n`);
const valueOf = (flag) => args[args.indexOf(flag) + 1];

// helpers.mjs의 fakeLlm과 같은 규칙이다. 먼저 맞는 것이 종류다.
const KINDS = [
  ['reply', 'clarify'], ['role', 'jobRole'], ['keyPoints', 'answerKey'], ['corrections', 'verify'],
  ['premiseOk', 'premise'], ['techs', 'leak'], ['keyProblems', 'review'],
  ['questionIntent', 'question'], ['mentionedTechs', 'analyze'],
];

if (args.includes('auth')) {
  log({ kind: 'auth' });
  const file = path.join(dir, 'auth.json');
  process.stdout.write(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{"loggedIn":true,"authMethod":"claude.ai"}');
  process.exit(0);
}

const user = fs.readFileSync(0, 'utf8');
const required = JSON.parse(valueOf('--json-schema')).required ?? [];
const kind = KINDS.find(([field]) => required.includes(field))?.[1] ?? 'unknown';
log({
  kind, args, system: valueOf('--system-prompt'), user,
  envNames: Object.keys(process.env).filter((n) => /^(CLAUDE|ANTHROPIC)/.test(n)),
});

// 이름이 가장 앞선 *.json을 *.used로 바꿔 차지한다. 이름 바꾸기가 실패하면 다음 파일을 본다.
let claimed = null;
const kindDir = path.join(dir, kind);
const names = fs.existsSync(kindDir) ? fs.readdirSync(kindDir).filter((n) => n.endsWith('.json')).sort() : [];
for (const name of names) {
  const used = path.join(kindDir, name.replace(/\.json$/, '.used'));
  try {
    fs.renameSync(path.join(kindDir, name), used);
    claimed = JSON.parse(fs.readFileSync(used, 'utf8'));
    break;
  } catch {
    // 다른 호출이 먼저 차지했다
  }
}
if (!claimed) {
  process.stderr.write(`가짜 응답이 없다: ${kind}\n`);
  process.exit(3);
}

if (claimed.hang) {
  fs.writeFileSync(path.join(dir, 'hang.pid'), String(process.pid)); // 테스트가 죽었는지 확인한다
  setInterval(() => {}, 1000);
} else if ('raw' in claimed) {
  if (claimed.stderr) process.stderr.write(claimed.stderr);
  process.stdout.write(claimed.raw, () => process.exit(claimed.exit ?? 0));
} else {
  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      type: 'result', is_error: false, stop_reason: 'end_turn', structured_output: claimed.data,
      usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 },
      modelUsage: { 'fake-model': {} }, duration_ms: 5,
    }));
  }, claimed.delayMs ?? 0);
}
