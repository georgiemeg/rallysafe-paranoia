import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: process.env.DB_SSL_VERIFY !== "false" },
      max: 4,
    });
  }
  return pool;
}

let schemaEnsured = false;

export async function ensureUserSchema() {
  // Run the (idempotent) DDL once per process instead of on every auth request.
  if (schemaEnsured) return;
  schemaEnsured = true;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username_normalized TEXT UNIQUE NOT NULL,
      username_display TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      contact_preference TEXT,
      can_gamble BOOLEAN NOT NULL DEFAULT FALSE,
      role TEXT NOT NULL DEFAULT 'user',
      created_at BIGINT NOT NULL,
      last_login_at BIGINT,
      poker_wins INT NOT NULL DEFAULT 0,
      poker_losses INT NOT NULL DEFAULT 0,
      style_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
      cloud JSONB
    );
    CREATE TABLE IF NOT EXISTS change_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      type TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      ip TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );
  `);
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_year INT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_bytes BYTEA;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_mime TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ewrc_id INT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ewrc_kind TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ewrc_claim_status TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS payload TEXT;
  `);
}
