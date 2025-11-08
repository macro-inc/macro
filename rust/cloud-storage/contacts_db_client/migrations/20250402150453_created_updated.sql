-- Add migration script here
-- on update restrict on delete restrict: https://mccue.dev/pages/3-11-25-life-altering-postgresql-patterns
ALTER TABLE connections ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE connections ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
