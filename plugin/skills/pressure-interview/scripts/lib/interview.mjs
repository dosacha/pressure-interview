// 앱(aeae0dd)의 src/session/interview.service.ts를 손으로 옮긴 것이다. 앱과 다른 곳: 저장은 DB 대신 store의 파일이고,
// 세션 잠금이 없고(한 세션이 한 번에 명령 하나를 돌린다), 정답지는 key.lock을 쥔 쪽만 쓴다.
import { ROLES } from './app/interview/catalog.mjs';
import { selectMemory } from './app/memory/memory-rules.mjs';
import { CLOSING_TEXT, composePanel } from './app/session/session-rules.mjs';
import { EngineError } from './errors.mjs';
import { areaStatus, checkJudgment, pickNextArea, pickOpenerFor, threadsOf } from './thread.mjs';
import { TurnService } from './turn.service.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAP_STEP = 30;
const DEEPEN_NOTE = '직전 답은 핵심을 원리로 맞게 설명했다. 같은 가정에서 한 단계 더 깊이 묻는다.';

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
    askedUnknown: turn.askedUnknown,
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
    store.writeAnswer(
      id,
      turn.seq,
      answerOf(turn, { analysis: result.analysis, pick: result.pick, askedUnknown: result.askedUnknown }),
    );
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
      askedUnknown: null,
    });
  }

  // 질문 하나를 만들어 쓴다. 정답지 뒤 작업은 부르는 쪽이 띄운다(시작은 세션을 쓴 뒤에 띄운다).
  async function ask(id, session, turns, turn, interviewer, opening) {
    const seq = turns.length + 1;
    const prepared = await engine(id).prepareDraft({
      topic: session.topic,
      interviewer,
      reactionIntent: turn.reactionIntent,
      defect: turn.defect,
      opening,
      history: historyOf(turns),
      userMentioned: session.userMentioned,
      avoidTechs: session.unknownTechs,
      memory: session.memory,
      feedback: [],
    });
    store.writeQuestion(id, seq, questionFile(prepared, { interviewerId: interviewer.id, ...turn }));
    return seq;
  }

  // 새 줄기의 여는 질문. 영역의 축을 맡은 면접관이 반응 의도 없이 연다.
  function openThread(id, session, turns, areaId, direction) {
    const area = session.topicMap.areas.find((a) => a.id === areaId);
    const opener = pickOpenerFor({
      area,
      panel: session.panel,
      history: turns.map((t) => t.interviewerId),
      maxConsecutive: config.maxConsecutive,
    });
    const no = (turns.at(-1)?.thread?.no ?? 0) + 1;
    return ask(
      id,
      session,
      turns,
      { causeTurnId: null, reactionIntent: null, defect: null, thread: { no, role: 'open', areaId, followKind: null } },
      opener,
      { area: { name: area.name, axis: area.axis, angles: area.angles }, direction },
    );
  }

  // 같은 줄기의 꼬리질문 하나. 심화는 연 사람이, 결함은 그 결함을 맡은 사람(pickNext)이 묻는다.
  function followUp(id, session, turns, thread) {
    const opened = turns.find((t) => t.seq === thread.openSeq);
    let choice;
    if (thread.followKind === 'deepen') {
      const { axis } = session.topicMap.areas.find((a) => a.id === thread.areaId);
      choice = { interviewerId: opened.interviewerId, reactionIntent: 'B1', defect: { type: 'none', axis, note: DEEPEN_NOTE } };
    } else {
      if (!opened.pick) throw new Error(`답 분석에 다음 질문자가 없다: ${opened.id}`);
      choice = opened.pick;
    }
    return ask(
      id,
      session,
      turns,
      {
        causeTurnId: opened.id,
        reactionIntent: choice.reactionIntent,
        defect: choice.defect,
        thread: { no: thread.no, role: 'follow', areaId: thread.areaId, followKind: thread.followKind },
      },
      member(session, choice.interviewerId),
      null,
    );
  }

  // 닫힌 줄기의 마지막 턴에 판정을 남긴다. 판정에는 장부만 넘기고 답의 전문은 넘기지 않는다.
  async function judge(id, session, turns, threads, seq) {
    const textOf = (s) => (s === null ? null : turns.find((t) => t.seq === s).question.text);
    const ledger = threads.map((t) => ({
      no: t.no,
      areaId: t.areaId,
      openText: textOf(t.openSeq),
      followText: textOf(t.followSeq),
      followKind: t.followKind,
      openScore: t.openScore,
      followScore: t.followScore,
      score: t.score,
      signals: t.signals,
      depthLimit: t.depthLimit,
      unknownPremise: t.unknownPremise,
    }));
    const { topicMap } = session;
    const status = areaStatus(topicMap, threads);
    const { judgment } = await engine(id).judgeEnd({
      topic: session.topic,
      topicMap,
      ledger,
      unaskedAreaIds: topicMap.areas.filter((a) => !status[a.id].asked).map((a) => a.id),
    });
    const result = { judgment, checked: checkJudgment({ judgment, topicMap, threads }), at: now() };
    store.writeJudge(id, seq, result);
    return result;
  }

  function finishSession(id, session, end) {
    store.writeSession(id, { ...session, status: 'finished', finishedAt: now(), end });
  }

  function assertCurrent(session) {
    if (!session.topicMap) throw new EngineError('legacy_interview');
  }

  // 파일을 보고 빠진 단계를 한다. 할 일이 있었으면 true.
  async function proceed(id) {
    let { session, turns, last } = load(id);
    if (session.status === 'finished' || session.capPending || last.answer === null) return false;
    if (last.analysis === null) {
      await analyze(id, session, turns);
      ({ session, turns, last } = load(id));
    }
    if (last.analysis.kind === 'clarify') {
      await replyToClarification(id, session, last);
      return true;
    }
    const threads = threadsOf(turns);
    const thread = threads.find((t) => t.no === last.thread.no);
    let next = null;
    if (thread.closed) {
      // 판정이 남아 있으면 다시 부르지 않는다. 판정이 실패한 뒤 다시 하면 판정부터 한다.
      const { judgment, checked } = store.readJudge(id, last.seq) ?? (await judge(id, session, turns, threads, last.seq));
      if (checked.decision !== 'continue') {
        finishSession(id, session, { by: 'claude', decision: checked.decision, judgeSeq: last.seq });
        return true;
      }
      // 코드가 영역을 바꿨으면 판정의 방향은 다른 영역의 것이다.
      next = { areaId: checked.nextAreaId, direction: checked.nextAreaId === judgment.nextArea ? judgment.direction : '' };
    }
    if (turns.length + 1 > session.questionCap) {
      store.writeSession(id, { ...session, capPending: true });
      return true;
    }
    const seq = next
      ? await openThread(id, session, turns, next.areaId, next.direction)
      : await followUp(id, session, turns, thread);
    launchCompletion(id, seq);
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
      turnCount: turns.length,
      capPending: session.capPending ?? false,
      end: session.end ?? null,
      open: open && {
        seq: open.seq,
        roleName: ROLES[member(session, open.interviewerId).role].name,
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

    async start({ topic, replace = false }) {
      const old = current();
      if (old !== null && !replace) throw new EngineError('interview_open');
      const createdAt = now();
      // 호출 기록을 남길 곳이 있어야 하므로 폴더를 먼저 만든다. session.json이 없는 폴더는 면접으로 치지 않는다.
      const id = store.createInterview(topic, createdAt);
      const memory = selectMemory(store.readMemory(), createdAt, config.reissueAfterHours);
      const turnService = engine(id);
      const [{ role }, { topicMap }] = await Promise.all([turnService.pickJobRole(topic), turnService.pickTopicMap(topic)]);
      const session = {
        id,
        topic,
        panel: composePanel(role, rng),
        topicMap,
        questionCap: config.questionCap,
        capPending: false,
        end: null,
        status: 'in_progress',
        userMentioned: [topic],
        unknownTechs: [],
        memory,
        createdAt,
        finishedAt: null,
        reviewedAt: null,
      };
      // 질문을 먼저 쓰고 세션을 쓴다. 세션이 있으면 턴도 있다. 하던 면접은 새 면접이 준비된 뒤에 끝낸다.
      await openThread(id, session, [], pickNextArea({ wanted: null, topicMap, threads: [] }), '');
      if (old !== null) finishSession(old, store.readSession(old), { by: 'replaced' });
      store.writeSession(id, session);
      launchCompletion(id, 1);
      return view(id);
    },

    async submitAnswer(id, text, answerFile) {
      const startedAt = Date.now();
      const session = store.readSession(id);
      if (session.status === 'finished') throw new EngineError('finished');
      // 공백을 뺀 "끝"만 끝내기다. 답으로 저장하지 않는다. 예전 면접도 이렇게 끝낼 수 있다.
      if (text?.trim() === '끝') {
        if (answerFile) store.removeAnswerFile(answerFile);
        finishSession(id, session, { by: 'user' });
        return view(id);
      }
      assertCurrent(session);
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
      const session = store.readSession(id);
      if (session.status !== 'finished') assertCurrent(session);
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

    // 안전장치에서 이어 하기. 상한을 늘리고, 멈춘 곳(다음 줄기나 꼬리질문)부터 잇는다.
    async continueAfterCap(id) {
      const session = store.readSession(id);
      if (session.status === 'finished') throw new EngineError('finished');
      assertCurrent(session);
      if (session.capPending) store.writeSession(id, { ...session, questionCap: session.questionCap + CAP_STEP, capPending: false });
      await proceed(id);
      return view(id);
    },

    async finish(id, by = 'user') {
      const session = store.readSession(id);
      if (session.status !== 'finished') finishSession(id, session, { by });
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
