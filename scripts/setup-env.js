#!/usr/bin/env node
// Creates .env from .env.example (if missing) and fills JWT_SECRET, HASH_PEPPER, ENCRYPTION_KEY and
// WEBHOOK_SECRET with fresh random values when they are empty. Works on Windows, macOS and Linux.
// Usage: npm run setup            (keeps any values you already set)
//        npm run setup -- --db=postgres://user:pass@host:5432/db   (also sets DATABASE_URL + DATABASE_DIRECT_URL)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(examplePath, envPath);
  console.log('Created .env from .env.example');
}
let text = fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n');

const generated = {
  JWT_SECRET: () => crypto.randomBytes(48).toString('hex'),
  HASH_PEPPER: () => crypto.randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: () => crypto.randomBytes(32).toString('base64'),
  WEBHOOK_SECRET: () => crypto.randomBytes(24).toString('hex'),
};

function get(key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].replace(/\s+#.*$/, '').trim() : undefined;
}
function set(key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
}

for (const [key, make] of Object.entries(generated)) {
  const v = get(key);
  const placeholder = !v || v === 'change-me-webhook-secret';
  const invalidKey = key === 'ENCRYPTION_KEY' && v && Buffer.from(v, 'base64').length !== 32;
  if (placeholder || invalidKey) {
    set(key, make());
    console.log(`Generated ${key}`);
  } else {
    console.log(`Kept existing ${key}`);
  }
}

const db = process.argv.find((a) => a.startsWith('--db='));
if (db) {
  const url = db.slice(5);
  set('DATABASE_URL', url);
  set('DATABASE_DIRECT_URL', url.replace('-pooler.', '.'));
  if (/neon\.tech|sslmode=require/.test(url)) set('DATABASE_SSL', 'true');
  console.log('Set DATABASE_URL and DATABASE_DIRECT_URL');
}

fs.writeFileSync(envPath, text.endsWith('\n') ? text : `${text}\n`);
const masked = (get('DATABASE_URL') || '').replace(/\/\/([^:/@]+):[^@]*@/, '//$1:****@');
console.log(`\n.env ready. Database: ${masked}`);
console.log('Next: npm run db:migrate && npm run db:seed && npm run dev:all');
