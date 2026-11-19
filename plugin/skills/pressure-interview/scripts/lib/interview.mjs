// 앱(aeae0dd)의 src/session/interview.service.ts를 손으로 옮긴 것이다. 앱과 다른 곳: 저장은 DB 대신 store의 파일이고,
// 세션 잠금이 없고(한 세션이 한 번에 명령 하나를 돌린다), 정답지는 key.lock을 쥔 쪽만 쓴다.
import { ROLES } from './app/interview/catalog.mjs';
import { selectMemory } from './app/memory/memory-rules.mjs';
import { chooseTargetAxis, CLOSING_TEXT, composePanel, nextAsker, pickOpener } from './app/session/session-rules.mjs';
import { EngineError } from './errors.mjs';
import { TurnService } from './turn.service.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 질문과 정답지 호출에 넘기는 대화: 답한 턴마다 질문 문장과 되묻기 기록, 답.
function historyOf(turns) {
  return turns
    .filter((t) => t.answer !== null)
    .map((t) => ({
      interviewerId: t.interviewerId,
      text: t.question.text + t.clarifications.map((c) => `\n(되묻기) 지원자: ${c.ask} / 면접관: ${c.reply}`).join(''),
      answer: t.answer,
    }));
}

// 저장된 질문에서 정답지를 뺀 초안.
function draftOf(q) {
  return { text: q.text, questionIntent: q.questionIntent, assumption: q.assumption };
}

// answer.json은 통째로 쓰므로 턴의 값에서 다시 만들고 바뀐 것만 덮는다.
function answerOf(turn, over) {
  return {
    answer: turn.answer,
    answeredAt: turn.answeredAt,
    clarifications: turn.clarifications,
    analysis: turn.analysis,
    pick: turn.pick,
    ...over,
  };
}

function member(session, interviewerId) {
  const m = session.panel.find((p) => p.id === interviewerId);
  if (!m) throw new Error(`패널에 없는 면접관이다: ${interviewerId}`);
  return m;
}

