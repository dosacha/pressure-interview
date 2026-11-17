import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';

import { interviewConfig } from '../config/interview.config';
import { UsageRecorder } from '../interview/llm/usage-recorder';
import { TurnService } from '../interview/turn.service';
import type {
  AnswerKeyInput,
  CompletedQuestion,
  QuestionDraft,
  QuestionInput,
  QuestionMemory,
  StoredQuestion,
} from '../interview/types';
import { InterviewSession } from './interview-session.entity';
import { InterviewTurn } from './interview-turn.entity';
import { toInterviewView, type InterviewView } from './interview.view';
import { ConflictError, NotFoundError, toUpstreamError, UpstreamError } from './session-errors';
import { chooseTargetAxis, composePanel, nextAsker, pickOpener } from './session-rules';

/** () => number. 기본 Math.random, 테스트에서 고정값으로 바꾼다. */
export const RNG = Symbol('RNG');
export const MEMORY_SOURCE = Symbol('MEMORY_SOURCE');
export interface MemorySource {
  snapshot(now: Date): Promise<QuestionMemory>;
}

// 질문과 정답지 호출에 넘기는 대화: 답한 턴마다 질문 문장과 되묻기 기록, 답.
function historyOf(turns: InterviewTurn[]): QuestionInput['history'] {
  return turns
    .filter((t) => t.answer !== null)
    .map((t) => ({
      interviewerId: t.interviewerId,
      text:
        t.question.text +
        t.clarifications.map((c) => `\n(되묻기) 지원자: ${c.ask} / 면접관: ${c.reply}`).join(''),
      answer: t.answer!,
    }));
}

// 저장된 질문에서 정답지를 뺀 초안.
function draftOf(q: StoredQuestion): QuestionDraft {
  return { text: q.text, questionIntent: q.questionIntent, assumption: q.assumption };
}

