import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Env, ENV, loadEnv } from '../config/env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query API as the database. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

export const DB = Symbol('DB');

/**
 * `sslmode=require` / `prefer` / `verify-ca` are already treated as full verification by node-postgres and trigger a
 * deprecation warning. State it explicitly so behaviour is unchanged and logs stay clean.
 */
export function normalizeDbUrl(url: string) {
  return url.replace(/([?&])sslmode=(require|prefer|verify-ca)(?=&|$)/, '$1sslmode=verify-full');
}

export function createPool(url: string, env: Env, max = env.DATABASE_POOL_MAX) {
  return new Pool({
    connectionString: normalizeDbUrl(url),
    max,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    application_name: `lifesphere-${env.PROCESS_ROLE}`,
  });
}

@Injectable()
export class DbLifecycle implements OnModuleDestroy {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}
  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: 'PG_POOL',
      inject: [ENV],
      useFactory: (env: Env) => createPool(env.DATABASE_URL, env),
    },
    {
      provide: DB,
      inject: ['PG_POOL'],
      useFactory: (pool: Pool) => drizzle(pool, { schema, casing: 'snake_case' }),
    },
    DbLifecycle,
  ],
  exports: [DB, ENV, 'PG_POOL'],
})
export class DbModule {}

export { schema };
