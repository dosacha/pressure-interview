import { InputError, type InputIssue } from '../http/input-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, unknown>;

function asObject(body: unknown): Raw {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new InputError([{ field: 'body', reason: 'MUST_BE_OBJECT' }]);
  return body as Raw;
}

function unexpected(raw: Raw, allowed: string[], issues: InputIssue[]): void {
  for (const field of Object.keys(raw))
    if (!allowed.includes(field)) issues.push({ field, reason: 'UNEXPECTED_FIELD' });
}

function fail(issues: InputIssue[]): void {
  if (issues.length > 0) throw new InputError(issues);
}

// 앞뒤 공백을 뗀 문자열. 문제가 있으면 issues에 넣고 null을 돌려준다.
function text(raw: Raw, field: string, max: number, issues: InputIssue[]): string | null {
  const value = raw[field];
  if (value === undefined) issues.push({ field, reason: 'REQUIRED' });
  else if (typeof value !== 'string') issues.push({ field, reason: 'MUST_BE_STRING' });
  else {
    const trimmed = value.trim();
    if (trimmed.length === 0) issues.push({ field, reason: 'EMPTY' });
    else if (trimmed.length > max) issues.push({ field, reason: 'TOO_LONG' });
    else return trimmed;
  }
  return null;
}

function integer(
  value: unknown,
  field: string,
  min: number,
  max: number,
  issues: InputIssue[],
): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value))
    issues.push({ field, reason: 'MUST_BE_INTEGER' });
  else if (value < min || value > max) issues.push({ field, reason: 'OUT_OF_RANGE' });
  else return value;
  return null;
}

export function parseStartInput(body: unknown): { topic: string; questionLimit?: number } {
  const raw = asObject(body);
  const issues: InputIssue[] = [];
  const topic = text(raw, 'topic', 200, issues);
  const questionLimit =
    raw.questionLimit === undefined
      ? undefined
      : integer(raw.questionLimit, 'questionLimit', 2, 30, issues);
  unexpected(raw, ['topic', 'questionLimit'], issues);
  fail(issues);
  return questionLimit === undefined
    ? { topic: topic! }
    : { topic: topic!, questionLimit: questionLimit! };
}

export function parseAnswerInput(body: unknown): {
  turnId: string;
  text: string;
  answerStartMs: number | null;
} {
  const raw = asObject(body);
  const issues: InputIssue[] = [];
  let turnId: string | null = null;
  if (raw.turnId === undefined) issues.push({ field: 'turnId', reason: 'REQUIRED' });
  else if (typeof raw.turnId !== 'string' || !UUID.test(raw.turnId))
    issues.push({ field: 'turnId', reason: 'MUST_BE_UUID' });
  else turnId = raw.turnId;
  const answer = text(raw, 'text', 20000, issues);
  const answerStartMs =
    raw.answerStartMs === undefined || raw.answerStartMs === null
      ? null
      : integer(raw.answerStartMs, 'answerStartMs', 0, 2147483647, issues);
  unexpected(raw, ['turnId', 'text', 'answerStartMs'], issues);
  fail(issues);
  return { turnId: turnId!, text: answer!, answerStartMs };
}

export function parseId(value: string, field: string): string {
  if (!UUID.test(value)) throw new InputError([{ field, reason: 'MUST_BE_UUID' }]);
  return value;
}
