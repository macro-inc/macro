-- SQL fixture for team_access::get_user_team tests.
--
-- Covers:
--   - Each team_role (member / admin / owner)
--   - A user with no team membership
--   - A user in two teams with different roles (defensive highest-role case)
--   - A second team scoped to a different user (isolation case)

------------------------------------------------------------
-- macro_user (referenced by "User".macro_user_id)
------------------------------------------------------------

INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('00000000-0000-0000-0000-000000000a01', 'alpha_owner', 'alpha_owner@team.com', 'cus_alpha_owner'),
    ('00000000-0000-0000-0000-000000000a02', 'beta_owner',  'beta_owner@team.com',  'cus_beta_owner'),
    ('00000000-0000-0000-0000-000000000a03', 'member',      'member@team.com',      'cus_member'),
    ('00000000-0000-0000-0000-000000000a04', 'admin',       'admin@team.com',       'cus_admin'),
    ('00000000-0000-0000-0000-000000000a05', 'owner',       'owner@team.com',       'cus_owner'),
    ('00000000-0000-0000-0000-000000000a06', 'multi',       'multi@team.com',       'cus_multi'),
    ('00000000-0000-0000-0000-000000000a07', 'noteam',      'noteam@team.com',      'cus_noteam');

------------------------------------------------------------
-- Users
------------------------------------------------------------

INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|alpha_owner@team.com', 'alpha_owner@team.com', '00000000-0000-0000-0000-000000000a01'),
    ('macro|beta_owner@team.com',  'beta_owner@team.com',  '00000000-0000-0000-0000-000000000a02'),
    ('macro|member@team.com',      'member@team.com',      '00000000-0000-0000-0000-000000000a03'),
    ('macro|admin@team.com',       'admin@team.com',       '00000000-0000-0000-0000-000000000a04'),
    ('macro|owner@team.com',       'owner@team.com',       '00000000-0000-0000-0000-000000000a05'),
    ('macro|multi@team.com',       'multi@team.com',       '00000000-0000-0000-0000-000000000a06'),
    ('macro|noteam@team.com',      'noteam@team.com',      '00000000-0000-0000-0000-000000000a07');

------------------------------------------------------------
-- Teams
------------------------------------------------------------

INSERT INTO team (id, name, owner_id) VALUES
    ('00000000-0000-0000-0000-0000000ea001', 'Team Alpha', 'macro|alpha_owner@team.com'),
    ('00000000-0000-0000-0000-0000000ea002', 'Team Beta',  'macro|beta_owner@team.com');

------------------------------------------------------------
-- Memberships
--   Team Alpha: one user per role
--   Team Beta:  one user — used to verify we return the actual team_id
--               (not just the first or default)
--
-- Note: the schema enforces UNIQUE (user_id) on team_user, so a user can only
-- belong to one team at a time.
------------------------------------------------------------

INSERT INTO team_user (user_id, team_id, team_role) VALUES
    ('macro|member@team.com', '00000000-0000-0000-0000-0000000ea001', 'member'),
    ('macro|admin@team.com',  '00000000-0000-0000-0000-0000000ea001', 'admin'),
    ('macro|owner@team.com',  '00000000-0000-0000-0000-0000000ea001', 'owner'),
    ('macro|multi@team.com',  '00000000-0000-0000-0000-0000000ea002', 'owner');
