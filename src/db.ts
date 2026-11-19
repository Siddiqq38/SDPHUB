// Lapisan data: antarmuka mirip D1 (prepare/bind/first/all/run/batch) di atas Postgres.
// Dua driver: `pg` (Supabase/Postgres sungguhan) dan PGlite (Postgres WASM untuk uji dan pengembangan lokal).

export type QueryResult = { rows: any[]; changes: number };
export interface Driver {
  query(sql: string, params: unknown[]): Promise<QueryResult>;
  transaction<T>(fn: (q: (sql: string, params: unknown[]) => Promise<QueryResult>) => Promise<T>): Promise<T>;
}

export interface RunMeta { meta: { changes: number; last_row_id: number } }
export interface Stmt {
  bind(...args: unknown[]): Stmt;
  first<T = any>(): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[] }>;
  run(): Promise<RunMeta>;
}
export interface Db {
  prepare(sql: string): Stmt;
  batch(stmts: Stmt[]): Promise<RunMeta[]>;
}

// Tabel yang punya kolom identitas `id`; INSERT ke tabel ini mengembalikan id sebagai last_row_id.
const IDENT = new Set([
  'users', 'customers', 'member_applications', 'machines', 'attendance', 'orders', 'order_items', 'artworks', 'work_orders', 'estimate_history',
  'machine_qc_reports', 'qc_results', 'material_lots', 'stock_ledger', 'handovers', 'invoices', 'payments', 'complaints', 'loss_sales', 'audit_log',
]);

/** Ubah placeholder `?` menjadi `$1..$n`, mengabaikan tanda tanya di dalam string literal. */
export function toPg(sql: string): string {
  let out = '';
  let n = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inStr && sql[i + 1] === "'") { out += "''"; i++; continue; }
      inStr = !inStr;
    }
    out += ch === '?' && !inStr ? '$' + ++n : ch;
  }
  return out;
}

const norm = (a: unknown[]) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

function finalize(sql: string): { text: string; wantId: boolean } {
  let text = toPg(sql);
  const m = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(text);
  const wantId = !!m && IDENT.has(m[1].toLowerCase()) && !/\bRETURNING\b/i.test(text);
  if (wantId) text += ' RETURNING id';
  return { text, wantId };
}

class PgStmt implements Stmt {
  d: Driver;
  sql: string;
  args: unknown[];
  constructor(d: Driver, sql: string, args: unknown[] = []) {
    this.d = d;
    this.sql = sql;
    this.args = args;
  }
  bind(...args: unknown[]): Stmt { return new PgStmt(this.d, this.sql, norm(args)); }
  async first<T = any>(): Promise<T | null> {
    const r = await this.d.query(finalize(this.sql).text, this.args);
    return (r.rows[0] as T) ?? null;
  }
  async all<T = any>(): Promise<{ results: T[] }> {
    const r = await this.d.query(finalize(this.sql).text, this.args);
    return { results: r.rows as T[] };
  }
  async run(): Promise<RunMeta> {
    const { text, wantId } = finalize(this.sql);
    const r = await this.d.query(text, this.args);
    return { meta: { changes: r.changes, last_row_id: wantId ? Number(r.rows[0]?.id ?? 0) : 0 } };
  }
  async runIn(q: (sql: string, params: unknown[]) => Promise<QueryResult>): Promise<RunMeta> {
    const { text, wantId } = finalize(this.sql);
    const r = await q(text, this.args);
    return { meta: { changes: r.changes, last_row_id: wantId ? Number(r.rows[0]?.id ?? 0) : 0 } };
  }
}

export function makeDb(driver: Driver): Db {
  return {
    prepare: (sql) => new PgStmt(driver, sql),
    batch: (stmts) =>
      driver.transaction(async (q) => {
        const out: RunMeta[] = [];
        for (const s of stmts) out.push(await (s as PgStmt).runIn(q));
        return out;
      }),
  };
}

// ---- Driver pg (Supabase / Postgres) ----
export async function pgDriver(connectionString: string): Promise<Driver> {
  const pg = await import('pg');
  const types = pg.default?.types ?? pg.types;
  types.setTypeParser(20, (v: string) => Number(v)); // int8 -> number
  types.setTypeParser(1700, (v: string) => Number(v)); // numeric -> number
  const pool = new pg.default.Pool({
    connectionString,
    max: 3,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  return {
    async query(sql, params) {
      const r = await pool.query(sql, params as any[]);
      return { rows: r.rows, changes: r.rowCount ?? 0 };
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(async (sql, params) => {
          const r = await client.query(sql, params as any[]);
          return { rows: r.rows, changes: r.rowCount ?? 0 };
        });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

// ---- Driver PGlite (uji lokal) ----
export function pgliteDriver(db: any): Driver {
  const wrap = (r: any): QueryResult => ({ rows: r.rows, changes: Number(r.affectedRows ?? 0) });
  return {
    async query(sql, params) { return wrap(await db.query(sql, params)); },
    async transaction(fn) {
      return db.transaction(async (tx: any) => fn(async (sql, params) => wrap(await tx.query(sql, params))));
    },
  };
}
