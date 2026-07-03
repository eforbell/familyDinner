-- Week-first planning: plan_days becomes the canonical per-date meal plan.
-- The 3-week rotation (meal_rotation) is demoted to an optional autofill
-- template; daily_overrides is retired (data preserved, no longer read).

CREATE TABLE IF NOT EXISTS plan_days (
  plan_date  DATE PRIMARY KEY,
  meal_id    INTEGER REFERENCES meals(id),
  note       TEXT,
  created_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill a window of resolved meals (12 weeks back through 3 weeks ahead)
-- so every date the family could already see keeps its exact meal.
-- Resolution order matches the old runtime logic: override first, then the
-- rotation slot for that date's rotation week. Monday-to-Monday diffs are
-- always exact multiples of 7, so integer division is safe here.
WITH cfg AS (
  SELECT (value)::date AS start_date
  FROM app_config
  WHERE key = 'rotation_start_date'
),
window_days AS (
  SELECT d::date AS plan_date
  FROM generate_series(
    CURRENT_DATE - (EXTRACT(ISODOW FROM CURRENT_DATE)::int - 1) - 84,
    CURRENT_DATE - (EXTRACT(ISODOW FROM CURRENT_DATE)::int - 1) + 27,
    interval '1 day'
  ) d
),
resolved AS (
  SELECT
    wd.plan_date,
    COALESCE(o.override_meal_id, r.meal_id) AS meal_id,
    o.note,
    o.created_by
  FROM window_days wd
  CROSS JOIN cfg
  LEFT JOIN daily_overrides o
    ON o.override_date = wd.plan_date
  LEFT JOIN meal_rotation r
    ON r.day_of_week = EXTRACT(ISODOW FROM wd.plan_date)::int
   AND r.week_number = (
         (
           (
             (
               (wd.plan_date - (EXTRACT(ISODOW FROM wd.plan_date)::int - 1))
               - (cfg.start_date - (EXTRACT(ISODOW FROM cfg.start_date)::int - 1))
             ) / 7
           ) % 3 + 3
         ) % 3
       ) + 1
)
INSERT INTO plan_days (plan_date, meal_id, note, created_by)
SELECT plan_date, meal_id, note, created_by
FROM resolved
WHERE meal_id IS NOT NULL
ON CONFLICT (plan_date) DO NOTHING;

-- Preserve any override outside the window (e.g. a swap planned far ahead).
INSERT INTO plan_days (plan_date, meal_id, note, created_by)
SELECT override_date, override_meal_id, note, created_by
FROM daily_overrides
WHERE override_meal_id IS NOT NULL
ON CONFLICT (plan_date) DO NOTHING;
