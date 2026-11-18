// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/memory/memory-rules.spec.ts @ aeae0dd, 도구: tools/port-app-src.mjs
import { describe, it, expect, jest } from '../../jest-shim.mjs';
                                                           
                                                                   
import { foldAssumptions, pendingTopics, selectMemory } from '../../../skills/pressure-interview/scripts/lib/app/memory/memory-rules.mjs';

                                                              

const stmt = (id        ) => `가정-${id}`;
const answeredAt = (id        ) =>
  new Date(Date.UTC(2026, 10, 1, 0, Number(id.slice(1)))).toISOString();

function turn(
  id        ,
  seq        ,
  result                           ,
  sameAs               ,
  over                                                                            = {},
)           {
  return {
    id,
    seq,
    question: {
      text: 'Q',
      questionIntent: 'A1',
      assumption: { axis: over.axis ?? 'scale', statement: stmt(id) },
      answerKey: null,
    },
    review:
      over.review === null
        ? null
        : {
            intent: { aimed: true, note: '' },
            defects: [],
            reactions: [],
            assumption: { result, note: '', sameAs, userResult: over.userResult },
            keyProblems: [],
          },
    surprise: 'unexpected',
    answeredAt: new Date(answeredAt(id)),
  };
}

const now = new Date('2026-11-17T12:00:00.000Z');
const hoursAgo = (h        ) => new Date(now.getTime() - h * 3600_000);
let n = 0;
function rec(
  status                  ,
  lastSeenAt      ,
  over                                                                  = {},
)                   {
  n += 1;
  return {
    id: `r${n}`,
    axis: 'scale',
    statement: `기록-${n}`,
    status,
    encounters: [
      {
        sessionId: 's',
        turnId: `t${n}`,
        topic: over.topic ?? 'Redis',
        result: status,
        surprise: over.surprise === undefined ? 'unexpected' : over.surprise,
        at: lastSeenAt.toISOString(),
      },
    ],
    lastSeenAt,
    createdAt: lastSeenAt,
  };
}

describe('foldAssumptions', () => {
  it('같은 가정을 다시 물은 턴은 한 묶음이고 마지막 결과를 쓴다', () => {
    const out = foldAssumptions(
      [turn('t1', 1, 'wobbly', null), turn('t2', 2, 'well', 'turn:t1')],
      [],
    );
    expect(out).toEqual([
      expect.objectContaining({
        recordId: null,
        result: 'well',
        turnIds: ['t1', 't2'],
        statement: stmt('t1'),
        at: answeredAt('t2'),
      }),
    ]);
  });
  it('사용자가 고친 결과가 있으면 그것을 쓴다', () => {
    const out = foldAssumptions([turn('t1', 1, 'well', null, { userResult: 'wrong' })], []);
    expect(out).toEqual([expect.objectContaining({ result: 'wrong', turnIds: ['t1'] })]);
  });
  it('기억의 id를 가리키면 그 기록의 묶음이다', () => {
    const out = foldAssumptions([turn('t1', 1, 'well', 'r1')], ['r1']);
    expect(out).toEqual([expect.objectContaining({ recordId: 'r1', turnIds: ['t1'] })]);
  });
  it('없는 기록 id를 가리키면 새 묶음이다', () => {
    const out = foldAssumptions([turn('t1', 1, 'well', 'r9')], []);
    expect(out).toEqual([expect.objectContaining({ recordId: null, turnIds: ['t1'] })]);
  });
  it('자기보다 뒤 턴을 가리키면 새 묶음이다', () => {
    const out = foldAssumptions(
      [turn('t1', 1, 'wobbly', 'turn:t2'), turn('t2', 2, 'well', null)],
      [],
    );
    expect(out.map((f) => f.turnIds)).toEqual([['t1'], ['t2']]);
  });
  it('가정 없는 질문과 복기가 없는 턴은 뺀다', () => {
    const out = foldAssumptions(
      [
        turn('t1', 1, 'well', null, { axis: 'none' }),
        turn('t2', 2, 'well', null, { review: null }),
        turn('t3', 3, 'none', null),
      ],
      [],
    );
    expect(out).toEqual([]);
  });
  it('복기 결과가 none이어도 직접 고친 결과가 있으면 묶음에 넣고 그 결과를 쓴다', () => {
    const out = foldAssumptions([turn('t1', 1, 'none', null, { userResult: 'wrong' })], []);
    expect(out).toHaveLength(1);
    expect(out[0].result).toBe('wrong');
  });
});

describe('selectMemory', () => {
  it('잘 답한 가정은 retired, 하루 지난 흔들린 가정은 reissue', () => {
    const m = selectMemory(
      [rec('well', hoursAgo(1)), rec('wobbly', hoursAgo(25)), rec('wrong', hoursAgo(3))],
      now,
      24,
    );
    expect(m.retired).toHaveLength(1);
    expect(m.reissue).toHaveLength(1);
  });
  it('reissue는 예상 밖이었던 것이 앞에 온다', () => {
    const a = rec('wrong', hoursAgo(30), { surprise: 'expected' });
    const b = rec('wobbly', hoursAgo(40), { surprise: 'unexpected' });
    const m = selectMemory([a, b], now, 24);
    expect(m.reissue.map((r) => r.statement)).toEqual([b.statement, a.statement]);
  });
  it('예상했던 가정은 expected에 들고, reissue에 든 것은 빠진다', () => {
    const fresh = rec('wobbly', hoursAgo(2), { surprise: 'expected' });
    const old = rec('wobbly', hoursAgo(30), { surprise: 'expected' });
    const m = selectMemory([fresh, old], now, 24);
    expect(m.expected.map((r) => r.statement)).toEqual([fresh.statement]);
    expect(m.reissue.map((r) => r.statement)).toEqual([old.statement]);
  });
  it('상한: retired 30, reissue 5, expected 10', () => {
    const wells = Array.from({ length: 31 }, (_, i) => rec('well', hoursAgo(i + 1)));
    const shaky = Array.from({ length: 6 }, (_, i) => rec('wrong', hoursAgo(30 + i)));
    const expected = Array.from({ length: 11 }, (_, i) =>
      rec('wobbly', hoursAgo(i / 10), { surprise: 'expected' }),
    );
    const m = selectMemory([...wells, ...shaky, ...expected], now, 24);
    expect(m.retired).toHaveLength(30);
    expect(m.retired.map((r) => r.statement)).not.toContain(wells[30].statement);
    expect(m.reissue).toHaveLength(5);
    expect(m.expected).toHaveLength(10);
  });
  it('다시 낼 가정이 있는 주제만 돌려준다', () => {
    const records = [
      rec('wrong', hoursAgo(30), { topic: 'Kafka' }),
      rec('wobbly', hoursAgo(26), { topic: 'Kafka' }),
      rec('wobbly', hoursAgo(2), { topic: 'Redis' }),
      rec('well', hoursAgo(50), { topic: 'MySQL' }),
    ];
    expect(pendingTopics(records, now, 24)).toEqual(['Kafka']);
  });
});
