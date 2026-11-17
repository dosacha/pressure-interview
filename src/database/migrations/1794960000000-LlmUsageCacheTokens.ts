import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LlmUsageCacheTokens1794960000000 implements MigrationInterface {
  name = 'LlmUsageCacheTokens1794960000000';

  // 이미 있는 행은 0이 된다. 캐싱을 쓰기 전의 호출이라 사실과 맞다.
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE public.llm_usage
      ADD COLUMN cache_creation_input_tokens integer NOT NULL DEFAULT 0 CHECK (cache_creation_input_tokens >= 0),
      ADD COLUMN cache_read_input_tokens integer NOT NULL DEFAULT 0 CHECK (cache_read_input_tokens >= 0)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE public.llm_usage
      DROP COLUMN cache_creation_input_tokens,
      DROP COLUMN cache_read_input_tokens`);
  }
}
