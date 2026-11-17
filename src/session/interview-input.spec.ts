import { InputError, type InputIssue } from '../http/input-error';
import { parseAnswerInput, parseId, parseStartInput } from './interview-input';

const uuid = '3f0c2a52-6f0e-4a3b-9d55-0a1b2c3d4e5f';

function issuesOf(fn: () => unknown): InputIssue[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof InputError) return e.issues;
    throw e;
  }
  throw new Error('InputError가 나지 않았다');
}

describe('면접 입력 검증', () => {
  it('공백만 있는 답은 EMPTY', () => {
    expect(
      issuesOf(() => parseAnswerInput({ turnId: uuid, text: '   ', answerStartMs: null })),
    ).toEqual([{ field: 'text', reason: 'EMPTY' }]);
  });

  it('2만 자를 넘는 답은 TOO_LONG', () => {
    expect(
      issuesOf(() => parseAnswerInput({ turnId: uuid, text: 'a'.repeat(20001), answerStartMs: 0 })),
    ).toEqual([{ field: 'text', reason: 'TOO_LONG' }]);
    expect(
      parseAnswerInput({ turnId: uuid, text: 'a'.repeat(20000), answerStartMs: 0 }).text,
    ).toHaveLength(20000);
  });

  it('answerStartMs가 음수나 소수면 거절, 없으면 null', () => {
    const base = { turnId: uuid, text: '답' };
    expect(issuesOf(() => parseAnswerInput({ ...base, answerStartMs: -1 }))).toEqual([
      { field: 'answerStartMs', reason: 'OUT_OF_RANGE' },
    ]);
    expect(issuesOf(() => parseAnswerInput({ ...base, answerStartMs: 1.5 }))).toEqual([
      { field: 'answerStartMs', reason: 'MUST_BE_INTEGER' },
    ]);
    expect(parseAnswerInput(base).answerStartMs).toBeNull();
    expect(parseAnswerInput({ ...base, answerStartMs: 0 }).answerStartMs).toBe(0);
  });

  it('turnId는 uuid여야 하고 답은 앞뒤 공백을 뗀다', () => {
    expect(issuesOf(() => parseAnswerInput({ turnId: 'x', text: '답' }))).toEqual([
      { field: 'turnId', reason: 'MUST_BE_UUID' },
    ]);
    expect(issuesOf(() => parseAnswerInput({ text: '답' }))).toEqual([
      { field: 'turnId', reason: 'REQUIRED' },
    ]);
    expect(parseAnswerInput({ turnId: uuid, text: ' 답 ' }).text).toBe('답');
  });

  it('모르는 필드는 UNEXPECTED_FIELD', () => {
    expect(issuesOf(() => parseStartInput({ topic: 'Redis', role: 'dba' }))).toEqual([
      { field: 'role', reason: 'UNEXPECTED_FIELD' },
    ]);
  });

  it('주제는 앞뒤 공백을 떼고 200자까지', () => {
    expect(parseStartInput({ topic: '  Redis ' })).toEqual({ topic: 'Redis' });
    expect(parseStartInput({ topic: 'a'.repeat(200) }).topic).toHaveLength(200);
    expect(issuesOf(() => parseStartInput({ topic: 'a'.repeat(201) }))).toEqual([
      { field: 'topic', reason: 'TOO_LONG' },
    ]);
    expect(issuesOf(() => parseStartInput({ topic: ' ' }))).toEqual([
      { field: 'topic', reason: 'EMPTY' },
    ]);
    expect(issuesOf(() => parseStartInput({}))).toEqual([{ field: 'topic', reason: 'REQUIRED' }]);
    expect(issuesOf(() => parseStartInput({ topic: 5 }))).toEqual([
      { field: 'topic', reason: 'MUST_BE_STRING' },
    ]);
  });

  it('질문 수는 2~30의 정수', () => {
    expect(parseStartInput({ topic: 'a', questionLimit: 2 }).questionLimit).toBe(2);
    expect(parseStartInput({ topic: 'a', questionLimit: 30 }).questionLimit).toBe(30);
    for (const n of [1, 31]) {
      expect(issuesOf(() => parseStartInput({ topic: 'a', questionLimit: n }))).toEqual([
        { field: 'questionLimit', reason: 'OUT_OF_RANGE' },
      ]);
    }
    expect(issuesOf(() => parseStartInput({ topic: 'a', questionLimit: 2.5 }))).toEqual([
      { field: 'questionLimit', reason: 'MUST_BE_INTEGER' },
    ]);
  });

  it('본문이 객체가 아니면 MUST_BE_OBJECT', () => {
    for (const body of [null, 'x', [], undefined]) {
      expect(issuesOf(() => parseStartInput(body))).toEqual([
        { field: 'body', reason: 'MUST_BE_OBJECT' },
      ]);
      expect(issuesOf(() => parseAnswerInput(body))).toEqual([
        { field: 'body', reason: 'MUST_BE_OBJECT' },
      ]);
    }
  });

  it('오류를 모아서 알려 준다', () => {
    expect(issuesOf(() => parseStartInput({ topic: '', questionLimit: 99, x: 1 }))).toEqual([
      { field: 'topic', reason: 'EMPTY' },
      { field: 'questionLimit', reason: 'OUT_OF_RANGE' },
      { field: 'x', reason: 'UNEXPECTED_FIELD' },
    ]);
  });

  it('parseId는 uuid가 아니면 InputError', () => {
    expect(parseId(uuid, 'id')).toBe(uuid);
    expect(issuesOf(() => parseId('abc', 'id'))).toEqual([{ field: 'id', reason: 'MUST_BE_UUID' }]);
  });
});
