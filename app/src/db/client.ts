/**
 * Postgres connection + migration helpers.
 *
 * The composition root (`server.ts`) constructs one of these per process and
 * threads the `db` through `compose.ts`. Tests do not call into this module —
 * the data-layer ports (`AuthStore`, `Recordings`) have in-memory test impls
 * that bypass Drizzle entirely (see ADR-0018).
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return {
    db,
    close: async () => { await pool.end(); },
  };
}

export async function runMigrations(db: Db, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}
