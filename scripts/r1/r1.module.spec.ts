import { Test } from '@nestjs/testing';
import { ANTHROPIC_CLIENT } from '../../src/interview/llm/anthropic.provider';
import { LlmService } from '../../src/interview/llm/llm.service';
import { TurnService } from '../../src/interview/turn.service';
import { R1Module } from './r1.module';

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
