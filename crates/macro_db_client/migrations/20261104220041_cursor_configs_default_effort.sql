-- The reasoning effort a user's `@cursor` sessions start on, as the value of
-- the default model's effort parameter (e.g. `high`). It belongs to
-- `default_model_id`: Cursor offers different effort values per model, so an
-- effort without a model means nothing. NULL means "the model's own default
-- variant", so every existing row is valid without a backfill.
ALTER TABLE cursor_configs ADD COLUMN default_effort TEXT;

ALTER TABLE cursor_configs ADD CONSTRAINT cursor_configs_default_effort_needs_model
    CHECK (default_effort IS NULL OR (default_model_id IS NOT NULL AND default_effort <> ''));
