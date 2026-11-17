import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldClearDraft } from './draft.ts';

void test('턴이 바뀌면 입력칸을 비운다', () => {
  assert.equal(
    shouldClearDraft({ turnId: 'a', clarifications: 0 }, { turnId: 'b', clarifications: 0 }),
    true,
  );
});
void test('같은 턴에 되묻기 응답이 붙으면 비운다', () => {
  assert.equal(
    shouldClearDraft({ turnId: 'a', clarifications: 0 }, { turnId: 'a', clarifications: 1 }),
    true,
  );
});
void test('아무것도 안 바뀌면 쓰던 글을 둔다', () => {
  assert.equal(
    shouldClearDraft({ turnId: 'a', clarifications: 1 }, { turnId: 'a', clarifications: 1 }),
    false,
  );
});
