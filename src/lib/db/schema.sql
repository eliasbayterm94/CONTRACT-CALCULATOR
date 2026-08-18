-- Forest Coffee contract calculator schema.
-- Every table that feeds a price is editable from the admin module and every
-- edit is written to audit_log, so a quote can always be explained after the fact.

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cost_lines (
  key           TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  cost_group    TEXT NOT NULL,
  basis         TEXT NOT NULL,
  driver        TEXT NOT NULL,
  currency      TEXT NOT NULL,
  amount        REAL NOT NULL DEFAULT 0,
  lbs_per_unit  REAL NOT NULL DEFAULT 0,
  per_month     INTEGER NOT NULL DEFAULT 0,
  is_margin     INTEGER NOT NULL DEFAULT 0,
  waivable      INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS packaging_types (
  key          TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  kg_per_unit  REAL NOT NULL,
  lbs_per_unit REAL NOT NULL,
  amount         REAL NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'COP',
  trader_default INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS process_types (
  key          TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  amount       REAL NOT NULL,
  lbs_per_unit REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'COP',
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS destinations (
  key                     TEXT PRIMARY KEY,
  label                   TEXT NOT NULL,
  quote_currency          TEXT NOT NULL,
  quote_unit              TEXT NOT NULL,
  seafreight_amount       REAL NOT NULL DEFAULT 0,
  seafreight_currency     TEXT NOT NULL DEFAULT 'USD',
  seafreight_lbs_per_unit REAL NOT NULL DEFAULT 38580.5,
  import_amount           REAL NOT NULL DEFAULT 0,
  import_currency         TEXT NOT NULL DEFAULT 'USD',
  import_lbs_per_unit     REAL NOT NULL DEFAULT 38580.5,
  unloading_amount        REAL NOT NULL DEFAULT 0,
  unloading_currency      TEXT NOT NULL DEFAULT 'USD',
  unloading_lbs_per_unit  REAL NOT NULL DEFAULT 38580.5,
  storage_amount          REAL NOT NULL DEFAULT 0,
  storage_currency        TEXT NOT NULL DEFAULT 'USD',
  allowed_incoterms       TEXT NOT NULL DEFAULT 'FOB,CIF,DDP',
  sort_order              INTEGER NOT NULL DEFAULT 0,
  active                  INTEGER NOT NULL DEFAULT 1
);

-- USD per one unit of the currency. COP is stored as 1/TRM.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency     TEXT PRIMARY KEY,
  usd_per_unit REAL NOT NULL,
  source       TEXT NOT NULL DEFAULT 'seed',
  is_override  INTEGER NOT NULL DEFAULT 0,
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- KC futures, entered by hand each morning. Stored in US cents/lb, the unit the
-- contract actually trades in.
CREATE TABLE IF NOT EXISTS kc_prices (
  month_key   TEXT PRIMARY KEY,
  price_cents REAL NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  TEXT
);

-- Quality differential over KC, per contract month, in US cents/lb.
CREATE TABLE IF NOT EXISTS premiums (
  month_key     TEXT NOT NULL,
  quality_key   TEXT NOT NULL DEFAULT 'standard',
  premium_cents REAL NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by    TEXT,
  PRIMARY KEY (month_key, quality_key)
);

-- A saved quote stamps the full inputs, the result, and a snapshot of every
-- rate and cost table used, so the number can be reproduced exactly later.
CREATE TABLE IF NOT EXISTS quotes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reference    TEXT NOT NULL UNIQUE,
  client_name  TEXT,
  notes        TEXT,
  input_json   TEXT NOT NULL,
  result_json  TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  -- Multi-shipment contracts store their shipment rows; single quotes leave it null.
  shipments_json TEXT,
  schedule_json  TEXT,
  from_month   TEXT,
  to_month     TEXT,
  hold_months  INTEGER,
  waived_fixed_cost INTEGER NOT NULL DEFAULT 0,
  chosen_margin REAL,
  chosen_price_usd_per_lb REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  actor     TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  action    TEXT NOT NULL,
  detail    TEXT
);

CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);

-- Latest KC spot fetched from the market feed. One row, id fixed at 1.
CREATE TABLE IF NOT EXISTS kc_spot (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  price_cents REAL NOT NULL,
  as_of       TEXT NOT NULL,
  source      TEXT NOT NULL,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
