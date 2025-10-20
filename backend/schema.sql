CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  tg_id TEXT UNIQUE,
  wallet_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS balances (
  user_id INTEGER PRIMARY KEY,
  ton_balance REAL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS seeds (
  id INTEGER PRIMARY KEY,
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revealed_at DATETIME
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY,
  seed_id INTEGER NOT NULL,
  client_seed TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  crash REAL NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  FOREIGN KEY(seed_id) REFERENCES seeds(id)
);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  auto_cashout REAL,
  cashed_out_at REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(round_id) REFERENCES rounds(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS txs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  direction TEXT CHECK(direction IN ('deposit','withdraw')) NOT NULL,
  amount REAL NOT NULL,
  status TEXT CHECK(status IN ('pending','confirmed','failed')) NOT NULL,
  tx_hash TEXT,
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
