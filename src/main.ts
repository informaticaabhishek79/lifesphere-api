import 'reflect-metadata';

// Cross-platform role selection: `node dist/main.js --role=worker` works on Windows, macOS and Linux.
// Must run before any module that reads the environment is loaded.
const roleArg = process.argv.find((a) => a.startsWith('--role='));
if (roleArg) process.env.PROCESS_ROLE = roleArg.split('=')[1];

async function main() {
  const { loadEnv } = await import('./config/env');
  const env = loadEnv();
  if (env.PROCESS_ROLE === 'worker') {
    const { startWorker } = await import('./worker');
    await startWorker();
    return;
  }
  const { createApp } = await import('./bootstrap');
  const app = await createApp();
  await app.listen(env.PORT, '0.0.0.0');
  console.log(`LifeSphere API listening on http://localhost:${env.PORT} (role=${env.PROCESS_ROLE}) — docs at /docs`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  if (/ECONNREFUSED|ENOTFOUND|getaddrinfo/.test(msg)) {
    console.error('\nCannot reach PostgreSQL. Check DATABASE_URL in .env and that the database server is running.');
    console.error('Local: install PostgreSQL 15+ (or `docker compose up -d postgres`). Cloud: paste your Neon connection string.');
  } else if (/does not exist/.test(msg)) {
    console.error('\nThe database in DATABASE_URL does not exist yet. Create it, then run `npm run db:migrate`.');
  } else if (/password authentication failed/.test(msg)) {
    console.error('\nWrong database user or password in DATABASE_URL.');
  }
  process.exit(1);
});
