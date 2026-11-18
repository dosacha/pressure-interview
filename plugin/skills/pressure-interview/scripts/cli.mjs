// 엔진 명령. 표준 출력에 JSON 하나만 내고 표준 오류에는 아무것도 쓰지 않는다.
// 숨긴 값(의도, 가정, 정답지, 판정, 성향)과 원래 오류 문장은 어떤 출력에도 싣지 않는다. 원래 오류는 errors.log에만 쓴다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { foldAssumptions, pendingTopics } from './lib/app/memory/memory-rules.mjs';
import { configPath, DEFAULTS, loadConfig, saveConfig } from './lib/config.mjs';
import { EngineError } from './lib/errors.mjs';
import { createInterviewService } from './lib/interview.mjs';
import { checkClaude, createLlm } from './lib/llm.mjs';
import { sayClarify, sayQuestion } from './lib/render.mjs';
import { createReviewService } from './lib/review.mjs';
import { openStore } from './lib/store.mjs';
import { TurnService } from './lib/turn.service.mjs';

process.removeAllListeners('warning');

const SELF = fileURLToPath(import.meta.url);

const NEXT = {
  question: '사용자의 다음 메시지를 answerFile에 글자 그대로 쓰고 answer를 실행한다. say에 말을 보태지 않는다.',
  finished: '사용자가 복기를 만들겠다고 하면 review를 실행한다.',
  docs: 'say와 문서 경로를 알려 준다.',
  partial: '사용자가 다시 하겠다고 하면 review를 실행한다. hidden 폴더와 errors.log를 읽지 않는다.',
  setup: "사용자에게 면접 폴더 경로를 묻고 setup --data-dir '<경로>'를 실행한 뒤, 처음 받은 명령을 다시 실행한다.",
  statusOpen: '사용자가 이어서를 치면 resume을 실행한다.',
  statusNone: '사용자에게 면접 주제를 묻는다.',
  doctor: '결과를 알려 준다.',
};

// 실패의 say는 코드별 고정 문장이다. 원래 오류 문장을 넣지 않는다.
const SAY = {
  bad_config: '설정 파일을 읽지 못했습니다. 설정 파일의 내용을 확인해 주세요.',
  bad_args: '명령이나 인자가 맞지 않습니다.',
  cli_missing: 'claude 명령을 찾지 못했습니다. Claude Code가 설치돼 있는지 확인해 주세요.',
  not_logged_in: 'claude가 구독(claude.ai) 계정으로 로그인돼 있지 않습니다. 로그인한 뒤 다시 해 주세요.',
  interview_open: '진행 중인 면접이 있습니다. 이어서 하거나 끝낸 뒤에 새로 시작할 수 있습니다.',
  no_interview: '해당하는 면접이 없습니다.',
  no_answer: '답 파일이 없거나 비어 있습니다.',
  finished: '이미 끝난 면접입니다.',
  not_finished: '아직 끝나지 않은 면접입니다. 면접을 끝낸 뒤에 복기할 수 있습니다.',
  not_reviewed: '복기가 아직 끝나지 않은 면접입니다. 복기를 먼저 만들어 주세요.',
  not_reviewable: '그 번호의 질문은 고치거나 표시할 수 없습니다.',
  not_found: '그 id의 면접을 찾지 못했습니다.',
  memory_sync_failed: '가정 기억을 맞추지 못했습니다. 다시 하면 기억부터 맞춥니다.',
  usage_limit: '사용 한도에 걸렸습니다. 한도가 풀린 뒤에 이어서 할 수 있습니다.',
  refused: '모델이 응답을 거절했습니다. 다시 하면 멈춘 곳부터 합니다.',
  schema_failed: '모델의 응답이 정해진 모양과 맞지 않았습니다. 다시 하면 멈춘 곳부터 합니다.',
  timeout: '모델 호출이 시간 상한을 넘었습니다. 다시 하면 멈춘 곳부터 합니다.',
  other: '오류가 났습니다. 다시 하면 멈춘 곳부터 합니다.',
};