export function createInterviewService({ store, config, llmFor, rng = Math.random, now = () => new Date(), launchCompletion }) {
  const engine = (id) => new TurnService(llmFor(id), config);
  // 정답지 작업은 호출 둘(작성, 검증)이고 호출마다 시간 상한이 있다. 그보다 오래된 잠금은 죽은 것으로 본다.
  const staleMs = 2 * config.callTimeoutMs + 30000;

  function load(id) {
    const session = store.readSession(id);
    const turns = store.readTurns(id);
    return { session, turns, last: turns.at(-1) };
  }

  function questionFile(prepared, turn) {
    return {
      ...turn,
      draft: prepared.draft,
      prepared: { flags: prepared.flags, attempts: prepared.attempts },
      createdAt: now(),
    };
  }

  // 정답지 호출의 입력은 저장된 턴에서 만든다. 어느 프로세스가 만들어도 같은 입력이 나온다.
  function answerKeyInput(session, turns, turn) {
    return {
      topic: session.topic,
      interviewer: member(session, turn.interviewerId),
      reactionIntent: turn.reactionIntent,
      defect: turn.defect,
      addOn: turn.addOn,
      history: historyOf(turns.filter((t) => t.seq < turn.seq)),
      draft: draftOf(turn.question),
    };
  }

  // 잠금을 쥔 채로만 부른다.
  async function writeCompletion(id, session, turns, turn) {
    const completed = await engine(id).completeQuestion(answerKeyInput(session, turns, turn));
    const key = {
      answerKey: completed.question.answerKey,
      verification: completed.verification,
      answerKeyCorrected: completed.answerKeyCorrected,
    };
    store.writeKey(id, turn.seq, key);
    return key;
  }

  // 분석에는 정답지가 필요하다. 뒤 작업이 잠금을 쥐고 있으면 끝날 때까지 기다리고, 아무도 없으면 지금 만든다.
  async function keyFor(id, session, turns, turn) {
    for (;;) {
      const found = store.readKey(id, turn.seq);
      if (found) return found;
      const release = store.acquireKeyLock(id, turn.seq, staleMs);
      if (release) {
        try {
          // 읽은 뒤 잠금을 잡기 전에 다른 쪽이 쓰고 풀었을 수 있다.
          return store.readKey(id, turn.seq) ?? (await writeCompletion(id, session, turns, turn));
        } finally {
          release();
        }
      }
      await sleep(config.pollMs);
    }
  }

  async function analyze(id, session, turns) {
    const turn = turns.at(-1);
    const key = await keyFor(id, session, turns, turn);
    const result = await engine(id).handleAnswer({
      topic: session.topic,
      panel: session.panel,
      history: turns.map((t) => t.interviewerId),
      askedBy: turn.interviewerId,
      question: { ...turn.question, answerKey: key.answerKey },
      answer: turn.answer,
      userMentioned: session.userMentioned,
    });
    // 앱이 한 트랜잭션으로 묶던 두 쓰기. 세션을 먼저 쓴다. answer.json 전에 죽으면 다시 분석하고, 두 목록은 합집합이라 결과가 같다.
    store.writeSession(id, {
      ...session,
      userMentioned: result.userMentioned,
      unknownTechs: [...new Set([...session.unknownTechs, ...result.unknownTechs])],
    });
    // 되묻기여도 분석을 저장한다. 되묻기 응답이 실패했을 때 같은 입력을 다시 분석하지 않기 위해서다.
    store.writeAnswer(id, turn.seq, answerOf(turn, { analysis: result.analysis, pick: result.pick }));
  }

  async function replyToClarification(id, session, turn) {
    const ask = turn.answer;
    const { reply, leak } = await engine(id).replyToClarification({
      topic: session.topic,
      interviewer: member(session, turn.interviewerId),
      question: draftOf(turn.question),
      questionTechs: turn.prepared.attempts.at(-1)?.techs ?? [],
      exchanges: turn.clarifications.map((c) => ({ ask: c.ask, reply: c.reply })),
      ask,
      userMentioned: session.userMentioned,
      avoidTechs: session.unknownTechs,
    });
    // 같은 턴을 다시 열어 사용자의 답을 기다린다.
    store.writeAnswer(id, turn.seq, {
      answer: null,
      answeredAt: null,
      clarifications: [...turn.clarifications, { ask, reply, leak }],
      analysis: null,
      pick: null,
    });
  }

  async function nextQuestion(id, session, turns) {
    const last = turns.at(-1);
    if (!last.pick) throw new Error(`답 분석에 다음 질문자가 없다: ${last.id}`);
    // 기다리는 덧붙임은 새 턴의 question.json에 함께 둔다. 질문이 만들어지기 전에 실패하면 다시 할 때 같은 질문자가 나온다.
    const next = nextAsker({ lastTurnId: last.id, pick: last.pick, pending: last.pendingSecondary });
    const nextSeq = turns.length + 1;
    const targetAxis = chooseTargetAxis({
      nextSeq,
      questionLimit: session.questionLimit,
      assumptionAxes: turns.map((t) => t.question.assumption.axis),
    });
    const prepared = await engine(id).prepareDraft({
      topic: session.topic,
      interviewer: member(session, next.choice.interviewerId),
      reactionIntent: next.choice.reactionIntent,
      defect: next.choice.defect,
      opening: targetAxis && { area: { name: session.topic, axis: targetAxis, angles: [] }, direction: '' },
      history: historyOf(turns),
      userMentioned: session.userMentioned,
      avoidTechs: session.unknownTechs,
      memory: session.memory,
      feedback: [],
    });
    store.writeQuestion(
      id,
      nextSeq,
      questionFile(prepared, {
        interviewerId: next.choice.interviewerId,
        addOn: next.addOn,
        causeTurnId: next.causeTurnId,
        reactionIntent: next.choice.reactionIntent,
        defect: next.choice.defect,
        targetAxis,
        pendingSecondary: next.pending,
      }),
    );
    launchCompletion(id, nextSeq);
  }

  function finishSession(id, session) {
    store.writeSession(id, { ...session, status: 'finished', finishedAt: now() });
  }

  // 파일을 보고 빠진 단계를 한다. 할 일이 있었으면 true.
  async function proceed(id) {
    let { session, turns, last } = load(id);
    if (session.status === 'finished' || last.answer === null) return false;
    if (last.analysis === null) {
      await analyze(id, session, turns);
      ({ session, turns, last } = load(id));
    }
    if (last.analysis.kind === 'clarify') await replyToClarification(id, session, last);
    else if (turns.length >= session.questionLimit) finishSession(id, session);
    else await nextQuestion(id, session, turns);
    return true;
  }

  // 면접 중에 숨기는 값(정답지·의도·가정·분석·성향)이 실리지 않도록 필드를 하나씩 골라 담는다.
  function view(id) {
    const { session, turns, last } = load(id);
    const finished = session.status === 'finished';
    const open = !finished && last.answer === null ? last : null;
    return {
      id,
      topic: session.topic,
      status: session.status,
      questionLimit: session.questionLimit,
      turnCount: turns.length,
      open: open && {
        seq: open.seq,
        roleName: ROLES[member(session, open.interviewerId).role].name,
        addOn: open.addOn,
        text: open.question.text,
        clarifications: open.clarifications.map((c) => ({ ask: c.ask, reply: c.reply })),
        inputNo: open.clarifications.length + 1,
      },
      pending: finished ? null : last.answer === null ? 'answer' : 'retry',
      closing: finished ? CLOSING_TEXT : null,
    };
  }

  function current() {
    return store.listInterviews().find((s) => s.status === 'in_progress')?.id ?? null;
  }

  return {
    current,
    view,

    async start({ topic, questionLimit }) {
      if (current() !== null) throw new EngineError('interview_open');
      const createdAt = now();
      // 호출 기록을 남길 곳이 있어야 하므로 폴더를 먼저 만든다. session.json이 없는 폴더는 면접으로 치지 않는다.
      const id = store.createInterview(topic, createdAt);
      const memory = selectMemory(store.readMemory(), createdAt, config.reissueAfterHours);
      const turnService = engine(id);
      const { role } = await turnService.pickJobRole(topic);
      const panel = composePanel(role, rng);
      const opener = pickOpener(panel, rng);
      const prepared = await turnService.prepareDraft({
        topic,
        interviewer: opener,
        reactionIntent: null,
        defect: null,
        opening: { area: { name: topic, axis: ROLES[opener.role].axes[0], angles: [] }, direction: '' },
        history: [],
        userMentioned: [topic],
        feedback: [],
        avoidTechs: [],
        memory,
      });
      // 질문을 먼저 쓰고 세션을 쓴다. 세션이 있으면 턴도 있다.
      store.writeQuestion(
        id,
        1,
        questionFile(prepared, {
          interviewerId: opener.id,
          addOn: false,
          causeTurnId: null,
          reactionIntent: null,
          defect: null,
          targetAxis: null,
          pendingSecondary: null,
        }),
      );
      store.writeSession(id, {
        id,
        topic,
        panel,
        questionLimit: questionLimit ?? config.questionLimit,
        status: 'in_progress',
        userMentioned: [topic],
        unknownTechs: [],
        memory,
        createdAt,
        finishedAt: null,
        reviewedAt: null,
      });
      launchCompletion(id, 1);
      return view(id);
    },

    async submitAnswer(id, text, answerFile) {
      const startedAt = Date.now();
      const session = store.readSession(id);
      if (session.status === 'finished') throw new EngineError('finished');
      const last = store.readTurns(id).at(-1);
      // 답이 이미 저장된 턴이면 앞 명령이 중간에 멈춘 것이다. 새 글은 버리고 이어 간다.
      if (last.answer === null) {
        store.writeAnswer(id, last.seq, answerOf(last, { answer: text, answeredAt: now(), analysis: null, pick: null }));
      }
      if (answerFile) store.removeAnswerFile(answerFile);
      await proceed(id);
      store.appendCall(id, { type: 'wait', seq: last.seq, wall_ms: Date.now() - startedAt });
      return view(id);
    },

    async resume(id) {
      if (!(await proceed(id))) {
        // 할 일이 없었으면 열린 질문의 뒤 작업이 남아 있는지 본다. 잠금이 잡히면 아무도 쓰고 있지 않다.
        const { open } = view(id);
        if (open && !store.readKey(id, open.seq)) {
          const release = store.acquireKeyLock(id, open.seq, staleMs);
          if (release) {
            release();
            launchCompletion(id, open.seq);
          }
        }
      }
      return view(id);
    },

    async finish(id) {
      const session = store.readSession(id);
      if (session.status !== 'finished') finishSession(id, session);
      return view(id);
    },

    // 정답지 뒤 작업. 실패는 로그에만 남기고, 답이 왔을 때 분석 전에 다시 만든다.
    async complete(id, seq) {
      try {
        if (store.readKey(id, seq)) return;
        const release = store.acquireKeyLock(id, seq, staleMs);
        if (!release) return;
        try {
          if (store.readKey(id, seq)) return;
          const { session, turns } = load(id);
          const turn = turns.find((t) => t.seq === seq);
          if (!turn) throw new Error(`턴이 없다: ${seq}`);
          await writeCompletion(id, session, turns, turn);
        } finally {
          release();
        }
      } catch (error) {
        store.logError(id, `정답지 작성(턴 ${seq})`, error);
      }
    },
  };
}
