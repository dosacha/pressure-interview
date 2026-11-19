// 흘림 검사가 "지원자가 말한 기술"(role: user)로 판정한 이름은 목록과 글자가 달라도 위반이 아니다.
// 2026-11-19 실제 한 판: 주제 "PostgreSQL와 Redis 차이"에서 PostgreSQL·Redis가 해답 흘림으로 헛걸렸다(docs/skill-review.md 9.13).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TurnService } from '../skills/pressure-interview/scripts/lib/turn.service.mjs';

function service(queues) {
  const calls = [];
  const llm = {
    callJson: async (req) => {
      calls.push(req);
      return { data: queues[req.kind].shift(), usage: { input_tokens: 1, output_tokens: 1 }, model: 'm' };
    },
  };
  return { turn: new TurnService(llm, { maxConsecutive: 2, maxRegenerations: 1 }), calls };
}

const draft = (text, axis = 'none') => ({ text, questionIntent: 'A1', assumption: { axis, statement: axis === 'none' ? '' : 's' } });
const base = {
  topic: 'PostgreSQL와 Redis 차이',
  interviewer: { id: 'p3', role: 'scenario', temperament: 'helper' },
  reactionIntent: null,
  defect: null,
  targetAxis: null,
  history: [],
  userMentioned: ['PostgreSQL와 Redis 차이', '레디스'],
  feedback: [],
  avoidTechs: [],
};

test('주제 문장에만 있는 기술을 흘림 검사가 user로 판정하면 다시 만들지 않는다', async () => {
  const { turn, calls } = service({
    question: [draft('PostgreSQL과 Redis는 각각 어디서 먼저 한계에 부딪힐까요?')],
    leak: [{ techs: [{ name: 'PostgreSQL', role: 'user' }, { name: 'Redis', role: 'user' }] }],
  });
  const r = await turn.prepareDraft(base);
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].naming.ok, true);
  assert.equal(r.flags.leak, false);
  assert.equal(calls.length, 2);
});

test('user로 판정돼도 모른다고 한 기술이면 위반이다', async () => {
  const { turn } = service({
    question: [draft('Memcached라면요?'), draft('다른 조건이라면요?')],
    leak: [{ techs: [{ name: 'Memcached', role: 'user' }] }, { techs: [] }],
  });
  const r = await turn.prepareDraft({ ...base, avoidTechs: ['Memcached'] });
  assert.deepEqual(r.attempts[0].naming, { ok: false, violations: ['Memcached'], avoided: ['Memcached'] });
  assert.equal(r.attempts.length, 2);
});

test('말하지 않은 해답 기술(solution)은 그대로 위반이다', async () => {
  const { turn } = service({
    question: [draft('Kafka는요?'), draft('다른 대안은요?')],
    leak: [{ techs: [{ name: 'Kafka', role: 'solution' }, { name: 'Redis', role: 'user' }] }, { techs: [] }],
  });
  const r = await turn.prepareDraft(base);
  assert.deepEqual(r.attempts[0].naming, { ok: false, violations: ['Kafka'], avoided: [] });
});

test('되묻기 응답에서도 user로 판정한 이름은 위반이 아니다', async () => {
  const { turn, calls } = service({
    clarify: [{ reply: 'PostgreSQL 쪽만 놓고 답해 주시면 됩니다.' }],
    leak: [{ techs: [{ name: 'PostgreSQL', role: 'user' }] }],
  });
  const r = await turn.replyToClarification({
    topic: base.topic,
    interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
    question: draft('Q'),
    questionTechs: [],
    exchanges: [],
    ask: 'PostgreSQL만 말하면 되나요?',
    userMentioned: base.userMentioned,
    avoidTechs: [],
  });
  assert.equal(r.leak, false);
  assert.equal(calls.length, 2);
});
