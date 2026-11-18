// 앱의 Jest 테스트를 node:test로 돌리기 위한 대용품. 앱 테스트가 실제로 쓰는 것만 있다.
import assert from 'node:assert/strict';
import { describe, it as nodeIt } from 'node:test';

const ASYM = Symbol('asymmetric');

// jest의 toEqual처럼 값이 undefined인 속성은 없는 것으로 본다.
function clean(v) {
  if (v && v[ASYM]) return v;
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)]));
  }
  return v;
}
function equals(a, b) {
  if (b && b[ASYM]) return b.match(a);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equals(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !(a instanceof Date)) {
    const [ca, cb] = [clean(a), clean(b)];
    const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
    return [...keys].every((k) => equals(ca[k], cb[k]));
  }
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}
function subset(actual, expected) {
  if (expected && expected[ASYM]) return expected.match(actual);
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((e, i) => subset(actual[i], e));
  if (expected && typeof expected === 'object') return actual && typeof actual === 'object' && Object.keys(expected).every((k) => subset(actual[k], expected[k]));
  return equals(actual, expected);
}
const getPath = (obj, p) => (Array.isArray(p) ? p : String(p).split('.')).reduce((o, k) => (o == null ? undefined : o[k]), obj);
const hasPath = (obj, p) => {
  const keys = Array.isArray(p) ? p : String(p).split('.');
  let o = obj;
  for (const k of keys) {
    if (o == null || !(k in Object(o))) return false;
    o = o[k];
  }
  return true;
};
const show = (v) => {
  try {
    return JSON.stringify(v)?.slice(0, 300);
  } catch {
    return String(v);
  }
};

function matchers(actual, negate) {
  const check = (pass, message) => {
    if (pass === negate) assert.fail(`${negate ? '(not) ' : ''}${message}`);
  };
  return {
    toBe: (e) => check(Object.is(actual, e), `toBe: ${show(actual)} / ${show(e)}`),
    toEqual: (e) => check(equals(actual, e), `toEqual: ${show(actual)} / ${show(e)}`),
    toContain: (e) => check(typeof actual === 'string' ? actual.includes(e) : [...actual].includes(e), `toContain: ${show(e)}`),
    toHaveLength: (n) => check(actual.length === n, `toHaveLength: ${actual.length} / ${n}`),
    toBeNull: () => check(actual === null, `toBeNull: ${show(actual)}`),
    toBeGreaterThan: (n) => check(actual > n, `toBeGreaterThan: ${actual} / ${n}`),
    toBeLessThan: (n) => check(actual < n, `toBeLessThan: ${actual} / ${n}`),
    toHaveProperty: (p, ...v) => check(hasPath(actual, p) && (v.length === 0 || equals(getPath(actual, p), v[0])), `toHaveProperty: ${show(p)}`),
    toMatchObject: (e) => check(subset(actual, e), `toMatchObject: ${show(actual)} / ${show(e)}`),
    toHaveBeenCalledWith: (...args) => check(actual.mock.calls.some((c) => equals(c, args)), `toHaveBeenCalledWith: ${show(args)}`),
    toThrow: (e) => {
      let thrown;
      try {
        actual();
      } catch (err) {
        thrown = err;
      }
      const ok = thrown !== undefined && (e === undefined || (e instanceof RegExp ? e.test(thrown.message) : String(thrown.message).includes(e)));
      check(ok, `toThrow: ${show(thrown?.message)}`);
    },
  };
}

export function expect(actual) {
  const settle = (wantReject) => {
    const wrap = (neg) =>
      new Proxy({}, {
        get: (_, name) => async (...args) => {
          let value;
          let rejected = false;
          try {
            value = await actual;
          } catch (err) {
            value = err;
            rejected = true;
          }
          if (rejected !== wantReject) assert.fail(wantReject ? '거부되지 않았다' : `거부됐다: ${show(value?.message)}`);
          if (name === 'toThrow') {
            const [e] = args;
            const ok = e === undefined || (e instanceof RegExp ? e.test(value.message) : String(value.message).includes(e));
            if (ok === neg) assert.fail(`rejects.toThrow: ${show(value?.message)}`);
            return;
          }
          matchers(value, neg)[name](...args);
        },
      });
    return Object.assign(wrap(false), { not: wrap(true) });
  };
  return { ...matchers(actual, false), not: matchers(actual, true), rejects: settle(true), resolves: settle(false) };
}
expect.objectContaining = (obj) => ({ [ASYM]: true, match: (actual) => subset(actual, obj) });

export const jest = {
  fn(impl) {
    let current = impl;
    const f = (...args) => {
      f.mock.calls.push(args);
      return current?.(...args);
    };
    f.mock = { calls: [] };
    f.mockResolvedValue = (v) => ((current = () => Promise.resolve(v)), f);
    f.mockReturnValue = (v) => ((current = () => v), f);
    f.mockImplementation = (fn) => ((current = fn), f);
    return f;
  },
};

// it.each(표)('이름 %s', fn): 표의 줄마다 테스트 하나.
export const it = Object.assign((name, fn) => nodeIt(name, fn), {
  each: (rows) => (name, fn) => {
    for (const row of rows) {
      const args = Array.isArray(row) ? row : [row];
      let i = 0;
      nodeIt(name.replace(/%[sdjo]/g, () => show(args[i++])), () => fn(...args));
    }
  },
});
export { describe };
