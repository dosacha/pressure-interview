import type { NestExpressApplication } from '@nestjs/platform-express';

// main.ts는 import하면 서버가 열리므로, main과 테스트가 함께 쓰는 설정은 여기에 둔다.
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('v1');
}
