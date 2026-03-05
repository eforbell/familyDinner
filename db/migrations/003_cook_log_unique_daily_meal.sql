-- Enforce one cook-log row per meal per calendar date.
-- Keep the earliest row when duplicates exist.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY cooked_date, meal_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM cook_log
  WHERE meal_id IS NOT NULL
)
DELETE FROM cook_log c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cook_log_one_meal_per_day'
  ) THEN
    ALTER TABLE cook_log
      ADD CONSTRAINT cook_log_one_meal_per_day UNIQUE (cooked_date, meal_id);
  END IF;
END
$$;
