import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EngineModule } from '../interview/engine.module';
import { InterviewSession } from './interview-session.entity';
import { InterviewTurn } from './interview-turn.entity';
import { InterviewService, MEMORY_SOURCE, RNG, type MemorySource } from './interview.service';

// Task 11이 실제 기억으로 바꾼다.
const emptyMemory: MemorySource = {
  snapshot: () => Promise.resolve({ retired: [], reissue: [], expected: [] }),
};

@Module({
  imports: [TypeOrmModule.forFeature([InterviewSession, InterviewTurn]), EngineModule],
  providers: [
    InterviewService,
    { provide: RNG, useValue: Math.random },
    { provide: MEMORY_SOURCE, useValue: emptyMemory },
  ],
  exports: [InterviewService, MEMORY_SOURCE],
})
export class SessionModule {}
