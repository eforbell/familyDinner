CREATE TABLE IF NOT EXISTS recipes (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  source_domain TEXT,
  source_title TEXT,
  servings_text TEXT,
  prep_time_min INTEGER,
  cook_time_min INTEGER,
  total_time_min INTEGER,
  notes TEXT,
  tags TEXT[] DEFAULT ARRAY[]::text[],
  image_url TEXT,
  created_by_member_id INTEGER REFERENCES family_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS recipe_id INTEGER REFERENCES recipes(id);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  display_text TEXT NOT NULL,
  quantity_text TEXT,
  unit_text TEXT,
  ingredient_text TEXT,
  prep_note TEXT,
  UNIQUE(recipe_id, position)
);

CREATE TABLE IF NOT EXISTS recipe_steps (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT,
  instruction_text TEXT NOT NULL,
  UNIQUE(recipe_id, position)
);

CREATE TABLE IF NOT EXISTS recipe_imports (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  fetch_status TEXT NOT NULL,
  extractor_model TEXT,
  raw_text_excerpt TEXT,
  extracted_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meals_recipe_id ON meals(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id ON recipe_ingredients(recipe_id, position);
CREATE INDEX IF NOT EXISTS idx_recipe_steps_recipe_id ON recipe_steps(recipe_id, position);
