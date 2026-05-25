CREATE TABLE IF NOT EXISTS tonight_addons (
  addon_date  DATE PRIMARY KEY,
  note        TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

