-- Four members of one team, each with a primary mailbox. Links 0, 1 and 2
-- contribute their mail to the team's CRM; link 3 has not consented.
INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
SELECT md5('population' || i)::uuid, 'p' || i || '@team.test', 'p' || i || '@team.test', 'stripe_p' || i
FROM generate_series(0, 3) i;

INSERT INTO "User" (id, email, name, macro_user_id)
SELECT 'macro|p' || i || '@team.test', 'p' || i || '@team.test', 'P' || i, md5('population' || i)::uuid
FROM generate_series(0, 3) i;

INSERT INTO team (id, name, owner_id, seat_count)
VALUES ('e1000000-0000-0000-0000-000000000001', 'Population Team', 'macro|p0@team.test', 4);

INSERT INTO team_user (team_id, user_id, team_role)
SELECT 'e1000000-0000-0000-0000-000000000001'::uuid, 'macro|p' || i || '@team.test',
       CASE WHEN i = 0 THEN 'owner' ELSE 'member' END::team_role
FROM generate_series(0, 3) i;

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active,
  created_at, updated_at)
SELECT ('f1000000-0000-0000-0000-00000000000' || i)::uuid, 'macro|p' || i || '@team.test', 'fa_p' || i,
       'p' || i || '@team.test', 'GMAIL', true, NOW(), NOW()
FROM generate_series(0, 3) i;

INSERT INTO crm_email_consent (team_id, user_id, link_id, enabled)
SELECT 'e1000000-0000-0000-0000-000000000001'::uuid, 'macro|p' || i || '@team.test',
       ('f1000000-0000-0000-0000-00000000000' || i)::uuid, TRUE
FROM generate_series(0, 2) i;
