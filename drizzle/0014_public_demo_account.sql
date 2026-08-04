INSERT OR IGNORE INTO businesses (id, name, employee_join_code, created_at)
VALUES ('hourmark-public-demo', 'Hourmark Demo Company', '44002026', unixepoch('now') * 1000);
--> statement-breakpoint
INSERT OR IGNORE INTO owners (
  id, business_id, name, email, password_hash, active, created_at
) VALUES (
  -1001,
  'hourmark-public-demo',
  'Demo Owner',
  'demo@hourmark.app',
  'pbkdf2$100000$2a28dcab6aef194e6774b3f877adce2b$15f2e98ef0441b2c5baaa57cd1c48a73ecd7097111a86cc26a81affb54e8b359',
  1,
  unixepoch('now') * 1000
);
