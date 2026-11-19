// 스킬이 만든 파일이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { END_JUDGE_SCHEMA, buildEndJudgePrompt, judgeEnd } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/end-judge.call.mjs';
import { TurnService } from '../../../../skills/pressure-interview/scripts/lib/turn.service.mjs';
import { fakeLlm } from '../../../helpers.mjs';

const topicMap = {
  areas: [
    { id: 'persist', name: '영속성', core: true, why: '데이터를 잃지 않는 법', axis: 'durability', angles: ['a'] },
    { id: 'evict', name: '축출', core: false, why: '메모리 관리', axis: 'resource_limit', angles: ['b'] },
  ],
};
const ledger = [
  {
    no: 1, areaId: 'persist', openText: 'AOF와 RDB를 어떻게 고르나요?', followText: '전원이 나가면요?', followKind: 'defect',
    openScore: 'mostly', followScore: 'solid', score: 'solid',
    signals: [{ type: 'practical', quote: '저라면 AOF everysec을 씁니다', seq: 2 }],
    depthLimit: false, unknownPremise: false,
  },
];
const input = { topic: 'Redis', topicMap, ledger, unaskedAreaIds: ['evict'] };

test('판정 프롬프트가 네 판정과 기준을 싣는다', () => {
  const { system } = buildEndJudgePrompt(input);
  for (const s of ['enough', 'exhausted', 'settled', 'continue', '잘 앎', '바로 쓸 수 있음', '빨리 배움', '다음 질문 후보 셋', '80%', '절반']) {
    assert.ok(system.includes(s), s);
  }
  assert.match(system, /repeat: 이미 물은 가정의 되풀이다/);
  assert.match(system, /contrived: 이 기술을 실제로 쓰지 않는 상황을 꾸며야 나온다/);
  assert.match(system, /offTopic: 주제에서 벗어난 다른 기술의 지식을 시험하게 된다/);
});

test('판정 user 메시지에 답의 전문이 없고 점수와 인용은 있다', () => {
  const full = '답의전문표식ZZZ';
  const { user } = buildEndJudgePrompt({ ...input, ledger: [{ ...ledger[0], answer: full, openAnswer: full }] });
  assert.ok(!user.includes(full));
  assert.match(user, /solid/);
  assert.match(user, /저라면 AOF everysec을 씁니다/);
  assert.match(user, /아직 안 물은 영역: evict/);
});

test('스키마가 판정 넷과 후보 판정 넷을 가진다', () => {
  assert.deepEqual(END_JUDGE_SCHEMA.properties.decision.enum, ['continue', 'enough', 'exhausted', 'settled']);
  assert.deepEqual(END_JUDGE_SCHEMA.properties.candidates.items.properties.verdict.enum, ['repeat', 'contrived', 'offTopic', 'ok']);
});

test('judgeEnd는 스키마로 호출해 data를 돌려준다', async () => {
  const data = { decision: 'continue', evidence: { knows: [], applies: [], learns: [] }, candidates: [], nextArea: 'evict', direction: 'd', note: 'n' };
  const res = await judgeEnd({ callJson: async (r) => (r.schema === END_JUDGE_SCHEMA ? { data, usage: {} } : null) }, input);
  assert.equal(res.data.nextArea, 'evict');
});

test('TurnService.judgeEnd는 종류 endJudge로 부른다', async () => {
  const data = { decision: 'continue', evidence: { knows: [], applies: [], learns: [] }, candidates: [], nextArea: 'evict', direction: 'd', note: 'n' };
  const { llm, calls } = fakeLlm({ endJudge: [data] });
  const out = await new TurnService(llm, {}).judgeEnd(input);
  assert.equal(calls[0].kind, 'endJudge');
  assert.equal(out.judgment.nextArea, 'evict');
});

test('TurnService.pickTopicMap은 종류 topicMap으로 부른다', async () => {
  const areas = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, name: id, core: i < 2, why: 'w', axis: 'scale', angles: ['x'] }));
  const { llm, calls } = fakeLlm({ topicMap: [{ areas }] });
  const out = await new TurnService(llm, {}).pickTopicMap('Redis');
  assert.equal(calls[0].kind, 'topicMap');
  assert.equal(out.topicMap.areas.length, 4);
});
