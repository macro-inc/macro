-- Team 1 has an owner, an admin and a member; team 2's owner is outside team 1.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('00000000-0000-0000-0000-000000000001', 'owner@previews.test', 'owner@previews.test', 'previews_owner'),
    ('00000000-0000-0000-0000-000000000002', 'admin@previews.test', 'admin@previews.test', 'previews_admin'),
    ('00000000-0000-0000-0000-000000000003', 'member@previews.test', 'member@previews.test', 'previews_member'),
    ('00000000-0000-0000-0000-000000000004', 'outsider@previews.test', 'outsider@previews.test', 'previews_outsider');
INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|owner@previews.test', 'owner@previews.test', '00000000-0000-0000-0000-000000000001'),
    ('macro|admin@previews.test', 'admin@previews.test', '00000000-0000-0000-0000-000000000002'),
    ('macro|member@previews.test', 'member@previews.test', '00000000-0000-0000-0000-000000000003'),
    ('macro|outsider@previews.test', 'outsider@previews.test', '00000000-0000-0000-0000-000000000004');
INSERT INTO team (id, name, owner_id) VALUES
    ('00000000-0000-0000-0000-00000000000a', 'Team 1', 'macro|owner@previews.test'),
    ('00000000-0000-0000-0000-00000000000b', 'Team 2', 'macro|outsider@previews.test');
INSERT INTO team_user (team_id, user_id, team_role) VALUES
    ('00000000-0000-0000-0000-00000000000a', 'macro|owner@previews.test', 'owner'),
    ('00000000-0000-0000-0000-00000000000a', 'macro|admin@previews.test', 'admin'),
    ('00000000-0000-0000-0000-00000000000a', 'macro|member@previews.test', 'member'),
    ('00000000-0000-0000-0000-00000000000b', 'macro|outsider@previews.test', 'owner');

-- 101 has a name override; 102 takes its first domain's directory name; 103's
-- domain differs in case from its directory row; 104's domain has no
-- directory row; 105 has no domain; 106 is hidden; 107's two domains share a
-- creation time; 201 is team 2's.
INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction) VALUES
    ('00000000-0000-0000-0000-000000000065', '00000000-0000-0000-0000-00000000000a', 'Custom Co', FALSE, '2026-01-01', '2026-02-01'),
    ('00000000-0000-0000-0000-000000000066', '00000000-0000-0000-0000-00000000000a', NULL, FALSE, '2026-01-01', '2026-02-02'),
    ('00000000-0000-0000-0000-000000000067', '00000000-0000-0000-0000-00000000000a', NULL, FALSE, '2026-01-01', '2026-02-03'),
    ('00000000-0000-0000-0000-000000000068', '00000000-0000-0000-0000-00000000000a', NULL, FALSE, '2026-01-01', '2026-02-04'),
    ('00000000-0000-0000-0000-000000000069', '00000000-0000-0000-0000-00000000000a', NULL, FALSE, '2026-01-01', '2026-02-05'),
    ('00000000-0000-0000-0000-00000000006a', '00000000-0000-0000-0000-00000000000a', 'Hidden Co', TRUE, '2026-01-01', '2026-02-06'),
    ('00000000-0000-0000-0000-00000000006b', '00000000-0000-0000-0000-00000000000a', NULL, FALSE, '2026-01-01', '2026-02-08'),
    ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-00000000000b', 'Other Team Co', FALSE, '2026-01-01', '2026-02-07');
INSERT INTO crm_domains (company_id, team_id, domain, created_at) VALUES
    ('00000000-0000-0000-0000-000000000065', '00000000-0000-0000-0000-00000000000a', 'a.example', '2026-01-01'),
    ('00000000-0000-0000-0000-000000000066', '00000000-0000-0000-0000-00000000000a', 'b2.example', '2026-01-03'),
    ('00000000-0000-0000-0000-000000000066', '00000000-0000-0000-0000-00000000000a', 'b1.example', '2026-01-02'),
    ('00000000-0000-0000-0000-000000000067', '00000000-0000-0000-0000-00000000000a', 'C.Example', '2026-01-01'),
    ('00000000-0000-0000-0000-000000000068', '00000000-0000-0000-0000-00000000000a', 'd.example', '2026-01-01'),
    ('00000000-0000-0000-0000-00000000006a', '00000000-0000-0000-0000-00000000000a', 'h.example', '2026-01-01'),
    ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-00000000000b', 'o.example', '2026-01-01');
-- 107's domains tie on created_at. The higher id, and its directory row, go in
-- first, so no insertion or heap order picks the lower one.
INSERT INTO crm_domains (id, company_id, team_id, domain, created_at) VALUES
    ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000006b', '00000000-0000-0000-0000-00000000000a', 't2.example', '2026-01-01'),
    ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000006b', '00000000-0000-0000-0000-00000000000a', 't1.example', '2026-01-01');
INSERT INTO crm_domain_directory (domain, name) VALUES
    ('a.example', 'Directory A'),
    ('b1.example', 'Directory B1'),
    ('b2.example', 'Directory B2'),
    ('c.example', 'Directory C'),
    ('h.example', 'Directory H'),
    ('t2.example', 'Directory T2'),
    ('t1.example', 'Directory T1');

-- 1001 is plain; 1002 sits under the hidden company; 1003 is hidden; 1004 has
-- no company and no name; 1005's name is blank; 2001 is team 2's.
INSERT INTO crm_contacts (id, company_id, team_id, email, name, hidden, first_interaction, last_interaction) VALUES
    ('00000000-0000-0000-0000-0000000003e9', '00000000-0000-0000-0000-000000000065', '00000000-0000-0000-0000-00000000000a', 'pat@a.example', 'Pat Lee', FALSE, '2026-01-01', '2026-01-02'),
    ('00000000-0000-0000-0000-0000000003ea', '00000000-0000-0000-0000-00000000006a', '00000000-0000-0000-0000-00000000000a', 'under@h.example', 'Under Hidden', FALSE, '2026-01-01', '2026-01-02'),
    ('00000000-0000-0000-0000-0000000003eb', '00000000-0000-0000-0000-000000000065', '00000000-0000-0000-0000-00000000000a', 'hid@a.example', 'Hidden Contact', TRUE, '2026-01-01', '2026-01-02'),
    ('00000000-0000-0000-0000-0000000003ec', NULL, '00000000-0000-0000-0000-00000000000a', 'solo@personal.example', NULL, FALSE, '2026-01-01', '2026-01-02'),
    ('00000000-0000-0000-0000-0000000003ed', '00000000-0000-0000-0000-000000000066', '00000000-0000-0000-0000-00000000000a', 'blank@b1.example', '  ', FALSE, '2026-01-01', '2026-01-02'),
    ('00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-00000000000b', 'other@o.example', 'Other Contact', FALSE, '2026-01-01', '2026-01-02');
