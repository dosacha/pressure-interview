import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EngineConfig, engineConfig } from '../src/config/engine.config';
import { LlmService } from '../src/interview/llm/llm.service';
import { TurnService } from '../src/interview/turn.service';
import { R1Module } from './r1/r1.module';
import { renderReport } from './r1/report';
import { readScenarios, runScenarios } from './r1/run';

// 사용법: npm.cmd run r1 -- [시나리오id]  (id가 없으면 전부 실행)
async function main(): Promise<number> {
  const all = readScenarios(join(__dirname, 'r1', 'scenarios.json'));
  const id = process.argv[2];
  const scenarios = id === undefined ? all : all.filter((s) => s.id === id);
  if (scenarios.length === 0) {
    console.error(`없는 시나리오 id다: ${id}. 쓸 수 있는 id: ${all.map((s) => s.id).join(', ')}`);
    return 1;
  }

  const startedAt = new Date().toISOString();
  // abortOnError: false — 부팅 오류(키 누락, ENGINE_* 값 오류)가 Nest의 process.exit 대신 아래 처리기로 오게 한다.
  const app = await NestFactory.createApplicationContext(R1Module, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  try {
    const results = await runScenarios(
      { turn: app.get(TurnService), llm: app.get(LlmService), log: (line) => console.log(line) },
      scenarios,
    );
    const dir = join(__dirname, '..', 'r1-results');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${startedAt.replace(/:/g, '-')}.md`);
    const engine = app.get<EngineConfig>(engineConfig.KEY);
    writeFileSync(file, renderReport({ startedAt, results, engine }));
    console.log(`리포트: ${file}`);
    return results.some((r) => r.error !== null) ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    // 이 처리기는 메시지만 찍는다. 부팅 오류는 그 전에 Nest 로거가 스택과 함께 한 번 찍는다.
    console.error(`실행 실패: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
