import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeInterviewList, decodeInterviewView } from './decode.ts';

const view = {
  id: 'i1',
  topic: 'Redis',
  status: 'in_progress',
  questionLimit: 6,
  panel: [{ id: 'p1', roleName: '백엔드 면접관' }],
  turns: [
    {
      id: 't1',
      seq: 1,
      interviewerId: 'p1',
      addOn: false,
      text: '질문',
      clarifications: [{ ask: '범위는?', reply: '한 대입니다.' }],
      answer: null,
    },
  ],
  pending: 'answer',
  closing: null,
  createdAt: '2026-11-17T00:00:00.000Z',
};

void test('면접 뷰를 그대로 통과시킨다', () => {
  assert.deepEqual(decodeInterviewView(view), view);
});

void test('turns가 배열이 아니면 던진다', () => {
  assert.throws(() => decodeInterviewView({ ...view, turns: 'x' }));
});

void test('모르는 status면 던진다', () => {
  assert.throws(() => decodeInterviewView({ ...view, status: 'paused' }));
});

void test('목록을 읽고 모양이 다르면 던진다', () => {
  const item = { id: 'i1', topic: 'Redis', status: 'finished', createdAt: 'x', questionCount: 3 };
  assert.deepEqual(decodeInterviewList([item]), [item]);
  assert.throws(() => decodeInterviewList([{ ...item, questionCount: '3' }]));
});
