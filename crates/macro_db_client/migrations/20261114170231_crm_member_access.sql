SET LOCAL lock_timeout = '5s';

ALTER TABLE team_user ADD COLUMN crm_access boolean NOT NULL DEFAULT true;
