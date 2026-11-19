import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const skill = read('../skills/pressure-interview/SKILL.md');
const readme = read('../README.md');

test('SKILL.md의 frontmatter', () => {
  assert.equal(skill.split('\n')[0], '---');
  assert.match(skill, /^name: pressure-interview$/m);
  assert.match(skill, /^disable-model-invocation: true$/m);
});

test('지킬 것이 앞 3,000자 안에 있다', () => {
  const head = skill.slice(0, 3000);
  for (const word of ['hidden', '그대로', 'answerFile', 'next', 'resume']) assert.ok(head.includes(word), word);
});

test('명령표가 cli의 명령과 맞는다', () => {
  for (const cmd of ['start --topic', 'resume', 'finish', 'review', 'mark', 'surprise', 'stats', 'setup --data-dir']) {
    assert.ok(skill.includes(cmd), cmd);
  }
});

test('README가 밝힐 것을 밝힌다', () => {
  for (const word of ['35', '구독', 'hidden', 'claude', 'Node', 'answers', '권한']) assert.ok(readme.includes(word), word);
});

const globAll = (dir, ext) =>
  fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

test('옮겨 온 파일은 손으로 고치는 파일이라고 밝힌다', () => {
  const files = globAll('plugin/skills/pressure-interview/scripts/lib/app', '.mjs')
    .concat(globAll('plugin/test/app', '.mjs'));
  assert.ok(files.length > 20);
  for (const f of files) {
    const first = fs.readFileSync(f, 'utf8').split(/\r?\n/)[0];
    assert.doesNotMatch(first, /생성된 파일이다/, f);
    assert.match(first, /^\/\/ (서버판 src\/.+ @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다\.|스킬이 만든 파일이다\.)$/, f);
  }
});
test('README들이 옮기는 도구를 말하지 않는다', () => {
  for (const f of ['README.md', 'plugin/README.md']) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /port-app-src/, f);
  }
});
