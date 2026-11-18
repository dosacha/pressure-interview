import assert from 'node:assert/strict';
import test from 'node:test';

import { selectMemory } from '../skills/pressure-interview/scripts/lib/app/memory/memory-rules.mjs';
import { toRecords } from '../../tools/import-app-memory.mjs';

const enc = { sessionId: 's1', turnId: '01', topic: 'Redis', result: 'wobbly', surprise: null, at: '2026-11-01T00:00:00.000Z' };
const rows = [
  { id: 'a1', axis: 'consistency', statement: '가정 하나', status: 'wobbly', encounters: [enc], last_seen_at: '2026-11-01T00:00:00+00:00', created_at: '2026-10-30T12:30:00.123456+00:00' },
  { id: 'a2', axis: 'failure', statement: '가정 둘', status: 'well', encounters: [], last_seen_at: '2026-11-02T00:00:00+00:00', created_at: '2026-10-31T00:00:00+00:00' },
];

test('toRecords는 날짜를 Date로 바꾸고 encounters를 그대로 둔다', () => {
  const [r] = toRecords(rows);
  assert.ok(r.lastSeenAt instanceof Date && r.createdAt instanceof Date);
  assert.equal(r.lastSeenAt.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(r.createdAt.toISOString(), '2026-10-30T12:30:00.123Z');
  assert.deepEqual(r.encounters, [enc]);
  assert.deepEqual(Object.keys(r).sort(), ['axis', 'createdAt', 'encounters', 'id', 'lastSeenAt', 'statement', 'status']);
});

test('줄 둘은 기록 둘이 된다', () => {
  assert.equal(toRecords(rows).length, 2);
});

test('selectMemory가 변환한 기록을 받아 던지지 않는다', () => {
  assert.doesNotThrow(() => selectMemory(toRecords(rows), new Date('2026-11-18T00:00:00Z'), 24));
});
