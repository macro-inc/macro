-- Only this disposable test database permits multiple memberships. Production
-- still enforces one team per user; the listing must remain correct if that
-- restriction is relaxed, without coalescing the stored team contact records.
ALTER TABLE team_user DROP CONSTRAINT team_user_user_id_unique;

INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('00000000-0000-0000-0000-000000000003', 'owner12@test.com', 'owner12@test.com', 'contacts_owner12'),
    ('00000000-0000-0000-0000-000000000004', 'owner13@test.com', 'owner13@test.com', 'contacts_owner13'),
    ('00000000-0000-0000-0000-000000000005', 'owner14@test.com', 'owner14@test.com', 'contacts_owner14');
INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|owner12@test.com', 'owner12@test.com', '00000000-0000-0000-0000-000000000003'),
    ('macro|owner13@test.com', 'owner13@test.com', '00000000-0000-0000-0000-000000000004'),
    ('macro|owner14@test.com', 'owner14@test.com', '00000000-0000-0000-0000-000000000005');
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('00000000-0000-0000-0000-000000000001', 'viewer@test.com', 'viewer@test.com', 'contacts_viewer'), ('00000000-0000-0000-0000-000000000002', 'owner@test.com', 'owner@test.com', 'contacts_owner');
INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|viewer@test.com', 'viewer@test.com', '00000000-0000-0000-0000-000000000001'), ('macro|owner@test.com', 'owner@test.com', '00000000-0000-0000-0000-000000000002');
INSERT INTO team (id, name, owner_id) VALUES ('00000000-0000-0000-0000-00000000000b', 'Team 11', 'macro|owner@test.com');
INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ('00000000-0000-0000-0000-00000000000b', TRUE);
INSERT INTO team_user (team_id, user_id, team_role) VALUES ('00000000-0000-0000-0000-00000000000b', 'macro|viewer@test.com', 'admin');
INSERT INTO team (id, name, owner_id) VALUES ('00000000-0000-0000-0000-00000000000c', 'Team 12', 'macro|owner12@test.com');
INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ('00000000-0000-0000-0000-00000000000c', TRUE);
INSERT INTO team_user (team_id, user_id, team_role) VALUES ('00000000-0000-0000-0000-00000000000c', 'macro|viewer@test.com', 'member');
INSERT INTO team (id, name, owner_id) VALUES ('00000000-0000-0000-0000-00000000000d', 'Team 13', 'macro|owner13@test.com');
INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ('00000000-0000-0000-0000-00000000000d', FALSE);
INSERT INTO team_user (team_id, user_id, team_role) VALUES ('00000000-0000-0000-0000-00000000000d', 'macro|viewer@test.com', 'member');
INSERT INTO team (id, name, owner_id) VALUES ('00000000-0000-0000-0000-00000000000e', 'Team 14', 'macro|owner14@test.com');
INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ('00000000-0000-0000-0000-00000000000e', TRUE);
INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-000000000065', '00000000-0000-0000-0000-00000000000b', 'Company 101', FALSE, '2026-01-01', '2026-01-11');
INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-000000000066', '00000000-0000-0000-0000-00000000000c', 'Company 102', FALSE, '2026-01-01', '2026-01-11');
INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-000000000067', '00000000-0000-0000-0000-00000000000d', 'Company 103', FALSE, '2026-01-01', '2026-01-11');
INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-000000000068', '00000000-0000-0000-0000-00000000000e', 'Company 104', FALSE, '2026-01-01', '2026-01-11');
INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-000000000069', '00000000-0000-0000-0000-00000000000b', 'Company 105', TRUE, '2026-01-01', '2026-01-11');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003e9', '00000000-0000-0000-0000-000000000065', 'Pat@Example.com', 'Old Pat', FALSE, '2026-01-01', '2026-01-01');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003ea', '00000000-0000-0000-0000-000000000066', 'pat@example.com', 'Team Two Pat', FALSE, '2026-01-01', '2026-01-04');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003eb', '00000000-0000-0000-0000-000000000068', 'PAT@example.com', 'Private Pat', FALSE, '2026-01-01', '2026-01-09');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003ec', '00000000-0000-0000-0000-000000000065', 'lone1@example.com', 'Lone One', FALSE, '2026-01-01', '2026-01-03');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003ed', '00000000-0000-0000-0000-000000000066', 'lone2@example.com', 'Lone Two', FALSE, '2026-01-01', '2026-01-03');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003ee', '00000000-0000-0000-0000-000000000069', 'hidden-parent@example.com', 'Hidden Parent', FALSE, '2026-01-01', '2026-01-08');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003ef', '00000000-0000-0000-0000-000000000066', 'hidden-member@example.com', 'Hidden Member', TRUE, '2026-01-01', '2026-01-07');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003f0', '00000000-0000-0000-0000-000000000065', 'hidden-admin@example.com', 'Hidden Admin', TRUE, '2026-01-01', '2026-01-06');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003f1', '00000000-0000-0000-0000-000000000067', 'disabled@example.com', 'Disabled', FALSE, '2026-01-01', '2026-01-10');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003f2', '00000000-0000-0000-0000-000000000065', 'pat+alias@example.com', 'Plus Alias', FALSE, '2026-01-01', '2026-01-02');
INSERT INTO crm_contacts (id, company_id, email, name, hidden, first_interaction, last_interaction) VALUES ('00000000-0000-0000-0000-0000000003f3', '00000000-0000-0000-0000-000000000065', ' PAT@example.com ', 'Pat Winner', FALSE, '2026-01-01', '2026-01-04');
INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "updatedAt") VALUES ('macro|viewer@test.com', '00000000-0000-0000-0000-0000000003ec', 'crm_contact', '2026-01-11');
