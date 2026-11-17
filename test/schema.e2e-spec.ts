import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, type Repository } from 'typeorm';

import { InterviewSession } from '../src/session/interview-session.entity';
import { InterviewTurn } from '../src/session/interview-turn.entity';
import { LlmUsage } from '../src/usage/llm-usage.entity';
import type { PanelMember, Question } from '../src/interview/types';
import { createFakeAnthropic } from './support/fake-anthropic';
import { resetDb } from './support/reset-db';
import { createTestApp } from './support/test-app';

const panel: PanelMember[] = [
  { id: 'p1', role: 'backend', temperament: 'cold' },
  { id: 'p2', role: 'infra', temperament: 'warm' },
] as unknown as PanelMember[];

const question = {
  text: '질문',
  questionIntent: 'probe',
  assumption: { axis: 'none', statement: '' },
  answerKey: { vanishing: [], remaining: [], alternatives: [], keyPoints: ['a', 'b'] },
} as unknown as Question;

const prepared = {
  flags: { leak: false, premise: false },
  answerKeyCorrected: false,
  attempts: [],
};

describe('면접 스키마', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let sessions: Repository<InterviewSession>;
  let turns: Repository<InterviewTurn>;
  let usage: Repository<LlmUsage>;

  const newSession = (over: Partial<InterviewSession> = {}) =>
    sessions.save(
      sessions.create({
        topic: 'Redis',
        panel,
        questionLimit: 6,
        status: 'in_progress',
        userMentioned: ['Redis'],
        unknownTechs: [],
        pendingSecondary: null,
        memory: { retired: [], reissue: [], expected: [] },
        ...over,
      }),
    );

  beforeAll(async () => {
    app = await createTestApp(createFakeAnthropic());
    dataSource = app.get(DataSource);
    sessions = dataSource.getRepository(InterviewSession);
    turns = dataSource.getRepository(InterviewTurn);
    usage = dataSource.getRepository(LlmUsage);
  });

  beforeEach(async () => {
    await resetDb(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('세션과 턴을 저장하고 jsonb를 그대로 읽는다', async () => {
    const s = await newSession();
    const t = await turns.save(
      turns.create({ sessionId: s.id, seq: 1, interviewerId: 'p1', question, prepared }),
    );
    const read = await turns.findOneByOrFail({ id: t.id });
    expect(read.question.answerKey.keyPoints).toEqual(question.answerKey.keyPoints);
    expect(read.clarifications).toEqual([]);
    expect(read.addOn).toBe(false);
    expect(read.causeTurnId).toBeNull();
    const readSession = await sessions.findOneByOrFail({ id: s.id });
    expect(readSession.panel).toEqual(panel);
    expect(readSession.unknownTechs).toEqual([]);
  });

  it('정한 id로 세션을 insert할 수 있다', async () => {
    const id = randomUUID();
    await sessions.insert({
      id,
      topic: 'Kafka',
      panel,
      questionLimit: 4,
      status: 'in_progress',
      userMentioned: [],
      pendingSecondary: null,
      memory: { retired: [], reissue: [], expected: [] },
    });
    const read = await sessions.findOneBy({ id });
    expect(read?.topic).toBe('Kafka');
    expect(read?.unknownTechs).toEqual([]);
  });

  it('같은 세션에 같은 seq를 두 번 넣지 못한다', async () => {
    const s = await newSession();
    const make = () =>
      turns.insert({ sessionId: s.id, seq: 1, interviewerId: 'p1', question, prepared });
    await make();
    await expect(make()).rejects.toThrow();
  });

  it('세션을 지우면 턴이 함께 지워진다', async () => {
    const s = await newSession();
    await turns.insert({ sessionId: s.id, seq: 1, interviewerId: 'p1', question, prepared });
    await sessions.delete({ id: s.id });
    expect(await turns.count()).toBe(0);
  });

  it('세션 행이 없는 session_id로도 사용량을 넣을 수 있다', async () => {
    const sessionId = randomUUID();
    await usage.insert({
      sessionId,
      callRole: 'question',
      model: 'm',
      inputTokens: 1,
      outputTokens: 2,
    });
    const rows = await usage.findBy({ sessionId });
    expect(rows).toHaveLength(1);
    expect(rows[0].fallback).toBe(false);
  });

  it('status가 목록 밖이거나 question_limit이 1이면 거절된다', async () => {
    await expect(newSession({ status: 'paused' as unknown as 'finished' })).rejects.toThrow();
    await expect(newSession({ questionLimit: 1 })).rejects.toThrow();
  });

  it('update는 준 컬럼만 바꾼다', async () => {
    const s = await newSession();
    const verification = { premiseOk: true, problems: [], answerKey: question.answerKey };
    const t = await turns.save(
      turns.create({
        sessionId: s.id,
        seq: 1,
        interviewerId: 'p1',
        question,
        prepared,
        verification,
      }),
    );
    await turns.update(t.id, { answer: 'a' });
    const read = await turns.findOneByOrFail({ id: t.id });
    expect(read.answer).toBe('a');
    expect(read.verification).toEqual(verification);
    expect(read.question).toEqual(question);
    expect(read.clarifications).toEqual([]);
    expect(read.seq).toBe(1);
  });
});
