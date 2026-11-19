// 스킬이 만든 파일이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOPIC_MAP_SCHEMA, buildTopicMapPrompt, generateTopicMap } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/topic-map.call.mjs';
import { OWNABLE_AXES } from '../../../../skills/pressure-interview/scripts/lib/app/interview/catalog.mjs';

const area = (id, core) => ({ id, name: id, core, why: '중요', axis: 'scale', angles: ['a'] });
const map = (cores) => ({ areas: ['a', 'b', 'c', 'd'].map((id, i) => area(id, i < cores)) });
const llmOf = (data) => ({ callJson: async () => ({ data, usage: { input_tokens: 1, output_tokens: 1 } }) });

test('주제 지도 프롬프트가 핵심 영역의 정의를 싣는다', () => {
  const { system, user } = buildTopicMapPrompt('Redis');
  assert.match(system, /이 주제를 실무에서 쓰는 사람이라면 반드시 알아야 할 것/);
  assert.match(system, /핵심 영역은 2개 이상 6개 이하/);
  assert.match(user, /Redis/);
});

test('스키마의 axis는 OWNABLE_AXES, 영역은 4~8개', () => {
  const { areas } = TOPIC_MAP_SCHEMA.properties;
  assert.deepEqual(areas.items.properties.axis.enum, OWNABLE_AXES);
  assert.equal(areas.minItems, 4);
  assert.equal(areas.maxItems, 8);
});

test('올바른 지도는 그대로 돌려준다', async () => {
  const data = map(2);
  assert.deepEqual((await generateTopicMap(llmOf(data), 'Redis')).data, data);
});

test('주제 지도의 핵심 영역이 1개면 schema_failed', async () => {
  await assert.rejects(generateTopicMap(llmOf(map(1)), 'Redis'), { code: 'schema_failed' });
});

test('핵심 영역이 7개여도 schema_failed', async () => {
  const data = { areas: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => area(id, i < 7)) };
  await assert.rejects(generateTopicMap(llmOf(data), 'Redis'), { code: 'schema_failed' });
});

test('영역 id가 겹치면 schema_failed', async () => {
  const data = map(2);
  data.areas[1].id = data.areas[0].id;
  await assert.rejects(generateTopicMap(llmOf(data), 'Redis'), { code: 'schema_failed' });
});
