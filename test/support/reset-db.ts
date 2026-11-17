import type { DataSource } from 'typeorm';

// 세션에 FK가 없는 llm_usage도 포함한다.
const TABLES: string[] = [
  'interview_turns',
  'interview_sessions',
  'assumption_records',
  'llm_usage',
];

/** e2e 전용 DB의 테이블을 모두 비운다. 다른 DB면 던진다. */
export async function resetDb(dataSource: DataSource): Promise<void> {
  const { database } = dataSource.options;
  if (database !== 'interview_e2e') {
    throw new Error('resetDb는 interview_e2e DB에서만 쓴다');
  }
  if (TABLES.length === 0) return;
  await dataSource.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
}
