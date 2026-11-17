import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { engineConfig } from '../config/engine.config';
import { anthropicProvider } from './llm/anthropic.provider';
import { LlmService } from './llm/llm.service';
import { UsageRecorder } from './llm/usage-recorder';
import { TurnService } from './turn.service';

@Module({
  imports: [ConfigModule.forFeature(engineConfig)],
  providers: [anthropicProvider, LlmService, UsageRecorder, TurnService],
  exports: [LlmService, UsageRecorder, TurnService],
})
export class EngineModule {}
