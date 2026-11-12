-- Suite identity (Home Base Feature-10): the household member each Family Dinner member is, in tailnet mode.
-- A parent links them once on the link page. Unique: one household member is one Dinner member.

ALTER TABLE family_members ADD COLUMN IF NOT EXISTS suite_member_id TEXT UNIQUE;
