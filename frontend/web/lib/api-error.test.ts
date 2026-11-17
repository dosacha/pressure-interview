import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, describeApiError } from './api-error.ts';

void test('LLM_FAILED는 다시 시도 안내이고 reload는 false', () => {
  assert.deepEqual(describeApiError(new ApiError(502, 'LLM_FAILED')), {
    text: '면접관의 응답을 받지 못했습니다. 다시 시도해 주세요.',
    reload: false,
  });
});

void test('TURN_NOT_OPEN과 NOTHING_TO_RETRY는 reload true', () => {
  const open = describeApiError(new ApiError(409, 'TURN_NOT_OPEN'));
  const retry = describeApiError(new ApiError(409, 'NOTHING_TO_RETRY'));
  assert.deepEqual(open, { text: '이미 답한 질문입니다. 화면을 새로 고칩니다.', reload: true });
  assert.deepEqual(retry, { text: '이미 진행됐습니다. 화면을 새로 고칩니다.', reload: true });
});

void test('나머지 code의 문장', () => {
  assert.deepEqual(describeApiError(new ApiError(409, 'INTERVIEW_FINISHED')), {
    text: '끝난 면접입니다.',
    reload: true,
  });
  assert.equal(describeApiError(new ApiError(400, 'INVALID_INPUT')).text, '입력을 확인해 주세요.');
  assert.equal(describeApiError(new ApiError(404, 'NOT_FOUND')).text, '면접을 찾을 수 없습니다.');
});

void test('ApiError가 아닌 오류는 일반 문장', () => {
  assert.deepEqual(describeApiError(new Error('x')), {
    text: '문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.',
    reload: false,
  });
});
