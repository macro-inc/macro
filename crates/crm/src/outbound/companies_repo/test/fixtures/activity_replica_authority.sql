-- A replica snapshot that deliberately retains the original memberships.
CREATE SCHEMA stale_authority;
CREATE TABLE stale_authority.team_user AS TABLE public.team_user;