const RETRY_RESUME = '사용자가 다시 하겠다고 하면 resume을 실행한다.';
const FAIL_NEXT = {
  usage_limit: '다시 시도하지 않는다. 한도가 풀린 뒤 사용자가 이어서를 치면 resume을 실행한다.',
  no_answer: '사용자의 답을 answerFile에 쓴 뒤 answer를 다시 실행한다.',
  interview_open: '사용자가 정하는 대로 resume으로 이어 가거나 finish로 끝낸다.',
  memory_sync_failed: '사용자가 다시 하겠다고 하면 review를 실행한다.',
  refused: RETRY_RESUME,
  schema_failed: RETRY_RESUME,
  timeout: RETRY_RESUME,
  other: RETRY_RESUME,
};

const SETUP_NEEDED = {
  ok: true,
  kind: 'setup_needed',
  say: '면접 기록을 둘 폴더를 정해 주세요. 정답지와 질문 의도도 이 폴더 안의 hidden 폴더에 저장됩니다.',
  next: NEXT.setup,
};

const RESULT_NAMES = { well: '잘 답함', wobbly: '흔들림', wrong: '틀림' };
const SURPRISES = ['expected', 'unexpected'];

// 오류를 쓸 곳. 면접을 가린 뒤에는 그 면접의 hidden/errors.log, 그 전에는 면접 폴더의 errors.log다.
const ctx = { store: null, id: null, command: null, quiet: false };
let emitted = false;

function emit(out) {
  if (emitted) return;
  emitted = true;
  if (!ctx.quiet) process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exitCode = out.ok === false ? 1 : 0;
}

function fail(error) {
  try {
    ctx.store?.logError(ctx.id, `명령 ${ctx.command}`, error);
  } catch {
    // 로그를 못 써도 출력은 낸다
  }
  const code = error instanceof EngineError && SAY[error.code] ? error.code : 'other';
  emit({
    ok: false,
    kind: 'error',
    code,
    say: SAY[code],
    ...(code === 'no_answer' && error.answerFile ? { answerFile: error.answerFile } : {}),
    next: `${FAIL_NEXT[code] ?? 'say를 보여 준다.'} hidden 폴더와 errors.log를 읽지 않는다.`,
  });
}

