-- Pasted-text imports have no source website. Preserve their text in raw_text_excerpt.
ALTER TABLE recipe_imports ALTER COLUMN source_url DROP NOT NULL;
