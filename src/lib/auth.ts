// Hash password, token sesi, dan token acak memakai WebCrypto (tersedia di Workers dan Node).
const enc = new TextEncoder();

export const PBKDF2_ITER = 600_000; // rekomendasi OWASP untuk PBKDF2-SHA256; tersimpan per hash sehingga dapat dinaikkan kelak
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILS = 5;

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return b64url(new Uint8Array(d));
}

async function pbkdf2(password: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as any, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return { hash: b64url(hash), salt: b64url(salt), iter: PBKDF2_ITER };
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, hash: string, salt: string, iter: number): Promise<boolean> {
  const got = await pbkdf2(password, fromB64url(salt), iter);
  return timingSafeEqual(got, fromB64url(hash));
}

/** Kebijakan password minimal: 10 karakter, ada huruf dan angka. */
export function passwordProblem(p: string): string | null {
  if (typeof p !== 'string' || p.length < 10) return 'Password minimal 10 karakter';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password harus berisi huruf dan angka';
  return null;
}

export function validUsername(u: string): boolean {
  return typeof u === 'string' && /^[A-Za-z0-9._-]{3,32}$/.test(u);
}
