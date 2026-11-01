-- Two teammates, each with their own Gmail inbox, and two CRM people.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('50000000-0000-0000-0000-000000000001', 'owner@example.com', 'owner@example.com', 'cus_owner'),
    ('50000000-0000-0000-0000-000000000002', 'mate@example.com', 'mate@example.com', 'cus_mate');
INSERT INTO "User" (id, email, name, macro_user_id) VALUES
    ('macro|owner@example.com', 'owner@example.com', 'Owner', '50000000-0000-0000-0000-000000000001'),
    ('macro|mate@example.com', 'mate@example.com', 'Mate', '50000000-0000-0000-0000-000000000002');
INSERT INTO team (id, name, owner_id) VALUES
    ('7e000000-0000-0000-0000-000000000001', 'Team', 'macro|owner@example.com');
INSERT INTO team_user (user_id, team_id, team_role) VALUES
    ('macro|owner@example.com', '7e000000-0000-0000-0000-000000000001', 'owner'),
    ('macro|mate@example.com', '7e000000-0000-0000-0000-000000000001', 'member');
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
    ('11111111-0000-0000-0000-000000000001', 'macro|owner@example.com', 'fa-owner', 'owner@example.com', 'GMAIL'),
    ('11111111-0000-0000-0000-000000000002', 'macro|mate@example.com', 'fa-mate', 'mate@example.com', 'GMAIL');
INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction) VALUES
    ('c0000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001', now(), now());
INSERT INTO crm_contacts (id, company_id, email, name, first_interaction, last_interaction) VALUES
    ('cc000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'ada@example.com', 'Ada Lovelace', now(), now()),
    ('cc000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'bob@example.com', 'Bob', now(), now());
