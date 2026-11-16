import type { ConfigModuleOptions } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ANTHROPIC_CLIENT } from '../../src/interview/llm/anthropic.provider';
import { LlmService } from '../../src/interview/llm/llm.service';
import { TurnService } from '../../src/interview/turn.service';
import { R1Module } from './r1.module';

// R1Module을 import할 때 forRoot가 프로젝트의 .env를 읽는다. 테스트에서는 .env를 건너뛰게 한다.
jest.mock('@nestjs/config', () => {
  const actual = jest.requireActual<typeof import('@nestjs/config')>('@nestjs/config');
  const forRoot = actual.ConfigModule.forRoot.bind(actual.ConfigModule);
  actual.ConfigModule.forRoot = (options?: ConfigModuleOptions) =>
    forRoot({ ...options, ignoreEnvFile: true });
  return actual;
});

describe('R1Module', () => {
  it('실제 클라이언트 없이 TurnService와 LlmService를 꺼낼 수 있다', async () => {
    const mod = await Test.createTestingModule({ imports: [R1Module] })
      .overrideProvider(ANTHROPIC_CLIENT)
      .useValue({})
      .compile();
    expect(mod.get(TurnService)).toBeInstanceOf(TurnService);
    expect(mod.get(LlmService)).toBeInstanceOf(LlmService);
    await mod.close();
  });
});
