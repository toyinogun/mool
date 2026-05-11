/**
 * Drizzle schema for Mool v0.4.
 *
 * Mirrors §5 of the v0.4 spec exactly. Field naming uses snake_case at the SQL
 * layer (the column names) and camelCase at the TS layer (the column accessors);
 * Drizzle handles the mapping via the second arg to each helper.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Drizzle ships a `bytea` helper indirectly via `customType`. Define once.
const bytea = customType<{ data: Buffer; notNull: true; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  tokenHash: bytea('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const signinTokens = pgTable('signin_tokens', {
  tokenHash: bytea('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recordings = pgTable('recordings', {
  slug: text('slug').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull(),
  mimeType: text('mime_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SigninToken = typeof signinTokens.$inferSelect;
export type NewSigninToken = typeof signinTokens.$inferInsert;
export type RecordingRow = typeof recordings.$inferSelect;
export type NewRecordingRow = typeof recordings.$inferInsert;
