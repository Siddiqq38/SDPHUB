// Menerapkan migrasi ke Postgres/Supabase: DATABASE_URL=... node scripts/migrate.mjs
// Setiap berkas dijalankan sekali dalam satu transaksi dan dicatat di schema_migrations.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL belum diatur'); process.exit(1); }
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
await client.connect();
await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  if (done.has(f)) { console.log('lewati  ', f); continue; }
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(join(dir, f), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    await client.query('COMMIT');
    console.log('diterapkan', f);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('GAGAL', f, '-', e.message);
    process.exit(1);
  }
}
await client.end();
