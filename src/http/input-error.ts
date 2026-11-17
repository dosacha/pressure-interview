export interface InputIssue {
  field: string;
  reason:
    | 'REQUIRED'
    | 'MUST_BE_OBJECT'
    | 'MUST_BE_STRING'
    | 'MUST_BE_INTEGER'
    | 'OUT_OF_RANGE'
    | 'TOO_LONG'
    | 'EMPTY'
    | 'UNEXPECTED_FIELD'
    | 'MUST_BE_UUID'
    | 'NOT_ALLOWED'; // 복기(뒤 태스크)가 쓴다.
}

export class InputError extends Error {
  override readonly name = 'InputError';
  constructor(readonly issues: InputIssue[]) {
    super('INVALID_INPUT');
  }
}
