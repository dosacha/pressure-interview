import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { engineConfig } from './config/engine.config';
import { validateEnvironment, type EnvironmentVariables } from './config/environment';
import { createDataSourceOptions } from './database/database.options';
import { HealthController } from './health/health.controller';
import { EngineModule } from './interview/engine.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
      load: [engineConfig],
      // 테스트가 사용자의 .env(실제 키, 바꾼 설정)에 흔들리지 않게 한다.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        ...createDataSourceOptions({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          PORT: config.get('PORT', { infer: true }),
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
          DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
          DB_DATABASE: config.get('DB_DATABASE', { infer: true }),
        }),
        autoLoadEntities: true,
      }),
    }),
    EngineModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
