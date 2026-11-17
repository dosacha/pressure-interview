import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { ANTHROPIC_CLIENT } from '../../src/interview/llm/anthropic.provider';
import type { FakeAnthropic } from './fake-anthropic';

/** AppModule을 가짜 Anthropic 클라이언트로 올린다. overrides는 RNG 같은 provider를 바꿀 때 쓴다. */
export async function createTestApp(
  fake: FakeAnthropic,
  overrides: { provide: unknown; useValue: unknown }[] = [],
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ANTHROPIC_CLIENT)
    .useValue(fake.client);
  for (const { provide, useValue } of overrides) {
    builder = builder.overrideProvider(provide).useValue(useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
