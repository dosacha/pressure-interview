import { InputError, type InputIssue } from '../http/input-error';
import { parseTurnPatch } from './review-input';

function issuesOf(fn: () => unknown): InputIssue[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof InputError) return e.issues;
    throw e;
  }
  throw new Error('InputError가 나지 않았다');
}

describe('복기 입력 검증', () => {
  it('둘 중 하나 이상을 받는다', () => {
    expect(parseTurnPatch({ surprise: 'expected' })).toEqual({ surprise: 'expected' });
    expect(parseTurnPatch({ assumptionResult: 'wrong' })).toEqual({ assumptionResult: 'wrong' });
    expect(parseTurnPatch({ surprise: 'unexpected', assumptionResult: 'well' })).toEqual({
      surprise: 'unexpected',
      assumptionResult: 'well',
    });
  });

  it('둘 다 없으면 REQUIRED', () => {
    expect(issuesOf(() => parseTurnPatch({}))).toEqual([{ field: 'body', reason: 'REQUIRED' }]);
  });

  it('목록 밖 값은 NOT_ALLOWED', () => {
    expect(issuesOf(() => parseTurnPatch({ surprise: 'maybe' }))).toEqual([
      { field: 'surprise', reason: 'NOT_ALLOWED' },
    ]);
    expect(issuesOf(() => parseTurnPatch({ assumptionResult: 'none' }))).toEqual([
      { field: 'assumptionResult', reason: 'NOT_ALLOWED' },
    ]);
    expect(issuesOf(() => parseTurnPatch({ surprise: null }))).toEqual([
      { field: 'surprise', reason: 'NOT_ALLOWED' },
    ]);
  });

  it('모르는 필드는 UNEXPECTED_FIELD, 객체가 아니면 MUST_BE_OBJECT', () => {
    expect(issuesOf(() => parseTurnPatch({ surprise: 'expected', x: 1 }))).toEqual([
      { field: 'x', reason: 'UNEXPECTED_FIELD' },
    ]);
    for (const body of [null, 'x', [], undefined])
      expect(issuesOf(() => parseTurnPatch(body))).toEqual([
        { field: 'body', reason: 'MUST_BE_OBJECT' },
      ]);
  });
});
