import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EngineModule } from '../interview/engine.module';
import { LlmUsage } from './llm-usage.entity';
import { UsageService } from './usage.service';

@Module({
  imports: [TypeOrmModule.forFeature([LlmUsage]), EngineModule],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
