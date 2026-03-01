ALTER TABLE meal_votes
ADD COLUMN IF NOT EXISTS meal_date DATE;

UPDATE meal_votes
SET meal_date = week_context
WHERE meal_date IS NULL;

ALTER TABLE meal_votes
ALTER COLUMN meal_date SET NOT NULL;

ALTER TABLE meal_votes
DROP CONSTRAINT IF EXISTS meal_votes_meal_id_member_id_week_context_key;

ALTER TABLE meal_votes
ADD CONSTRAINT meal_votes_meal_id_member_id_meal_date_key
UNIQUE (meal_id, member_id, meal_date);
