import { InputError, type InputIssue } from '../http/input-error';
import type { AssumptionResult } from '../interview/types';

const SURPRISES: unknown[] = ['expected', 'unexpected'] satisfies ('expected' | 'unexpected')[];
const RESULTS: unknown[] = ['well', 'wobbly', 'wrong'] satisfies AssumptionResult[];
const FIELDS = ['surprise', 'assumptionResult'];

export function parseTurnPatch(body: unknown): {
  surprise?: 'expected' | 'unexpected';
  assumptionResult?: AssumptionResult;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new InputError([{ field: 'body', reason: 'MUST_BE_OBJECT' }]);
  const raw = body as Record<string, unknown>;
  const issues: InputIssue[] = [];
  if (raw.surprise === undefined && raw.assumptionResult === undefined)
    issues.push({ field: 'body', reason: 'REQUIRED' });
  if (raw.surprise !== undefined && !SURPRISES.includes(raw.surprise))
    issues.push({ field: 'surprise', reason: 'NOT_ALLOWED' });
  if (raw.assumptionResult !== undefined && !RESULTS.includes(raw.assumptionResult))
    issues.push({ field: 'assumptionResult', reason: 'NOT_ALLOWED' });
  for (const field of Object.keys(raw))
    if (!FIELDS.includes(field)) issues.push({ field, reason: 'UNEXPECTED_FIELD' });
  if (issues.length > 0) throw new InputError(issues);
  return {
    ...(raw.surprise !== undefined && { surprise: raw.surprise as 'expected' | 'unexpected' }),
    ...(raw.assumptionResult !== undefined && {
      assumptionResult: raw.assumptionResult as AssumptionResult,
    }),
  };
}
