import { env } from "cloudflare:workers";

let ready: Promise<void> | null = null;

export function database() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export function ensureDatabase() {
  if (ready) return ready;
  ready = (async () => {
    const db = database();
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS businesses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        employee_join_code TEXT UNIQUE,
        created_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        initials TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'green',
        email TEXT,
        access_code_hash TEXT,
        password_hash TEXT,
        hourly_rate_cents INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS owners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS time_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        clock_in INTEGER NOT NULL,
        clock_out INTEGER,
        note TEXT
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS employee_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        amount_cents INTEGER NOT NULL,
        paid_at INTEGER NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS published_schedule_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        date TEXT NOT NULL,
        start_minutes INTEGER NOT NULL,
        end_minutes INTEGER NOT NULL,
        break_minutes INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        published_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS published_owner_schedule_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        owner_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        start_minutes INTEGER NOT NULL,
        end_minutes INTEGER NOT NULL,
        break_minutes INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        published_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS app_sessions (
        token_hash TEXT PRIMARY KEY,
        access TEXT NOT NULL,
        employee_id INTEGER REFERENCES employees(id),
        owner_id INTEGER REFERENCES owners(id),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT PRIMARY KEY,
        failures INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        conversation_id TEXT NOT NULL DEFAULT 'managers',
        sender_type TEXT NOT NULL,
        sender_id INTEGER NOT NULL DEFAULT 0,
        sender_name TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS message_reactions (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        business_id TEXT NOT NULL,
        reactor_type TEXT NOT NULL,
        reactor_id INTEGER NOT NULL DEFAULT 0,
        emoji TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, reactor_type, reactor_id, emoji)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS message_reads (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        business_id TEXT NOT NULL,
        reader_type TEXT NOT NULL,
        reader_id INTEGER NOT NULL DEFAULT 0,
        reader_name TEXT NOT NULL,
        read_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, reader_type, reader_id)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS message_presence (
        business_id TEXT NOT NULL,
        user_type TEXT NOT NULL,
        user_id INTEGER NOT NULL DEFAULT 0,
        user_name TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (business_id, user_type, user_id)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS plaid_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id),
        item_id TEXT NOT NULL,
        institution_name TEXT,
        institution_id TEXT,
        connected_at INTEGER NOT NULL
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS time_entries_employee_idx ON time_entries(employee_id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS time_entries_clock_in_idx ON time_entries(clock_in)"),
      db.prepare("CREATE INDEX IF NOT EXISTS employee_payments_employee_idx ON employee_payments(employee_id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS published_schedule_business_date_idx ON published_schedule_shifts(business_id, date)"),
      db.prepare("CREATE INDEX IF NOT EXISTS published_schedule_employee_idx ON published_schedule_shifts(employee_id)"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS employees_business_email_idx ON employees(business_id, email)"),
      db.prepare("CREATE INDEX IF NOT EXISTS employees_business_idx ON employees(business_id)"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS owners_email_idx ON owners(email)"),
      db.prepare("CREATE INDEX IF NOT EXISTS owners_business_idx ON owners(business_id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS app_sessions_expires_idx ON app_sessions(expires_at)"),
      db.prepare("CREATE INDEX IF NOT EXISTS login_attempts_locked_idx ON login_attempts(locked_until)"),
      db.prepare("CREATE INDEX IF NOT EXISTS messages_business_idx ON messages(business_id, created_at)"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS plaid_items_business_idx ON plaid_items(business_id)"),
    ]);
    for (const statement of [
      "ALTER TABLE employees ADD COLUMN phone TEXT",
      "ALTER TABLE messages ADD COLUMN conversation_id TEXT NOT NULL DEFAULT 'managers'",
      "ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id)",
      "ALTER TABLE messages ADD COLUMN image_data TEXT",
      "ALTER TABLE messages ADD COLUMN image_name TEXT",
      "ALTER TABLE employees ADD COLUMN display_name TEXT",
      "ALTER TABLE employees ADD COLUMN availability TEXT",
      "ALTER TABLE employees ADD COLUMN desired_hours INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE employees ADD COLUMN address TEXT",
      "ALTER TABLE employees ADD COLUMN profile_photo TEXT",
      "ALTER TABLE employees ADD COLUMN employee_code TEXT",
    ]) {
      try { await db.prepare(statement).run(); } catch { /* already migrated */ }
    }
  })();
  return ready;
}