const badArgs = (detail) => new EngineError('bad_args', detail);

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const pad2 = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function launchCompletion(id, seq) {
  spawn(process.execPath, [SELF, 'complete', id, String(seq)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function statusOut(store, config) {
  const all = store.listInterviews();
  const open = all.find((s) => s.status === 'in_progress');
  const topics = pendingTopics(store.readMemory(), new Date(), config.reissueAfterHours);
  const recent = all.slice(0, 5);
  const say = [
    `진행 중인 면접: ${open ? `${open.topic} (${open.id})` : '없음'}`,
    '',
    '다시 연습할 주제:',
    ...(topics.length === 0 ? ['없음'] : topics.map((t) => `- ${t}`)),
    '',
    '최근 면접:',
    ...(recent.length === 0 ? ['없음'] : recent.map((s) => `- ${s.id} · ${s.topic} · ${day(s.createdAt)}`)),
  ].join('\n');
  return { ok: true, kind: 'status', ...(open ? { interview: open.id } : {}), say, next: open ? NEXT.statusOpen : NEXT.statusNone };
}

// 면접 한 판의 결과(view)를 출력으로 바꾼다. 되묻기 응답이 달린 열린 턴은 clarify다. 새 질문에는 되묻기가 없다.
function turnOut(store, view) {
  if (view.status === 'finished') {
    return {
      ok: true,
      kind: 'finished',
      interview: view.id,
      say: `${view.closing}\n\n면접이 끝났습니다. 복기 문서를 만들까요? 답한 질문마다 호출이 한 번씩 더 나갑니다.`,
      next: NEXT.finished,
    };
  }
  const { open } = view;
  const clarify = open.clarifications.length > 0;
  return {
    ok: true,
    kind: clarify ? 'clarify' : 'question',
    interview: view.id,
    say: clarify ? sayClarify(view, open.clarifications.at(-1).reply) : sayQuestion(view),
    answerFile: store.answerFile(view.id, open.seq, open.inputNo),
    next: NEXT.question,
  };
}

function openInterview(env) {
  const id = env.interviews.current();
  if (id === null) throw new EngineError('no_interview');
  ctx.id = id;
  return id;
}

// review·mark·surprise가 가리킬 면접.
function target(env, id) {
  if (id !== undefined) {
    if (!env.store.listInterviews().some((s) => s.id === id)) throw new EngineError('not_found', id);
    ctx.id = id;
    return id;
  }
  const latest = env.reviews.latestFinished();
  if (latest === null) throw new EngineError(env.interviews.current() === null ? 'no_interview' : 'not_finished');
  ctx.id = latest;
  return latest;
}

function seqArg(value) {
  if (!/^[1-9]\d*$/.test(value ?? '')) throw badArgs(`질문 번호: ${value}`);
  return Number(value);
}

function markedOut(env, id) {
  return {
    ok: true,
    kind: 'marked',
    interview: id,
    say: '저장하고 복기 문서와 추이 문서를 다시 만들었습니다.',
    paths: env.reviews.paths(id),
    next: NEXT.docs,
  };
}

const COMMANDS = {
  status: (env) => statusOut(env.store, env.config),

  async start(env) {
    const topic = flag(env.args, '--topic');
    if (!topic?.trim()) throw badArgs('주제가 없다');
    await checkClaude(env.config);
    const view = await env.interviews.start({ topic });
    ctx.id = view.id;
    return turnOut(env.store, view);
  },

  async answer(env) {
    const id = openInterview(env);
    const { store, interviews } = env;
    const { open } = interviews.view(id);
    if (open) {
      const file = store.answerFile(id, open.seq, open.inputNo);
      const text = store.readAnswerFile(file);
      if (text === null) throw Object.assign(new EngineError('no_answer'), { answerFile: file });
      return turnOut(store, await interviews.submitAnswer(id, text, file));
    }
    // 답이 이미 저장된 턴이다. 파일의 글은 보지 않고 빠진 단계부터 잇는다.
    const last = store.readTurns(id).at(-1);
    return turnOut(store, await interviews.submitAnswer(id, null, store.answerFile(id, last.seq, last.clarifications.length + 1)));
  },

  async resume(env) {
    return turnOut(env.store, await env.interviews.resume(openInterview(env)));
  },

  async finish(env) {
    return turnOut(env.store, await env.interviews.finish(openInterview(env)));
  },

  async review(env) {
    const id = target(env, env.args[0]);
    const r = await env.reviews.run(id);
    if (!r.ready) {
      return {
        ok: true,
        kind: 'review_partial',
        interview: id,
        say: `복기 ${r.total}개 가운데 ${r.total - r.done}개가 실패했습니다. 다시 하면 실패한 것만 합니다.`,
        next: NEXT.partial,
      };
    }
    const paths = env.reviews.paths(id);
    const folded = foldAssumptions(env.store.readTurns(id), env.store.readMemory().map((m) => m.id));
    const counts = Object.entries(RESULT_NAMES).map(([k, name]) => `${name} ${folded.filter((f) => f.result === k).length}`);
    return {
      ok: true,
      kind: 'review_ready',
      interview: id,
      say: `가정별 결과: ${counts.join(' · ')}\n\n복기 문서: ${paths.review}`,
      paths,
      next: NEXT.docs,
    };
  },

  mark(env) {
    const [seq, result, id] = env.args;
    const n = seqArg(seq);
    if (!(result in RESULT_NAMES)) throw badArgs(`가정 결과: ${result}`);
    const tid = target(env, id);
    env.reviews.mark(tid, n, { result });
    return markedOut(env, tid);
  },

  surprise(env) {
    const [seq, surprise, id] = env.args;
    const n = seqArg(seq);
    if (!SURPRISES.includes(surprise)) throw badArgs(`예상 표시: ${surprise}`);
    const tid = target(env, id);
    env.reviews.mark(tid, n, { surprise });
    return markedOut(env, tid);
  },

  stats(env) {
    const { improved } = env.reviews.stats();
    const file = path.join(env.config.dataDir, 'stats.md');
    return {
      ok: true,
      kind: 'stats',
      say: `흔들림이나 틀림에서 잘 답함으로 바뀐 가정: ${improved}개\n\n추이 문서: ${file}`,
      paths: { stats: file },
      next: NEXT.docs,
    };
  },

  // 정답지 뒤 작업. 출력이 없고 실패는 errors.log에만 쓴다.
  async complete(env) {
    const [id, seq] = env.args;
    const n = seqArg(seq);
    if (!env.store.listInterviews().some((s) => s.id === id)) throw new EngineError('not_found', id);
    ctx.id = id;
    await env.interviews.complete(id, n);
    return null;
  },
};

function setup(args) {
  const dir = flag(args, '--data-dir');
  if (!dir?.trim()) throw badArgs('--data-dir가 없다');
  const dataDir = path.resolve(dir);
  fs.mkdirSync(dataDir, { recursive: true });
  const config = saveConfig({ dataDir });
  ctx.store = openStore(dataDir);
  return statusOut(ctx.store, config);
}

// 설정과 claude를 점검한다. 점검의 실패도 결과로 알린다. 문장은 코드별 고정 문장이다.
async function doctor(args) {
  const lines = [`설정 파일: ${configPath()}`];
  let config = null;
  try {
    config = loadConfig();
    if (config === null) lines.push('설정: 없음. setup으로 면접 폴더를 정해야 합니다.');
    else if (config.dataDir === null || !fs.existsSync(config.dataDir)) lines.push(`면접 폴더: 없음 (${config.dataDir ?? '정하지 않음'})`);
    else {
      lines.push(`면접 폴더: ${config.dataDir}`);
      ctx.store = openStore(config.dataDir);
    }
  } catch {
    // 설정을 못 읽으면 로그를 쓸 곳도 모른다
    lines.push(`설정: ${SAY.bad_config}`);
  }
  const effective = config ?? DEFAULTS;
  const check = async (label, fn) => {
    try {
      await fn();
      lines.push(`${label}: 통과`);
    } catch (error) {
      try {
        ctx.store?.logError(null, `doctor ${label}`, error);
      } catch {
        // 로그를 못 써도 결과는 낸다
      }
      lines.push(`${label}: ${SAY[error instanceof EngineError && SAY[error.code] ? error.code : 'other']}`);
    }
  };
  await check('claude 점검', () => checkClaude(effective));
  if (args.includes('--call')) {
    await check('호출 시험(jobRole, 주제 Redis)', () =>
      new TurnService(createLlm({ config: effective, record() {} }), effective).pickJobRole('Redis'),
    );
  }
  return { ok: true, kind: 'doctor', say: lines.join('\n'), next: NEXT.doctor };
}

async function main([command, ...args]) {
  ctx.command = command;
  if (command === 'complete') ctx.quiet = true;
  if (command === 'setup') return setup(args);
  if (command === 'doctor') return doctor(args);
  if (!Object.hasOwn(COMMANDS, command ?? '')) throw badArgs(`알 수 없는 명령: ${command}`);
  const config = loadConfig();
  if (config === null || config.dataDir === null || !fs.existsSync(config.dataDir)) {
    return command === 'complete' ? null : SETUP_NEEDED;
  }
  const store = openStore(config.dataDir);
  ctx.store = store;
  const llmFor = (id) => createLlm({ config, record: (row) => store.appendCall(id, row) });
  const interviews = createInterviewService({ store, config, llmFor, launchCompletion });
  const reviews = createReviewService({ store, config, llmFor });
  return COMMANDS[command]({ args, config, store, interviews, reviews });
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
try {
  const out = await main(process.argv.slice(2));
  if (out) emit(out);
} catch (error) {
  fail(error);
}
