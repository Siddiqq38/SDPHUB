import { Hono } from 'hono';
import { HttpError, originGuard, type AppEnv, type Env } from './core.ts';
import { authRoutes, bootstrapRoutes } from './routes/auth.ts';
import { memberRoutes, publicMemberRoutes } from './routes/members.ts';
import { masterRoutes } from './routes/master.ts';
import { orderRoutes } from './routes/orders.ts';
import { prodRoutes } from './routes/production.ts';
import { fileRoutes } from './routes/files.ts';
import { stockRoutes } from './routes/stock.ts';
import { financeRoutes } from './routes/finance.ts';
import { publicRoutes } from './routes/public.ts';

/** Aplikasi dibuat dengan penyedia lingkungan (DB, storage, secret) agar sama untuk Vercel, server dev, dan uji. */
export function createApp(getEnv: () => Promise<Env>) {
const app = new Hono<AppEnv>();
app.use('*', async (c, next) => {
  c.env = await getEnv();
  await next();
});

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'");
});
app.use('/api/*', originGuard);

app.route('/api/public', publicRoutes);
app.route('/api/public', publicMemberRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/bootstrap', bootstrapRoutes);
app.route('/api/applications', memberRoutes);
app.route('/api/master', masterRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/prod', prodRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/stock', stockRoutes);
app.route('/api/finance', financeRoutes);

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
  if (err instanceof Error && /^Konversi |^Tidak boleh menjumlahkan/.test(err.message)) return c.json({ error: err.message }, 400);
  if ((err as any)?.code === '23505') return c.json({ error: 'Data sudah ada atau bentrok dengan data lain' }, 409); // pelanggaran unik Postgres
  console.error('Kesalahan tak terduga:', err);
  return c.json({ error: 'Terjadi kesalahan pada server' }, 500);
});

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) return c.json({ error: 'Endpoint tidak ditemukan' }, 404);
  return c.text('Tidak ditemukan', 404);
});

return app;
}
