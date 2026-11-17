import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EngineModule } from '../interview/engine.module';
import { MemoryModule } from '../memory/memory.module';
import { InterviewSession } from '../session/interview-session.entity';
import { InterviewTurn } from '../session/interview-turn.entity';
import { UsageModule } from '../usage/usage.module';
import { InsightsController } from './insights.controller';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

// SessionModule을 import하지 않는다. 필요한 엔티티만 직접 등록한다.
@Module({
  imports: [
    TypeOrmModule.forFeature([InterviewSession, InterviewTurn]),
    EngineModule,
    MemoryModule,
    UsageModule,
  ],
  controllers: [ReviewController, InsightsController],
  providers: [ReviewService],
})
export class ReviewModule {}
