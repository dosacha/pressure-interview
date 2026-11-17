import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';

import { interviewConfig } from '../config/interview.config';
import type { AxisId } from '../interview/catalog';
import type { QuestionMemory } from '../interview/types';
import { InterviewSession } from '../session/interview-session.entity';
import { InterviewTurn } from '../session/interview-turn.entity';
import type { MemorySource } from '../session/interview.service';
import { AssumptionRecord } from './assumption-record.entity';
import { foldAssumptions, pendingTopics, selectMemory } from './memory-rules';

// 맞추는 동안 다루는 기록. status와 lastSeenAt은 저장할 때 만남에서 정한다.
type Draft = Pick<AssumptionRecord, 'id' | 'axis' | 'statement' | 'encounters'>;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

@Injectable()
export class MemoryService implements MemorySource {
  // shortcut: 프로세스 하나를 전제한다, 서버를 여러 개 띄우게 되면 pg_advisory_xact_lock으로
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectRepository(AssumptionRecord) private readonly records: Repository<AssumptionRecord>,
    private readonly dataSource: DataSource,
    @Inject(interviewConfig.KEY) private readonly config: ConfigType<typeof interviewConfig>,
  ) {}

  async snapshot(now: Date): Promise<QuestionMemory> {
    return selectMemory(await this.all(), now, this.config.reissueAfterHours);
  }

  async knownForAxis(axis: AxisId): Promise<{ key: string; statement: string }[]> {
    const rows = await this.records.find({
      where: { axis },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.map((r) => ({ key: r.id, statement: r.statement }));
  }

  async pendingTopics(now: Date): Promise<string[]> {
    return pendingTopics(await this.all(), now, this.config.reissueAfterHours);
  }

  all(): Promise<AssumptionRecord[]> {
    return this.records.find({ order: { createdAt: 'ASC', id: 'ASC' } });
  }

  /** 이 세션의 복기 결과로 기억을 다시 맞춘다. 여러 번 불러도 결과가 같다. */
  syncSession(sessionId: string): Promise<void> {
    // 두 세션이 같은 기록의 encounters를 동시에 통째로 바꿔 쓰면 한쪽의 만남이 사라지므로 모두 줄 세운다.
    const run = this.queue.then(() => this.sync(sessionId));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private sync(sessionId: string): Promise<void> {
    return this.dataSource.transaction(async (m) => {
      const session = await m.findOneByOrFail(InterviewSession, { id: sessionId });
      const records = await m.find(AssumptionRecord);
      const byId = new Map<string, Draft>(records.map((r) => [r.id, r]));
      const recordOfTurn = new Map<string, string>();
      for (const r of records)
        for (const e of r.encounters)
          if (e.sessionId === sessionId) recordOfTurn.set(e.turnId, r.id);

      const turns = await m.find(InterviewTurn, { where: { sessionId }, order: { seq: 'ASC' } });
      const folded = foldAssumptions(turns, [...byId.keys()]);

      const touched = new Set<Draft>();
      for (const r of records) {
        if (r.encounters.some((e) => e.sessionId === sessionId)) {
          r.encounters = r.encounters.filter((e) => e.sessionId !== sessionId);
          touched.add(r);
        }
      }
      const created = new Set<Draft>();
      for (const f of folded) {
        const id =
          f.recordId ?? f.turnIds.map((t) => recordOfTurn.get(t)).find((x) => x !== undefined);
        let record = id === undefined ? undefined : byId.get(id);
        if (!record) {
          record = { id: randomUUID(), axis: f.axis, statement: f.statement, encounters: [] };
          created.add(record);
        }
        record.encounters.push({
          sessionId,
          turnId: f.turnIds[f.turnIds.length - 1],
          topic: session.topic,
          result: f.result,
          surprise: f.surprise,
          at: f.at,
        });
        touched.add(record);
      }

      for (const r of touched) {
        if (r.encounters.length === 0) {
          await m.delete(AssumptionRecord, r.id);
          continue;
        }
        r.encounters.sort((a, b) => cmp(a.at, b.at) || cmp(a.turnId, b.turnId));
        const latest = r.encounters[r.encounters.length - 1];
        const fields = {
          encounters: r.encounters,
          status: latest.result,
          lastSeenAt: new Date(latest.at),
        };
        if (created.has(r))
          await m.insert(AssumptionRecord, {
            id: r.id,
            axis: r.axis,
            statement: r.statement,
            ...fields,
          });
        else await m.update(AssumptionRecord, r.id, fields);
      }
    });
  }
}
