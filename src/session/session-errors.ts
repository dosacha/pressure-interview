import {
  MAX_TOKENS_MESSAGE,
  NO_TEXT_BLOCK_PREFIX,
  RefusalError,
} from '../interview/llm/llm.service';

/** 세션이나 턴이 없다. */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';
}

// 뒤의 둘은 Task 12가 쓴다.
export type ConflictCode =
  | 'TURN_NOT_OPEN'
  | 'INTERVIEW_FINISHED'
  | 'NOTHING_TO_RETRY'
  | 'INTERVIEW_NOT_FINISHED'
  | 'NOT_REVIEWABLE';

export class ConflictError extends Error {
  override readonly name = 'ConflictError';
  constructor(readonly code: ConflictCode) {
    super(code);
  }
}

export type UpstreamReason = 'REFUSAL' | 'MAX_TOKENS' | 'BAD_RESPONSE' | 'API_ERROR';

/** 메시지는 고정 문장이다. 원래 오류의 메시지(응답 글자가 들어갈 수 있다)는 싣지 않는다. */
export class UpstreamError extends Error {
  override readonly name = 'UpstreamError';
  constructor(
    readonly reason: UpstreamReason,
    readonly category: string | null,
  ) {
    super(`모델 호출 실패: ${reason}`);
  }
}

export function toUpstreamError(e: unknown): UpstreamError {
  if (e instanceof UpstreamError) return e;
  if (e instanceof RefusalError) return new UpstreamError('REFUSAL', e.category);
  if (e instanceof SyntaxError) return new UpstreamError('BAD_RESPONSE', null);
  if (e instanceof Error && e.message === MAX_TOKENS_MESSAGE)
    return new UpstreamError('MAX_TOKENS', null);
  if (e instanceof Error && e.message.startsWith(NO_TEXT_BLOCK_PREFIX))
    return new UpstreamError('BAD_RESPONSE', null);
  return new UpstreamError('API_ERROR', null);
}
