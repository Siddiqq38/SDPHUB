// Membundel fungsi Vercel (src/vercel.ts) menjadi api/index.mjs. Hasilnya di-commit agar Vercel selalu menemukan fungsi.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/vercel.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['pg-native'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  outfile: 'api/index.mjs',
  logLevel: 'info',
});
