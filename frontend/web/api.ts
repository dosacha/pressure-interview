import { ApiError } from '@/lib/api-error';
import {
  decodeInterviewList,
  decodeInterviewView,
  type InterviewListItem,
  type InterviewView,
} from '@/lib/decode';

// 자동 재시도는 하지 않는다. 다시 보내면 모델 호출 과금이 한 번 더 일어날 수 있어 사용자가 버튼으로 정한다.
async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`/v1${path}`, {
    method,
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      typeof json === 'object' && json !== null && 'error' in json && typeof json.error === 'string'
        ? json.error
        : 'UNKNOWN';
    throw new ApiError(res.status, code);
  }
  return json;
}

const view = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<InterviewView> =>
  decodeInterviewView(await request(method, path, body));

export const startInterview = (topic: string, questionLimit?: number) =>
  view('POST', '/interviews', questionLimit === undefined ? { topic } : { topic, questionLimit });

export const getInterview = (id: string) => view('GET', `/interviews/${id}`);

export async function listInterviews(): Promise<InterviewListItem[]> {
  return decodeInterviewList(await request('GET', '/interviews'));
}

export const sendAnswer = (
  id: string,
  turnId: string,
  text: string,
  answerStartMs: number | null,
) => view('POST', `/interviews/${id}/answers`, { turnId, text, answerStartMs });

export const advance = (id: string) => view('POST', `/interviews/${id}/advance`);

export const finish = (id: string) => view('POST', `/interviews/${id}/finish`);
