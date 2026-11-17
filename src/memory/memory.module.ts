import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InterviewSession } from '../session/interview-session.entity';
import { InterviewTurn } from '../session/interview-turn.entity';
import { AssumptionRecord } from './assumption-record.entity';
import { MemoryService } from './memory.service';

// SessionModule을 import하지 않는다. SessionModule이 이 모듈을 import하므로 순환이 된다.
@Module({
  imports: [TypeOrmModule.forFeature([AssumptionRecord, InterviewSession, InterviewTurn])],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
