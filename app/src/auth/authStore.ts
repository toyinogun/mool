/**
 * AuthStore — the port that wraps all auth-related DB access.
 *
 * Two implementations:
 *   - `createPostgresAuthStore({db})` — backed by Drizzle on the four-table
 *     schema (see `src/db/schema.ts`).
 *   - `createInMemoryAuthStore({now})` — a deterministic in-memory impl used
 *     by tests. The `now` injection lets tests assert exact timestamps.
 *
 * Both impls implement the same interface; consumers depend on the interface,
 * not the impl. See ADR-0018.
 */

import { randomUUID } from 'node:crypto';
import { eq, and, isNull, lt, gte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import * as schema from '../db/schema';

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRow {
  tokenHash: Buffer;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SigninTokenRow {
  tokenHash: Buffer;
  email: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface SessionWithUser {
  expiresAt: Date;
  user: User;
}

export interface AuthStore {
  upsertUserByEmail(args: { email: string; displayName: string }): Promise<User>;
  findUserById(id: string): Promise<User | null>;

  insertSigninToken(args: { tokenHash: Buffer; email: string; expiresAt: Date }): Promise<void>;
  findSigninTokenByHash(hash: Buffer): Promise<SigninTokenRow | null>;
  consumeSigninToken(hash: Buffer): Promise<void>;
  deleteUnconsumedSigninTokensForEmail(email: string): Promise<void>;

  insertSession(args: { tokenHash: Buffer; userId: string; expiresAt: Date }): Promise<void>;
  findSessionByHash(hash: Buffer): Promise<SessionWithUser | null>;
  deleteSession(hash: Buffer): Promise<void>;

  deleteExpired(args: { cutoff: Date }): Promise<{ sessions: number; signinTokens: number }>;
}

// ---------- in-memory impl ----------

export function createInMemoryAuthStore(opts: { now?: () => Date } = {}): AuthStore {
  const now = opts.now ?? (() => new Date());
  const users = new Map<string, User>();
  const usersByEmail = new Map<string, string>();
  const sessions = new Map<string, SessionRow>(); // key: tokenHash.toString('hex')
  const signinTokens = new Map<string, SigninTokenRow>();

  const hashKey = (b: Buffer) => b.toString('hex');

  return {
    async upsertUserByEmail({ email, displayName }) {
      const existing = usersByEmail.get(email);
      if (existing) {
        const updated = { ...users.get(existing)!, updatedAt: now() };
        users.set(existing, updated);
        return updated;
      }
      const id = randomUUID();
      const user: User = { id, email, displayName, createdAt: now(), updatedAt: now() };
      users.set(id, user);
      usersByEmail.set(email, id);
      return user;
    },
    async findUserById(id) { return users.get(id) ?? null; },

    async insertSigninToken({ tokenHash, email, expiresAt }) {
      signinTokens.set(hashKey(tokenHash), { tokenHash, email, expiresAt, consumedAt: null, createdAt: now() });
    },
    async findSigninTokenByHash(hash) { return signinTokens.get(hashKey(hash)) ?? null; },
    async consumeSigninToken(hash) {
      const row = signinTokens.get(hashKey(hash));
      if (row) row.consumedAt = now();
    },
    async deleteUnconsumedSigninTokensForEmail(email) {
      for (const [k, row] of signinTokens) {
        if (row.email === email && row.consumedAt === null) signinTokens.delete(k);
      }
    },

    async insertSession({ tokenHash, userId, expiresAt }) {
      sessions.set(hashKey(tokenHash), { tokenHash, userId, expiresAt, createdAt: now() });
    },
    async findSessionByHash(hash) {
      const row = sessions.get(hashKey(hash));
      if (!row) return null;
      if (row.expiresAt < now()) return null;
      const user = users.get(row.userId);
      if (!user) return null;
      return { expiresAt: row.expiresAt, user };
    },
    async deleteSession(hash) { sessions.delete(hashKey(hash)); },

    async deleteExpired({ cutoff }) {
      let s = 0, t = 0;
      for (const [k, row] of sessions) if (row.expiresAt < cutoff) { sessions.delete(k); s++; }
      for (const [k, row] of signinTokens) if (row.expiresAt < cutoff) { signinTokens.delete(k); t++; }
      return { sessions: s, signinTokens: t };
    },
  };
}

// ---------- Postgres impl ----------

export function createPostgresAuthStore({ db }: { db: Db }): AuthStore {
  return {
    async upsertUserByEmail({ email, displayName }) {
      const [row] = await db
        .insert(schema.users)
        .values({ email, displayName })
        .onConflictDoUpdate({
          target: schema.users.email,
          set: { updatedAt: new Date() },
        })
        .returning();
      return row;
    },
    async findUserById(id) {
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
      return row ?? null;
    },

    async insertSigninToken({ tokenHash, email, expiresAt }) {
      await db.insert(schema.signinTokens).values({ tokenHash, email, expiresAt });
    },
    async findSigninTokenByHash(hash) {
      const [row] = await db
        .select()
        .from(schema.signinTokens)
        .where(eq(schema.signinTokens.tokenHash, hash));
      return row ?? null;
    },
    async consumeSigninToken(hash) {
      await db
        .update(schema.signinTokens)
        .set({ consumedAt: new Date() })
        .where(eq(schema.signinTokens.tokenHash, hash));
    },
    async deleteUnconsumedSigninTokensForEmail(email) {
      await db
        .delete(schema.signinTokens)
        .where(and(eq(schema.signinTokens.email, email), isNull(schema.signinTokens.consumedAt)));
    },

    async insertSession({ tokenHash, userId, expiresAt }) {
      await db.insert(schema.sessions).values({ tokenHash, userId, expiresAt });
    },
    async findSessionByHash(hash) {
      const [row] = await db
        .select({
          expiresAt: schema.sessions.expiresAt,
          user: schema.users,
        })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(and(
          eq(schema.sessions.tokenHash, hash),
          gte(schema.sessions.expiresAt, sql`NOW()`),
        ));
      return row ?? null;
    },
    async deleteSession(hash) {
      await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hash));
    },

    async deleteExpired({ cutoff }) {
      const s = await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, cutoff)).returning();
      const t = await db.delete(schema.signinTokens).where(lt(schema.signinTokens.expiresAt, cutoff)).returning();
      return { sessions: s.length, signinTokens: t.length };
    },
  };
}
