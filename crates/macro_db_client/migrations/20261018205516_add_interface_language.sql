-- The app interface language, as a BCP 47 tag (see model_user::Language).
-- team.language is the default for the team's members; NULL means English.
-- "User".language is a member's own choice; NULL follows their team.
SET LOCAL lock_timeout = '5s';
ALTER TABLE team ADD COLUMN language TEXT;
ALTER TABLE "User" ADD COLUMN language TEXT;