@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);
  // shortcut: 프로세스 하나를 전제한다, 서버를 여러 개 띄우게 되면 DB 잠금으로
  private readonly locks = new Map<string, Promise<unknown>>();
  // 턴 id별로 진행 중인 뒤 작업(정답지 작성과 검증). 값은 거부되지 않는다(실패는 로그만 남긴다).
  private readonly completing = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(InterviewSession) private readonly sessions: Repository<InterviewSession>,
    @InjectRepository(InterviewTurn) private readonly turns: Repository<InterviewTurn>,
    private readonly dataSource: DataSource,
    private readonly engine: TurnService,
    private readonly recorder: UsageRecorder,
    @Inject(interviewConfig.KEY) private readonly config: ConfigType<typeof interviewConfig>,
    @Inject(RNG) private readonly rng: () => number,
    @Inject(MEMORY_SOURCE) private readonly memorySource: MemorySource,
  ) {}

  async start(input: { topic: string; questionLimit?: number }): Promise<InterviewView> {
    // 사용량에 세션 id가 필요한데 세션 행은 첫 질문이 만들어진 뒤에 넣으므로 id를 먼저 정한다.
    const id = randomUUID();
    const { topic } = input;
    const questionLimit = input.questionLimit ?? this.config.questionLimit;
    const { memory, panel, opener, prepared } = await this.recorder.run(id, async () => {
      const memory = await this.memorySource.snapshot(new Date());
      const { role } = await this.call(this.engine.pickJobRole(topic));
      const panel = composePanel(role, this.rng);
      const opener = pickOpener(panel, this.rng);
      const prepared = await this.call(
        this.engine.prepareDraft({
          topic,
          interviewer: opener,
          reactionIntent: null,
          defect: null,
          targetAxis: null,
          history: [],
          userMentioned: [topic],
          feedback: [],
          avoidTechs: [],
          addOn: false,
          memory,
        }),
      );
      return { memory, panel, opener, prepared };
    });

    const turnId = randomUUID();
    await this.dataSource.transaction(async (m) => {
      await m.insert(InterviewSession, {
        id,
        topic,
        panel,
        questionLimit,
        status: 'in_progress',
        userMentioned: [topic],
        unknownTechs: [],
        pendingSecondary: null,
        memory,
      });
      await m.insert(InterviewTurn, {
        id: turnId,
        sessionId: id,
        seq: 1,
        interviewerId: opener.id,
        addOn: false,
        causeTurnId: null,
        reactionIntent: null,
        defect: null,
        targetAxis: null,
        question: { ...prepared.draft, answerKey: null },
        prepared: { flags: prepared.flags, answerKeyCorrected: false, attempts: prepared.attempts },
        verification: null,
      });
    });
    this.startCompletion(id, turnId);
    return this.getView(id);
  }

  submitAnswer(
    sessionId: string,
    input: { turnId: string; text: string; answerStartMs: number | null },
  ): Promise<InterviewView> {
    return this.locked(sessionId, async () => {
      const session = await this.findSession(sessionId);
      if (session.status === 'finished') throw new ConflictError('INTERVIEW_FINISHED');
      const last = (await this.turnsOf(sessionId)).at(-1);
      if (!last || last.id !== input.turnId || last.answer !== null)
        throw new ConflictError('TURN_NOT_OPEN');
      await this.turns.update(last.id, {
        answer: input.text,
        answeredAt: new Date(),
        // 되묻기 뒤의 재입력이 첫 입력 시간을 덮어쓰지 않게 한다.
        ...(last.answerStartMs === null ? { answerStartMs: input.answerStartMs } : {}),
      });
      await this.proceed(sessionId);
      return this.getView(sessionId);
    });
  }

  /** 실패한 단계를 다시 시도한다. */
  advance(sessionId: string): Promise<InterviewView> {
    return this.locked(sessionId, async () => {
      if (!(await this.proceed(sessionId))) throw new ConflictError('NOTHING_TO_RETRY');
      return this.getView(sessionId);
    });
  }

  /** 사용자가 일찍 끝낸다. 답이나 분석이 없는 마지막 턴은 복기에서 빠진다. */
  finish(sessionId: string): Promise<InterviewView> {
    return this.locked(sessionId, async () => {
      const session = await this.findSession(sessionId);
      if (session.status !== 'finished')
        await this.sessions.update(sessionId, { status: 'finished', finishedAt: new Date() });
      return this.getView(sessionId);
    });
  }

  async getView(sessionId: string): Promise<InterviewView> {
    const session = await this.findSession(sessionId);
    return toInterviewView(session, await this.turnsOf(sessionId));
  }

  async list(): Promise<
    { id: string; topic: string; status: string; createdAt: string; questionCount: number }[]
  > {
    const rows = await this.dataSource.query<
      { id: string; topic: string; status: string; created_at: Date; question_count: number }[]
    >(
      `SELECT s.id, s.topic, s.status, s.created_at,
         (SELECT COUNT(*) FROM interview_turns t WHERE t.session_id = s.id)::int AS question_count
       FROM interview_sessions s ORDER BY s.created_at DESC LIMIT 20`,
    );
    return rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      questionCount: r.question_count,
    }));
  }

  /** 테스트용: 진행 중인 뒤 작업(정답지 작성과 검증)이 모두 끝날 때까지 기다린다. */
  async settle(): Promise<void> {
    while (this.completing.size > 0) await Promise.all([...this.completing.values()]);
  }

  // 본체: DB를 보고 빠진 단계를 한다. 할 일이 있었으면 true.
  private proceed(sessionId: string): Promise<boolean> {
    return this.recorder.run(sessionId, async () => {
      let { session, turns, last } = await this.load(sessionId);
      if (session.status === 'finished' || last.answer === null) return false;

      if (last.analysis === null) {
        await this.analyze(session, turns);
        ({ session, turns, last } = await this.load(sessionId));
      }
      if (last.analysis?.kind === 'clarify') {
        await this.replyToClarification(session, last);
        return true;
      }
      if (turns.length >= session.questionLimit) {
        await this.sessions.update(sessionId, { status: 'finished', finishedAt: new Date() });
        return true;
      }
      await this.nextQuestion(session, turns);
      return true;
    });
  }

  private async analyze(session: InterviewSession, turns: InterviewTurn[]): Promise<void> {
    let turn = turns[turns.length - 1];
    // 분석에는 정답지가 필요하다. 뒤 작업이 돌고 있으면 기다리고, 없거나 실패했으면 지금 만든다.
    if (turn.question.answerKey === null) {
      await this.completing.get(turn.id);
      turn = await this.turns.findOneByOrFail({ id: turn.id });
      if (turn.question.answerKey === null) {
        const completed = await this.call(
          this.engine.completeQuestion(this.answerKeyInput(session, turns, turn)),
        );
        await this.applyCompletion(turn.id, completed);
        turn = await this.turns.findOneByOrFail({ id: turn.id });
      }
    }
    const { answerKey } = turn.question;
    if (answerKey === null) throw new Error(`정답지가 없는 질문이다: ${turn.id}`);
    const result = await this.call(
      this.engine.handleAnswer({
        topic: session.topic,
        panel: session.panel,
        history: turns.map((t) => t.interviewerId),
        askedBy: turn.interviewerId,
        question: { ...turn.question, answerKey },
        answer: turn.answer!,
        userMentioned: session.userMentioned,
      }),
    );
    // 되묻기여도 분석을 저장한다. 되묻기 응답이 실패했을 때 같은 입력을 다시 분석하지 않기 위해서다.
    await this.dataSource.transaction(async (m) => {
      await m.update(InterviewTurn, turn.id, { analysis: result.analysis, pick: result.pick });
      await m.update(InterviewSession, session.id, {
        userMentioned: result.userMentioned,
        unknownTechs: [...new Set([...session.unknownTechs, ...result.unknownTechs])],
      });
    });
  }

  private async replyToClarification(
    session: InterviewSession,
    turn: InterviewTurn,
  ): Promise<void> {
    const ask = turn.answer!;
    const { reply, leak } = await this.call(
      this.engine.replyToClarification({
        topic: session.topic,
        interviewer: this.member(session, turn.interviewerId),
        question: draftOf(turn.question),
        questionTechs: turn.prepared.attempts.at(-1)?.techs ?? [],
        exchanges: turn.clarifications.map((c) => ({ ask: c.ask, reply: c.reply })),
        ask,
        userMentioned: session.userMentioned,
        avoidTechs: session.unknownTechs,
      }),
    );
    // 같은 턴을 다시 열어 사용자의 답을 기다린다.
    await this.turns.update(turn.id, {
      clarifications: [...turn.clarifications, { ask, reply, leak }],
      answer: null,
      answeredAt: null,
      analysis: null,
      pick: null,
    });
  }

  private async nextQuestion(session: InterviewSession, turns: InterviewTurn[]): Promise<void> {
    const last = turns[turns.length - 1];
    if (!last.pick) throw new Error(`답 분석에 다음 질문자가 없다: ${last.id}`);
    // 결과는 질문이 만들어진 뒤에 저장한다. 실패하면 다시 시도할 때 같은 질문자가 나와야 한다.
    const next = nextAsker({
      lastTurnId: last.id,
      pick: last.pick,
      pending: session.pendingSecondary,
    });
    const nextSeq = turns.length + 1;
    const targetAxis = chooseTargetAxis({
      nextSeq,
      questionLimit: session.questionLimit,
      assumptionAxes: turns.map((t) => t.question.assumption.axis),
    });
    const prepared = await this.call(
      this.engine.prepareDraft({
        topic: session.topic,
        interviewer: this.member(session, next.choice.interviewerId),
        reactionIntent: next.choice.reactionIntent,
        defect: next.choice.defect,
        addOn: next.addOn,
        targetAxis,
        history: historyOf(turns),
        userMentioned: session.userMentioned,
        avoidTechs: session.unknownTechs,
        memory: session.memory,
        feedback: [],
      }),
    );
    const turnId = randomUUID();
    await this.dataSource.transaction(async (m) => {
      await m.insert(InterviewTurn, {
        id: turnId,
        sessionId: session.id,
        seq: nextSeq,
        interviewerId: next.choice.interviewerId,
        addOn: next.addOn,
        causeTurnId: next.causeTurnId,
        reactionIntent: next.choice.reactionIntent,
        defect: next.choice.defect,
        targetAxis,
        question: { ...prepared.draft, answerKey: null },
        prepared: { flags: prepared.flags, answerKeyCorrected: false, attempts: prepared.attempts },
        verification: null,
      });
      await m.update(InterviewSession, session.id, { pendingSecondary: next.pending });
    });
    this.startCompletion(session.id, turnId);
  }

  // 질문을 보여 준 뒤 정답지 작성과 검증을 기다리지 않고 시작한다. 세션 잠금은 잡지 않는다. 답을 처리하는 쪽이
  // 잠금을 쥔 채 이 작업을 기다리기 때문이다. 실패하면 로그만 남기고, 답이 왔을 때 분석 전에 다시 만든다.
  private startCompletion(sessionId: string, turnId: string): void {
    const task = this.recorder
      .run(sessionId, async () => {
        const { session, turns } = await this.load(sessionId);
        const turn = turns.find((t) => t.id === turnId);
        if (!turn) throw new Error(`턴이 없다: ${turnId}`);
        return this.engine.completeQuestion(this.answerKeyInput(session, turns, turn));
      })
      .then((completed) => this.applyCompletion(turnId, completed))
      .catch((e: unknown) => {
        const msg = `정답지 작성 실패(턴 ${turnId}): ${e instanceof Error ? e.message : String(e)}`;
        if (e instanceof Error) this.logger.warn(msg, e.stack);
        else this.logger.warn(msg);
      })
      .finally(() => this.completing.delete(turnId));
    this.completing.set(turnId, task);
  }

  // 정답지 작성과 검증의 결과를 반영하는 곳은 여기 하나다. 그 사이에 저장된 답 등 다른 컬럼은 건드리지 않는다.
  private async applyCompletion(turnId: string, completed: CompletedQuestion): Promise<void> {
    const turn = await this.turns.findOneByOrFail({ id: turnId });
    await this.turns.update(turnId, {
      question: { ...turn.question, answerKey: completed.question.answerKey },
      verification: completed.verification,
      prepared: { ...turn.prepared, answerKeyCorrected: completed.answerKeyCorrected },
    });
  }

  // 정답지 호출의 입력은 턴 행에서 만든다. 서버가 다시 떠도 메모리에 남은 것 없이 같은 입력이 나온다.
  private answerKeyInput(
    session: InterviewSession,
    turns: InterviewTurn[],
    turn: InterviewTurn,
  ): AnswerKeyInput {
    return {
      topic: session.topic,
      interviewer: this.member(session, turn.interviewerId),
      reactionIntent: turn.reactionIntent,
      defect: turn.defect,
      addOn: turn.addOn,
      history: historyOf(turns.filter((t) => t.seq < turn.seq)),
      draft: draftOf(turn.question),
    };
  }

  private locked<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(sessionId) ?? Promise.resolve()).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(sessionId, tail);
    void tail.then(() => {
      if (this.locks.get(sessionId) === tail) this.locks.delete(sessionId);
    });
    return run;
  }

  // 원래 오류는 서버 로그에만 남긴다. 메시지에 응답 글자(질문과 정답지)가 들어갈 수 있다.
  private upstream(e: unknown): UpstreamError {
    const error = toUpstreamError(e);
    if (e instanceof Error) this.logger.error(`${error.message}: ${e.message}`, e.stack);
    else this.logger.error(`${error.message}: ${String(e)}`);
    return error;
  }

  private call<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw this.upstream(e);
    });
  }

  private member(session: InterviewSession, interviewerId: string) {
    const m = session.panel.find((p) => p.id === interviewerId);
    if (!m) throw new Error(`패널에 없는 면접관이다: ${interviewerId}`);
    return m;
  }

  private async findSession(id: string): Promise<InterviewSession> {
    const session = await this.sessions.findOneBy({ id });
    if (!session) throw new NotFoundError(`세션이 없다: ${id}`);
    return session;
  }

  private turnsOf(sessionId: string): Promise<InterviewTurn[]> {
    return this.turns.find({ where: { sessionId }, order: { seq: 'ASC' } });
  }

  private async load(sessionId: string) {
    const session = await this.findSession(sessionId);
    const turns = await this.turnsOf(sessionId);
    return { session, turns, last: turns[turns.length - 1] };
  }
}
