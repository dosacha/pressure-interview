import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [HealthController] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health 는 200과 { status: "ok" }를 준다', async () => {
    await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
