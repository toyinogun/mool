import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Recording {
  slug: string;
  r2Key: string;
  mimeType: string;
  createdAt: number;
}

export interface DB {
  insertRecording(rec: Recording): void;
  getRecording(slug: string): Recording | null;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recordings (
  slug        TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at);
`;

export function openDb(dbPath: string): DB {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insertStmt = db.prepare(
    `INSERT INTO recordings (slug, r2_key, mime_type, created_at) VALUES (?, ?, ?, ?)`
  );
  const getStmt = db.prepare(
    `SELECT slug, r2_key AS r2Key, mime_type AS mimeType, created_at AS createdAt
     FROM recordings WHERE slug = ?`
  );

  return {
    insertRecording(rec) {
      insertStmt.run(rec.slug, rec.r2Key, rec.mimeType, rec.createdAt);
    },
    getRecording(slug) {
      return (getStmt.get(slug) as Recording | undefined) ?? null;
    },
    close() {
      db.close();
    },
  };
}
