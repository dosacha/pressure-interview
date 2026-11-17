/** done이 참이 될 때까지 fetchOnce를 되풀이한다. signal이 끊기면 다음 요청을 보내지 않고 거부한다. */
export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  done: (v: T) => boolean,
  opts: { intervalMs: number; sleep: (ms: number) => Promise<void>; signal?: AbortSignal },
): Promise<T> {
  for (;;) {
    opts.signal?.throwIfAborted();
    const value = await fetchOnce();
    // 응답이 오는 사이에 화면을 떠났으면 그 값도 쓰지 않는다.
    opts.signal?.throwIfAborted();
    if (done(value)) return value;
    await opts.sleep(opts.intervalMs);
  }
}
