import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  schemaFilter: ['public', 'auth'],
  dbCredentials: { url: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
