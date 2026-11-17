// 과금 없이 화면을 띄운다: 임시 DB + 가짜 Anthropic. 실제 API는 부르지 않는다.
// 이 파일 위쪽의 정적 import는 node 내장 모듈과 e2e-db뿐이어야 한다. AppModule은 import되는 순간
// 환경을 읽어 굳히므로, 앱 코드는 process.env를 다 건 뒤에 동적으로 불러온다.
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

import { npmRun, startE2eDb } from './e2e-db';

const PORT = 3199;
const STOP_PATH = '/__fake/stop';

async function main(): Promise<void> {
  const db = await startE2eDb();
  let closing: (() => Promise<void>) | undefined;
  let stopping: Promise<void> | undefined;
  // Windows에서는 프로세스를 강제로 죽이면 정리 코드가 돌지 않으므로 끄는 길을 둘 둔다: Ctrl+C와 GET /__fake/stop.
  const shutdown = (): Promise<void> =>
    (stopping ??= (async () => {
      await closing?.().catch((error: unknown) => console.error(`앱 종료 실패: ${String(error)}`));
      await db.down();
      process.exit(0);
    })());
  process.once('SIGINT', () => void shutdown());

  try {
    Object.assign(process.env, db.env, {
      PORT: String(PORT),
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
      ANTHROPIC_API_KEY: 'e2e-not-a-key',
    });
    if (process.env.DB_DATABASE !== 'interview_e2e') {
      throw new Error('DB_DATABASE가 interview_e2e가 아니면 시작하지 않는다');
    }
    await npmRun('migration:run', process.env);

    const { createFakeAnthropic } = await import('../test/support/fake-anthropic');
    const { createTestApp } = await import('../test/support/test-app');
    const fake = createFakeAnthropic();
    let n = 0;
    fake.on('question', () => {
      n += 1;
      const withAssumption = n % 2 === 0;
      return {
        text: withAssumption
          ? `${n}번째 질문입니다. 트래픽이 열 배로 늘어도 같은 구조를 유지할 수 있습니까?`
          : `${n}번째 질문입니다. 이 구조를 선택한 이유를 설명해 주세요.`,
        questionIntent: 'A1',
        assumption: withAssumption
          ? { axis: 'scale', statement: '트래픽이 열 배로 늘어난다' }
          : { axis: 'none', statement: '' },
      };
    });
    // 결함 판정이 화면에 보이도록 분석은 결함 하나를 적는다.
    fake.on('analyze', {
      kind: 'answer',
      defects: [{ type: 'vague', axis: 'scale', note: '규모를 숫자로 말하지 않았다' }],
      mentionedTechs: [],
      unknownTechs: [],
    });
    // 복기 화면에서 판정이 모두 보이도록 돌려 가며 준다. 결함과 질문의 index는 프롬프트에 적힌 번호 안에서 고른다.
    const DEFECT_VERDICTS = ['valid', 'misjudged'] as const;
    const REACTION_VERDICTS = ['valid_point', 'misjudgment', 'intended_test'] as const;
    const RESULTS = ['well', 'wobbly', 'wrong'] as const;
    let d = 0;
    let r = 0;
    let a = 0;
    fake.on('review', (params) => {
      const [{ content: user }] = params.messages as { content: string }[];
      const [, defectPart = '', followPart = ''] =
        user.split(/면접 중 분석의 결함:|이 답에서 나온 질문:/);
      const count = (part: string) => (part.match(/^\[\d+\] /gm) ?? []).length;
      const withAssumption = !user.includes('바뀐 가정: 없음');
      return {
        intent: { aimed: d % 2 === 0, note: '가짜 복기의 의도 판정입니다.' },
        defects: Array.from({ length: count(defectPart) }, (_, index) => ({
          index,
          verdict: DEFECT_VERDICTS[d++ % DEFECT_VERDICTS.length],
          note: '가짜 복기의 결함 판정입니다.',
        })),
        reactions: Array.from({ length: count(followPart) }, (_, index) => ({
          index,
          verdict: REACTION_VERDICTS[r++ % REACTION_VERDICTS.length],
          note: '가짜 복기의 반응 판정입니다.',
        })),
        assumption: {
          result: withAssumption ? RESULTS[a++ % RESULTS.length] : 'none',
          note: withAssumption ? '가짜 복기의 가정 판정입니다.' : '',
          sameAs: null,
        },
        keyProblems: [],
      };
    });
    const app = await createTestApp(fake);
    closing = () => app.close();
    // Nest 라우터 뒤에는 경로를 더할 수 없어, 요청을 받는 서버에서 먼저 가로챈다. src/에는 넣지 않는다.
    const server = app.getHttpServer();
    const appListeners = server.listeners('request') as RequestListener[];
    server.removeAllListeners('request');
    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== STOP_PATH) return appListeners.forEach((l) => l.call(server, req, res));
      res.setHeader('Connection', 'close');
      res.end('stopping', () => void shutdown());
    });
    await app.listen(PORT, '127.0.0.1');
    console.log(`fake app ready: http://127.0.0.1:${PORT} (끄기: Ctrl+C 또는 GET ${STOP_PATH})`);
  } catch (error) {
    console.error(`start:fake failed: ${error instanceof Error ? error.message : String(error)}`);
    await db.down();
    process.exit(1);
  }
}

void main();
