// Lingkungan produksi (Vercel): Postgres Supabase lewat DATABASE_URL, Supabase Storage lewat service role key.
// Semua secret hanya dibaca dari environment server; tidak pernah dikirim ke frontend.
import { makeDb, pgDriver } from './db.ts';
import { supabaseStorage } from './storage.ts';
import type { Env } from './core.ts';

let cached: Promise<Env> | undefined;

export function vercelEnv(): Promise<Env> {
  if (!cached) {
    cached = (async () => {
      const dbUrl = process.env.DATABASE_URL;
      const sbUrl = process.env.SUPABASE_URL;
      const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!dbUrl) throw new Error('DATABASE_URL belum diatur');
      if (!sbUrl || !sbKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diatur');
      return {
        DB: makeDb(await pgDriver(dbUrl)),
        FILES: await supabaseStorage(sbUrl, sbKey, process.env.SUPABASE_BUCKET || 'sdp-files'),
        BOOTSTRAP_TOKEN: process.env.BOOTSTRAP_TOKEN,
      };
    })();
    cached.catch(() => { cached = undefined; }); // coba lagi pada permintaan berikutnya bila gagal
  }
  return cached;
}
