// Titik masuk fungsi Vercel (Node). Dibundel oleh `npm run build:vercel` menjadi api/index.mjs.
// getRequestListener mengubah app Hono menjadi handler Node (req, res) standar yang dipakai fungsi Vercel.
import { getRequestListener } from '@hono/node-server';
import { createApp } from './index.ts';
import { vercelEnv } from './env.ts';

const app = createApp(vercelEnv);
export default getRequestListener(app.fetch);
