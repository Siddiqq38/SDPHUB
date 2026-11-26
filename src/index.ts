import { Hono } from 'hono';
import { HttpError, originGuard, type AppEnv, type Env } from './core.ts';
import { authRoutes, bootstrapRoutes } from './routes/auth.ts';
import { orderRoutes } from './routes/orders.ts';
import { opsRoutes } from './routes/ops.ts';
import { stateRoutes } from './routes/state.ts';
import { manageRoutes } from './routes/manage.ts';
import { fileRoutes } from './routes/files.ts';
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
  c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'");
});
app.use('/api/*', originGuard);

app.route('/api/public', publicRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/bootstrap', bootstrapRoutes);
app.route('/api/state', stateRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/manage', manageRoutes);
app.route('/api', opsRoutes);

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
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
