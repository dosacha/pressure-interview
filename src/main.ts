import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import type { EnvironmentVariables } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  const port = app.get(ConfigService<EnvironmentVariables, true>).get('PORT', { infer: true });
  await app.listen(port, '127.0.0.1');
}

void bootstrap();
