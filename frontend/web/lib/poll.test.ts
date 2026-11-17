import assert from 'node:assert/strict';
import test from 'node:test';
import { pollUntil } from './poll.ts';

const noSleep = () => Promise.resolve();

void test('done이 참이 되면 그 값을 돌려준다', async () => {
  const replies = ['pending', 'pending', 'ready'];
  let calls = 0;
  const value = await pollUntil(
    () => Promise.resolve(replies[calls++]),
    (v) => v === 'ready',
    { intervalMs: 3000, sleep: noSleep },
  );
  assert.equal(value, 'ready');
  assert.equal(calls, 3);
});

void test('signal이 끊기면 더 묻지 않는다', async () => {
  const controller = new AbortController();
  let calls = 0;
  const sleeps: number[] = [];
  const run = pollUntil(
    () => Promise.resolve(++calls),
    () => false,
    {
      intervalMs: 3000,
      sleep: (ms) => {
        sleeps.push(ms);
        controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
    },
  );
  await assert.rejects(run);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, [3000]);
});

void test('fetchOnce가 던지면 그대로 던진다', async () => {
  const boom = new Error('boom');
  await assert.rejects(
    pollUntil(
      () => Promise.reject(boom),
      () => true,
      { intervalMs: 3000, sleep: noSleep },
    ),
    boom,
  );
});
