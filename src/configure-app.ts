import { join } from 'node:path';

import type { NestExpressApplication } from '@nestjs/platform-express';

import { HttpErrorFilter } from './http/http-error.filter';

// main.ts는 import하면 서버가 열리므로, main과 테스트가 함께 쓰는 설정은 여기에 둔다.
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new HttpErrorFilter());
  // 화면 빌드 결과를 같은 origin에서 내려준다. API는 /v1 아래라 겹치지 않고, 빌드가 없어도 서버는 뜬다.
  app.useStaticAssets(join(process.cwd(), 'frontend', 'dist'));
}
