-- The team's logo: a static file id every member sees in place of the app
-- rail's create button. NULL means the team has none. Static files are owned
-- by the static-file service, so there is no foreign key; removing the logo
-- or the team drops this reference without deleting the file.
SET LOCAL lock_timeout = '5s';
ALTER TABLE team ADD COLUMN logo_file_id UUID;
