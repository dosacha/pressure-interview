import { UsageRecorder, type UsageRow } from './usage-recorder';

const row: UsageRow = {
  role: 'leak',
  model: 'm',
  input_tokens: 1,
  output_tokens: 2,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  fallback: false,
};

describe('UsageRecorder', () => {
  it('run 안에서 부른 record만 sink로 간다', async () => {
    const seen: [string, UsageRow[]][] = [];
    const r = new UsageRecorder();
    r.setSink((id, rows) => seen.push([id, rows]));
    r.record([row]);
    await r.run('s1', async () => {
      await Promise.resolve();
      r.record([row]);
    });
    expect(seen).toEqual([['s1', [row]]]);
  });

  it('sink가 없으면 run 안의 record도 버린다', async () => {
    const r = new UsageRecorder();
    await expect(r.run('s1', () => Promise.resolve(7))).resolves.toBe(7);
    expect(() => r.record([row])).not.toThrow();
  });

  it('run 안에서 시작해 기다리지 않은 작업의 record도 같은 세션으로 간다', async () => {
    const seen: [string, UsageRow[]][] = [];
    const r = new UsageRecorder();
    r.setSink((id, rows) => seen.push([id, rows]));
    await r.run('s1', () => {
      setTimeout(() => r.record([row]), 5);
      return Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toEqual([['s1', [row]]]);
  });

  it('동시에 도는 두 run이 서로 섞이지 않는다', async () => {
    const seen: [string, UsageRow[]][] = [];
    const r = new UsageRecorder();
    r.setSink((id, rows) => seen.push([id, rows]));
    const a = { ...row, model: 'a' };
    const b = { ...row, model: 'b' };
    await Promise.all([
      r.run('s1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        r.record([a]);
      }),
      r.run('s2', async () => {
        await Promise.resolve();
        r.record([b]);
      }),
    ]);
    expect(seen).toEqual([
      ['s2', [b]],
      ['s1', [a]],
    ]);
  });
});
