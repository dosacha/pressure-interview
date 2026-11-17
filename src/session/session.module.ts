import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EngineModule } from '../interview/engine.module';
import { MemoryModule } from '../memory/memory.module';
import { MemoryService } from '../memory/memory.service';
import { InterviewSession } from './interview-session.entity';
import { InterviewTurn } from './interview-turn.entity';
import { InterviewController } from './interview.controller';
import { InterviewService, MEMORY_SOURCE, RNG } from './interview.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([InterviewSession, InterviewTurn]),
    EngineModule,
    MemoryModule,
  ],
  controllers: [InterviewController],
  providers: [
    InterviewService,
    { provide: RNG, useValue: Math.random },
    { provide: MEMORY_SOURCE, useExisting: MemoryService },
  ],
  exports: [InterviewService, MEMORY_SOURCE],
})
export class SessionModule {}
