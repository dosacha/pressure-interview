import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';

import { ConflictError, NotFoundError, UpstreamError } from '../session/session-errors';
import { InputError } from './input-error';

// @types/express가 없어 필요한 모양만 적는다.
interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

// 본문에는 오류의 message·stack을 싣지 않는다. 면접 중 응답에 숨긴 값이나 서버 내부가 새지 않게 하려는 것이다.
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(e: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<JsonResponse>();
    if (e instanceof InputError) {
      res.status(400).json({ error: 'INVALID_INPUT', issues: e.issues });
    } else if (e instanceof NotFoundError) {
      res.status(404).json({ error: 'NOT_FOUND' });
    } else if (e instanceof ConflictError) {
      res.status(409).json({ error: e.code });
    } else if (e instanceof UpstreamError) {
      res.status(502).json({ error: 'LLM_FAILED', reason: e.reason, category: e.category });
    } else if (e instanceof HttpException) {
      const status = e.getStatus();
      res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR' });
    } else {
      this.logger.error(
        e instanceof Error ? e.message : String(e),
        e instanceof Error ? e.stack : undefined,
      );
      res.status(500).json({ error: 'INTERNAL' });
    }
  }
}
