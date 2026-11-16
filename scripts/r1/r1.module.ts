import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { engineConfig } from '../../src/config/engine.config';
import { EngineModule } from '../../src/interview/engine.module';

@Module({ imports: [ConfigModule.forRoot({ load: [engineConfig] }), EngineModule] })
export class R1Module {}
