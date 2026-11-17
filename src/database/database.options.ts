import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';

import type { EnvironmentVariables } from '../config/environment';

export function createDataSourceOptions(environment: EnvironmentVariables) {
  return {
    type: 'postgres',
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    username: environment.DB_USERNAME,
    password: environment.DB_PASSWORD,
    database: environment.DB_DATABASE,
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    migrationsTableName: 'typeorm_migrations',
    migrationsRun: false,
    synchronize: false,
    installExtensions: false,
  } satisfies DataSourceOptions;
}
