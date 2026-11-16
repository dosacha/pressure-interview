import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { engineConfig } from '../config/engine.config';
import { anthropicProvider } from './llm/anthropic.provider';
import { LlmService } from './llm/llm.service';
import { TurnService } from './turn.service';

@Module({
  imports: [ConfigModule.forFeature(engineConfig)],
  providers: [anthropicProvider, LlmService, TurnService],
  exports: [LlmService, TurnService],
})
export class EngineModule {}
