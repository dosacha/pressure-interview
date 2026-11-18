import { spawn } from 'node:child_process';

import { EngineError } from './errors.mjs';

// 자식 claude는 세션의 인증·설정 변수를 물려받지 않는다.
export function childEnv(env, keepEnv = []) {
  const keep = new Set(['CLAUDE_CONFIG_DIR', ...keepEnv]);
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => keep.has(name) || !/^(CLAUDE|ANTHROPIC)/.test(name)),
  );
}

export function buildArgs({ model, effort, system, schema }) {
  return [
    '-p', '--model', model, '--effort', effort,
    '--system-prompt', system,
    '--json-schema', JSON.stringify(schema),
    '--output-format', 'json',
    '--tools', '',
    '--safe-mode', '--no-session-persistence', '--strict-mcp-config',
  ];
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

// 설계 11장: usage_limit(429)·refused·schema_failed의 실제 결과 모양은 아직 못 봤다. 가장 그럴듯한 필드로 정했다.
export function classify({ spawnError, timedOut, exitCode = 0, stdout }) {
  if (spawnError?.code === 'ENOENT') return { ok: false, code: 'cli_missing' };
  if (timedOut) return { ok: false, code: 'timeout' };
  const result = parseObject(stdout);
  if (result === null) return { ok: false, code: 'other' };
  if (result.api_error_status === 429) return { ok: false, code: 'usage_limit' };
  if (result.stop_reason === 'refusal') return { ok: false, code: 'refused' };
  if (result.is_error === true || exitCode !== 0) return { ok: false, code: 'other' };
  const out = result.structured_output;
  if (out === null || typeof out !== 'object') return { ok: false, code: 'schema_failed' };
  return { ok: true, result };
}

// 셸 없이 띄우고 표준 출력·오류를 버퍼로만 받는다.
function run(cmd, args, { input, env, timeoutMs }) {
  return new Promise((resolve) => {
    const out = [];
    const err = [];
    let timedOut = false;
    let done = false;
    const child = spawn(cmd[0], [...cmd.slice(1), ...args], { env, windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const finish = (extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        timedOut,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        ...extra,
      });
    };
    child.stdout.on('data', (b) => out.push(b));
    child.stderr.on('data', (b) => err.push(b));
    child.on('error', (spawnError) => finish({ spawnError }));
    child.on('close', (exitCode) => finish({ exitCode: exitCode ?? 1 }));
    child.stdin.on('error', () => {}); // 자식이 먼저 끝나면 EPIPE가 난다
    child.stdin.end(input ?? '');
  });
}

const tokens = (usage = {}) => ({
  input_tokens: usage.input_tokens ?? 0,
  output_tokens: usage.output_tokens ?? 0,
  cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
  cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
});

export function createLlm({ config, record, env = process.env }) {
  async function callJson({ kind, system, user, schema }) {
    const call = config.calls[kind];
    if (!call) throw new Error(`알 수 없는 호출 종류: ${kind}`);
    const at = new Date().toISOString();
    const started = Date.now();
    const res = await run(config.claudeCommand, buildArgs({ model: call.model, effort: call.effort, system, schema }), {
      input: user,
      env: childEnv(env, config.keepEnv),
      timeoutMs: config.callTimeoutMs,
    });
    const verdict = classify(res);
    const parsed = verdict.ok ? verdict.result : parseObject(res.stdout);
    const usage = tokens(parsed?.usage);
    const model = Object.keys(parsed?.modelUsage ?? {})[0] ?? call.model;
    record({
      at, kind, model, effort: call.effort, ...usage,
      duration_ms: parsed?.duration_ms ?? 0,
      wall_ms: Date.now() - started,
      ok: verdict.ok,
      ...(verdict.ok ? {} : { code: verdict.code }),
    });
    if (!verdict.ok) throw new EngineError(verdict.code, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
    return { data: verdict.result.structured_output, usage, model };
  }
  return { callJson };
}

export async function checkClaude(config, env = process.env) {
  const res = await run(config.claudeCommand, ['auth', 'status'], {
    env: childEnv(env, config.keepEnv),
    timeoutMs: config.callTimeoutMs,
  });
  if (res.spawnError) throw new EngineError('cli_missing', res.spawnError.message);
  if (res.timedOut) throw new EngineError('timeout', `${res.stdout}${res.stderr}`);
  const status = parseObject(res.stdout);
  if (status?.loggedIn !== true || status.authMethod !== 'claude.ai') {
    throw new EngineError('not_logged_in', `${res.stdout}${res.stderr}`);
  }
}
