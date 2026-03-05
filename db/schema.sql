-- Family Dinner App — Database Schema
-- Run: psql -U forbell -d family_dinner -h localhost -f db/schema.sql
-- (DATABASE_URL in .env is only loaded by Node, not your shell)

CREATE TABLE IF NOT EXISTS meals (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  notes           TEXT,           -- short context note from the rotation doc
  recipe_tips     TEXT,           -- detailed prep tips (from "New Meals" section)
  active_time_min INTEGER,
  total_time_min  INTEGER,
  equipment       TEXT[],
  cook            TEXT,           -- emoji: 👨‍🍳 👩‍🍳 👨‍🍳 / 👩‍🍳 —
  kid_rating      TEXT,           -- 🟢 whole family | 🟡 adults+daughter | 🔵 adults+son
  is_new          BOOLEAN DEFAULT false,
  is_protected    BOOLEAN DEFAULT false,  -- Thursday "order in" nights
  tags            TEXT[],
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3-week rotation template (21 rows: 3 weeks × 7 days)
-- day_of_week: 1=Mon … 7=Sun (ISO)
CREATE TABLE IF NOT EXISTS meal_rotation (
  id           SERIAL PRIMARY KEY,
  week_number  INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 3),
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  meal_id      INTEGER REFERENCES meals(id),
  UNIQUE(week_number, day_of_week)
);

-- Per-date meal overrides (Alex swapping things around)
CREATE TABLE IF NOT EXISTS daily_overrides (
  id               SERIAL PRIMARY KEY,
  override_date    DATE NOT NULL UNIQUE,
  override_meal_id INTEGER REFERENCES meals(id),
  note             TEXT,
  created_by       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Family members with preference flags
CREATE TABLE IF NOT EXISTS family_members (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  role            TEXT CHECK (role IN ('parent', 'kid')),
  is_picky        BOOLEAN DEFAULT false,
  hates_leftovers BOOLEAN DEFAULT false,
  avatar_emoji    TEXT DEFAULT '👤'
);

-- Reactions per meal per person per planned date
-- week_context = Monday of that week, meal_date = actual dinner date
CREATE TABLE IF NOT EXISTS meal_votes (
  id          SERIAL PRIMARY KEY,
  meal_id     INTEGER REFERENCES meals(id),
  member_id   INTEGER REFERENCES family_members(id),
  reaction    TEXT NOT NULL,   -- ❤️ 👍 👎 🤷
  week_context DATE NOT NULL,  -- Monday of the week
  meal_date   DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meal_id, member_id, meal_date)
);

-- Cook log: planned vs. what actually happened
CREATE TABLE IF NOT EXISTS cook_log (
  id           SERIAL PRIMARY KEY,
  cooked_date  DATE NOT NULL,
  meal_id      INTEGER REFERENCES meals(id),
  planned_meal_id INTEGER REFERENCES meals(id),
  was_planned  BOOLEAN DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cooked_date, meal_id)
);

-- Alex's energy flag per week (1=rough week → 5=project meal week)
CREATE TABLE IF NOT EXISTS val_energy (
  id           SERIAL PRIMARY KEY,
  week_start   DATE NOT NULL UNIQUE,
  energy_level INTEGER CHECK (energy_level BETWEEN 1 AND 5),
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Order-in nights + restaurant voting
CREATE TABLE IF NOT EXISTS restaurants (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  emoji  TEXT,
  active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS order_in_nights (
  id           SERIAL PRIMARY KEY,
  order_date   DATE NOT NULL UNIQUE,
  created_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_votes (
  id            SERIAL PRIMARY KEY,
  order_date    DATE NOT NULL,
  restaurant_id INTEGER REFERENCES restaurants(id),
  member_id     INTEGER REFERENCES family_members(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_date, member_id)
);

-- App-level config (key/value)
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
