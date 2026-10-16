/* Applies pending SQL migrations. Usage: npm run db:migrate */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { loadEnv } from '../config/env';
import { createPool } from './db';

export async function runMigrations(url?: string) {
  const env = loadEnv();
  const pool = createPool(url ?? env.DATABASE_DIRECT_URL ?? env.DATABASE_URL, env, 1);
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.join(__dirname, 'migrations'),
      migrationsSchema: 'drizzle',
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied');
      process.exit(0);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Migration failed:', msg);
      if (/ECONNREFUSED|ENOTFOUND/.test(msg)) console.error('Cannot reach PostgreSQL. Check DATABASE_URL in .env and that the server is running.');
      if (/Invalid environment/.test(msg)) console.error('Run `npm run setup` to generate the missing secrets.');
      process.exit(1);
    });
}
