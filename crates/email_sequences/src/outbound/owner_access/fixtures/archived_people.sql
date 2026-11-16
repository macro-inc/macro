-- A team admin, a member, and three CRM people: one in Customers, one
-- archived, and one under an archived company.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('00000000-0000-0000-0000-000000000001', 'admin@example.com', 'admin@example.com', 'sequences_admin'),
    ('00000000-0000-0000-0000-000000000002', 'member@example.com', 'member@example.com', 'sequences_member');
INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|admin@example.com', 'admin@example.com', '00000000-0000-0000-0000-000000000001'),
    ('macro|member@example.com', 'member@example.com', '00000000-0000-0000-0000-000000000002');
INSERT INTO team (id, name, owner_id) VALUES
    ('00000000-0000-0000-0000-00000000000b', 'Team', 'macro|admin@example.com');
INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES
    ('00000000-0000-0000-0000-00000000000b', TRUE);
INSERT INTO team_user (team_id, user_id, team_role) VALUES
    ('00000000-0000-0000-0000-00000000000b', 'macro|admin@example.com', 'admin'),
    ('00000000-0000-0000-0000-00000000000b', 'macro|member@example.com', 'member');
INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction) VALUES
    ('00000000-0000-0000-0000-000000000065', '00000000-0000-0000-0000-00000000000b', 'Open', FALSE, '2026-01-01', '2026-01-11'),
    ('00000000-0000-0000-0000-000000000069', '00000000-0000-0000-0000-00000000000b', 'Archived', TRUE, '2026-01-01', '2026-01-11');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES
    ('00000000-0000-0000-0000-0000000003e9', '00000000-0000-0000-0000-000000000065', 'kept@example.com', 'Kept', FALSE, '2026-01-01', '2026-01-03'),
    ('00000000-0000-0000-0000-0000000003ea', '00000000-0000-0000-0000-000000000065', 'archived@example.com', 'Archived', TRUE, '2026-01-01', '2026-01-03'),
    ('00000000-0000-0000-0000-0000000003eb', '00000000-0000-0000-0000-000000000069', 'company-archived@example.com', 'Under', FALSE, '2026-01-01', '2026-01-03');
