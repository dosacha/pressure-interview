import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';

import { UsageRecorder } from '../interview/llm/usage-recorder';
import { TurnService } from '../interview/turn.service';
import type { AssumptionResult, ReviewInput } from '../interview/types';
import { foldAssumptions } from '../memory/memory-rules';
import { MemoryService } from '../memory/memory.service';
import { InterviewSession } from '../session/interview-session.entity';
import { InterviewTurn } from '../session/interview-turn.entity';
import { ConflictError, NotFoundError, toUpstreamError } from '../session/session-errors';
import { UsageService } from '../usage/usage.service';
import {
  answerKeyOf,
  followUpsOf,
  isReviewTarget,
  memberOf,
  toReviewView,
  type ReviewView,
} from './review.view';
import { computeStats, type Stats } from './stats';

type TurnPatch = { surprise?: 'expected' | 'unexpected'; assumptionResult?: AssumptionResult };

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);
  // shortcut: 프로세스 하나를 전제한다, 서버를 여러 개 띄우게 되면 DB 잠금으로
  private readonly locks = new Map<string, Promise<unknown>>();
  // 세션별로 돌고 있는 복기 작업. 값은 거부되지 않는다.
  private readonly running = new Map<string, Promise<void>>();
  // 실패 사유는 코드만 메모리에 둔다. 원래 오류의 메시지에 응답 글자가 들어갈 수 있다.
  private readonly errors = new Map<string, NonNullable<ReviewView['error']>>();

  constructor(
    @InjectRepository(InterviewSession) private readonly sessions: Repository<InterviewSession>,
    @InjectRepository(InterviewTurn) private readonly turns: Repository<InterviewTurn>,
    private readonly engine: TurnService,
    private readonly recorder: UsageRecorder,
    private readonly memory: MemoryService,
    private readonly usage: UsageService,
  ) {}

  /** 백그라운드로 시작한다. 이미 돌고 있으면 아무것도 하지 않는다. */
  async start(sessionId: string): Promise<void> {
    await this.finishedSession(sessionId);
    if (this.running.has(sessionId)) return;
    this.errors.delete(sessionId);
    const task = this.locked(sessionId, () =>
      this.recorder.run(sessionId, () => this.work(sessionId)),
    )
      .catch((e: unknown) => {
        this.errors.set(sessionId, toUpstreamError(e).reason);
        this.log('복기 작업 실패', sessionId, e);
      })
      .finally(() => this.running.delete(sessionId));
    this.running.set(sessionId, task);
  }

  /** 테스트용: 진행 중인 작업이 끝날 때까지 기다린다. */
  async whenIdle(sessionId: string): Promise<void> {
    while (this.running.has(sessionId)) await this.running.get(sessionId);
  }

  async getView(sessionId: string): Promise<ReviewView> {
    const session = await this.finishedSession(sessionId);
    const turns = await this.turnsOf(sessionId);
    const recordIds = (await this.memory.all()).map((r) => r.id);
    await this.usage.flush();
    return toReviewView(session, turns, {
      running: this.running.has(sessionId),
      error: this.errors.get(sessionId) ?? null,
      folded: foldAssumptions(turns, recordIds),
      usage: await this.usage.summarize(sessionId),
    });
  }

  updateTurn(sessionId: string, turnId: string, patch: TurnPatch): Promise<ReviewView> {
    return this.locked(sessionId, async () => {
      const session = await this.finishedSession(sessionId);
      const turn = await this.turns.findOneBy({ id: turnId, sessionId });
      if (!turn) throw new NotFoundError(`턴이 없다: ${turnId}`);
      // 복기에 보이지 않는 턴은 고칠 수 없다. 둘 중 하나라도 안 되면 아무것도 저장하지 않는다.
      if (!isReviewTarget(turn)) throw new ConflictError('NOT_REVIEWABLE');
      let { review } = turn;
      if (patch.assumptionResult !== undefined) {
        if (turn.question.assumption.axis === 'none' || review === null)
          throw new ConflictError('NOT_REVIEWABLE');
        review = {
          ...review,
          assumption: { ...review.assumption, userResult: patch.assumptionResult },
        };
      }
      await this.turns.update(turnId, {
        ...(patch.surprise !== undefined && { surprise: patch.surprise }),
        ...(patch.assumptionResult !== undefined && { review }),
      });
      if (session.reviewedAt !== null) {
        try {
          await this.memory.syncSession(sessionId);
        } catch (e) {
          // 턴에 저장한 값은 그대로 둔다. 다시 start하면 기억을 맞춘다.
          await this.sessions.update(sessionId, { reviewedAt: null });
          this.errors.set(sessionId, 'MEMORY_SYNC_FAILED');
          this.log('기억 반영 실패', sessionId, e);
        }
      }
      return this.getView(sessionId);
    });
  }

  async stats(): Promise<Stats> {
    const sessions = await this.sessions.find({
      where: { status: 'finished' },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    const turns =
      sessions.length === 0
        ? []
        : await this.turns.find({ where: { sessionId: In(sessions.map((s) => s.id)) } });
    return computeStats(sessions, turns, await this.memory.all());
  }

  private async work(sessionId: string): Promise<void> {
    const session = await this.finishedSession(sessionId);
    const turns = await this.turnsOf(sessionId);
    const targets = turns.filter(isReviewTarget);
    const todo = targets.filter((t) => t.review === null);
    for (let i = 0; i < todo.length; i += 3)
      await Promise.all(todo.slice(i, i + 3).map((t) => this.reviewOne(session, turns, t)));

    const reviewed = await this.turnsOf(sessionId);
    if (
      session.reviewedAt !== null ||
      !reviewed.filter(isReviewTarget).every((t) => t.review !== null)
    )
      return;
    try {
      await this.memory.syncSession(sessionId);
      await this.sessions.update(sessionId, { reviewedAt: new Date() });
    } catch (e) {
      this.errors.set(sessionId, 'MEMORY_SYNC_FAILED');
      this.log('기억 반영 실패', sessionId, e);
    }
  }

  // 한 턴의 실패는 나머지를 멈추지 않는다.
  private async reviewOne(
    session: InterviewSession,
    turns: InterviewTurn[],
    t: InterviewTurn,
  ): Promise<void> {
    try {
      const { review } = await this.engine.reviewTurn(await this.reviewInput(session, turns, t));
      await this.turns.update(t.id, { review });
    } catch (e) {
      this.errors.set(session.id, toUpstreamError(e).reason);
      this.log(`턴 ${t.id} 재검사 실패`, session.id, e);
    }
  }

  private async reviewInput(
    session: InterviewSession,
    turns: InterviewTurn[],
    t: InterviewTurn,
  ): Promise<ReviewInput> {
    const { axis } = t.question.assumption;
    const knownAssumptions =
      axis === 'none'
        ? []
        : [
            ...(await this.memory.knownForAxis(axis)),
            ...turns
              .filter((o) => o.seq < t.seq && o.question.assumption.axis === axis)
              .map((o) => ({ key: `turn:${o.id}`, statement: o.question.assumption.statement })),
          ];
    return {
      topic: session.topic,
      interviewer: memberOf(session, t.interviewerId),
      cause: { reactionIntent: t.reactionIntent, defect: t.defect },
      question: { ...t.question, answerKey: answerKeyOf(t) },
      clarifications: t.clarifications.map((c) => ({ ask: c.ask, reply: c.reply })),
      answer: t.answer!,
      analysis: t.analysis!,
      followUps: followUpsOf(t, turns).map((f) => {
        if (f.reactionIntent === null || f.defect === null)
          throw new Error(`반응 의도나 결함이 없는 후속 질문이다: ${f.id}`);
        return {
          interviewerId: f.interviewerId,
          addOn: f.addOn,
          reactionIntent: f.reactionIntent,
          defect: f.defect,
          text: f.question.text,
        };
      }),
      knownAssumptions,
    };
  }

  // 진행 중인 면접에는 복기 경로가 아무 값도 주지 않는다. 숨긴 값이 면접 중에 나가지 않게 하려는 것이다.
  private async finishedSession(id: string): Promise<InterviewSession> {
    const session = await this.sessions.findOneBy({ id });
    if (!session) throw new NotFoundError(`세션이 없다: ${id}`);
    if (session.status !== 'finished') throw new ConflictError('INTERVIEW_NOT_FINISHED');
    return session;
  }

  private turnsOf(sessionId: string): Promise<InterviewTurn[]> {
    return this.turns.find({ where: { sessionId }, order: { seq: 'ASC' } });
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

  private log(what: string, sessionId: string, e: unknown): void {
    const msg = `${what}(세션 ${sessionId}): ${e instanceof Error ? e.message : String(e)}`;
    if (e instanceof Error) this.logger.warn(msg, e.stack);
    else this.logger.warn(msg);
  }
}
