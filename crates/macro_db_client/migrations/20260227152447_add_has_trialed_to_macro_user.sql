-- By default set all existing users to has_trialed true
-- We can manually alter this value later with a script calling stripe to sync
ALTER TABLE macro_user ADD COLUMN has_trialed bool DEFAULT TRUE NOT NULL;
