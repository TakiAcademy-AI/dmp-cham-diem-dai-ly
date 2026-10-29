import path from 'node:path';
import fs from 'node:fs';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type DB = PgDatabase<any, typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export { schema };

const MIGRATIONS = path.resolve(__dirname, '../../drizzle');

/**
 * Kết nối DB. Có DATABASE_URL (postgres://...) → PostgreSQL thật qua node-postgres.
 * Không có → PGlite (PostgreSQL nhúng) lưu ở PGLITE_DIR (mặc định apps/api/.data/pg; "memory://" cho test).
 */
export async function createDb(opts: { url?: string; pgliteDir?: string } = {}): Promise<{ db: DB; close: () => Promise<void>; kind: string }> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as DB, close: () => pool.end(), kind: 'postgres' };
  }
  const dir = opts.pgliteDir ?? process.env.PGLITE_DIR ?? path.resolve(__dirname, '../../.data/pg');
  if (!dir.startsWith('memory://')) fs.mkdirSync(dir, { recursive: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as DB, close: () => client.close(), kind: 'pglite' };
}
