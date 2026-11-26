-- Two contributors hold mailbox-local copies of one conversation. Only the
-- first message has the selected participant; the later message must share too.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('00000000-0000-4000-8000-000000000101', 'member@example.com', 'member@example.com', 'selected-member'),
('00000000-0000-4000-8000-000000000102', 'owner@example.com', 'owner@example.com', 'selected-owner');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|member@example.com', 'member@example.com', '00000000-0000-4000-8000-000000000101'),
('macro|owner@example.com', 'owner@example.com', '00000000-0000-4000-8000-000000000102');
INSERT INTO team (id, name, owner_id, seat_count) VALUES
('00000000-0000-4000-8000-000000000001', 'Example team', 'macro|owner@example.com', 2);
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('00000000-0000-4000-8000-000000000001', 'macro|member@example.com', 'member'),
('00000000-0000-4000-8000-000000000001', 'macro|owner@example.com', 'owner');
INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES
('00000000-0000-4000-8000-000000000001', TRUE);
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active) VALUES
('00000000-0000-4000-8000-000000000011', 'macro|member@example.com', 'selected-member', 'member@example.com', 'GMAIL', TRUE),
('00000000-0000-4000-8000-000000000012', 'macro|owner@example.com', 'selected-owner', 'owner@example.com', 'GMAIL', TRUE);
INSERT INTO crm_email_consent (team_id, user_id, link_id, enabled)
SELECT '00000000-0000-4000-8000-000000000001', macro_id, id, TRUE FROM email_links;
INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition) VALUES
('00000000-0000-4000-8000-000000000001', 'macro|member@example.com', 1,
 '00000000-0000-4000-8000-000000000011', 1, '{"schema_version":1,"include":[]}');
-- Only fixtures can seed selected mode in this phase. No API activates it.
UPDATE crm_email_consent SET enabled = FALSE WHERE user_id = 'macro|member@example.com';
UPDATE crm_email_consent SET mode = 'selected', selected_enabled = TRUE, active_rule_revision = 1
WHERE user_id = 'macro|member@example.com';
INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, latest_non_spam_message_ts) VALUES
('00000000-0000-4000-8000-000000000021', 'selected-member-thread', '00000000-0000-4000-8000-000000000011', TRUE, '2026-01-02'),
('00000000-0000-4000-8000-000000000022', 'selected-owner-thread', '00000000-0000-4000-8000-000000000012', TRUE, '2026-01-01');
INSERT INTO email_contacts (id, link_id, email_address) VALUES
('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000011', 'member@example.com'),
('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000011', 'selected@client.example'),
('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000011', 'other@peer.example'),
('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000012', 'owner@example.com'),
('00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000012', 'selected@client.example'),
('00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000012', 'other@peer.example');
INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, is_sent, is_draft, internal_date_ts, global_id) VALUES
('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000031', TRUE, FALSE, '2026-01-01', 'selected-root@example.com'),
('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000031', TRUE, FALSE, '2026-01-02', 'selected-later@example.com'),
('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000034', TRUE, FALSE, '2026-01-01', 'selected-root@example.com');
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) VALUES
('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000032', 'TO'),
('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000033', 'TO'),
('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000033', 'TO'),
('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000035', 'TO'),
('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000036', 'TO');
INSERT INTO crm_companies (id, team_id, email_sync, first_interaction, last_interaction) VALUES
('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000001', TRUE, '2026-01-01', '2026-01-02');
INSERT INTO crm_domains (company_id, domain, team_id) VALUES
('00000000-0000-4000-8000-000000000041', 'client.example', '00000000-0000-4000-8000-000000000001');
INSERT INTO crm_contacts (id, company_id, team_id, email, first_interaction, last_interaction) VALUES
('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000001', 'primary@client.example', '2026-01-01', '2026-01-02');
INSERT INTO crm_contact_emails (contact_id, email) VALUES
('00000000-0000-4000-8000-000000000042', 'selected@client.example');
