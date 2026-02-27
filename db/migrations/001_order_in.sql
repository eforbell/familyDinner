-- Migration 001: Order-in nights + restaurant voting
-- Run: psql -U forbell -d family_dinner -h localhost -f db/migrations/001_order_in.sql

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

-- One vote per person per night (replace on re-vote)
CREATE TABLE IF NOT EXISTS restaurant_votes (
  id            SERIAL PRIMARY KEY,
  order_date    DATE NOT NULL,
  restaurant_id INTEGER REFERENCES restaurants(id),
  member_id     INTEGER REFERENCES family_members(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_date, member_id)
);

INSERT INTO restaurants (name, emoji) VALUES
  ('Chipotle',       '🌯'),
  ('Panda Express',  '🥡'),
  ('Pizza',          '🍕'),
  ('McDonald''s',    '🍟')
ON CONFLICT DO NOTHING;
