import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirstInputTimer } from './first-input-timer.ts';

void test('첫 입력까지의 시간만 잰다', () => {
  let t = 1000;
  const timer = createFirstInputTimer(() => t);
  timer.shown();
  t = 1850;
  timer.input();
  t = 5000;
  timer.input();
  assert.equal(timer.value(), 850);
});

void test('입력이 없었으면 null', () => {
  const timer = createFirstInputTimer(() => 1000);
  timer.shown();
  assert.equal(timer.value(), null);
});

void test('새 질문이 나오면 다시 잰다', () => {
  let t = 0;
  const timer = createFirstInputTimer(() => t);
  timer.shown();
  t = 100;
  timer.input();
  t = 200;
  timer.shown();
  assert.equal(timer.value(), null);
});

void test('shown 전에 온 입력은 세지 않는다', () => {
  const timer = createFirstInputTimer(() => 500);
  timer.input();
  assert.equal(timer.value(), null);
});
