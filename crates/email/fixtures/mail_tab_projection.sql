-- Extends email_dynamic_query + email_shared_threads. One thread has an older
-- draft and sent message, a newer normal message, and an even newer trashed draft.
INSERT INTO email_messages (id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts, is_draft, is_sent, is_starred, is_read, created_at, updated_at)
VALUES
 ('50001001-0000-0000-0000-000000000001','20000001-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','projection-draft','40000001-0000-0000-0000-000000000001','Older draft','draft preview','2024-01-14',true,false,false,false,NOW(),NOW()),
 ('50001002-0000-0000-0000-000000000002','20000001-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','projection-sent','40000001-0000-0000-0000-000000000001','Older sent','sent preview','2024-01-13',false,true,false,true,NOW(),NOW()),
 ('50001003-0000-0000-0000-000000000003','20000001-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','projection-trash','40000001-0000-0000-0000-000000000001','Trashed newer draft','must not win','2024-02-15',true,false,false,false,NOW(),NOW());
INSERT INTO email_message_labels (message_id,label_id)
VALUES ('50001003-0000-0000-0000-000000000003','10000006-0000-0000-0000-000000000006');
UPDATE email_threads SET latest_outbound_message_ts = '2024-01-13', has_calendar_attachment = true
WHERE id = '20000001-0000-0000-0000-000000000001';

INSERT INTO team (id,name,owner_id) VALUES ('77771111-0000-0000-0000-000000007777','Mail projection team','macro|user2@test.com');
INSERT INTO team_user (user_id,team_id,team_role) VALUES ('macro|user1@test.com','77771111-0000-0000-0000-000000007777','member');
INSERT INTO comms_channels (id,name,channel_type,owner_id,created_at,updated_at) VALUES
 ('00000000-0000-0000-0000-000000000c11','active share','public','macro|user2@test.com',NOW(),NOW()),
 ('00000000-0000-0000-0000-000000000c12','left share','public','macro|user2@test.com',NOW(),NOW());
INSERT INTO comms_channel_participants (channel_id,user_id,role,joined_at,left_at) VALUES
 ('00000000-0000-0000-0000-000000000c11','macro|user1@test.com','member',NOW(),NULL),
 ('00000000-0000-0000-0000-000000000c12','macro|user1@test.com','member',NOW(),NOW());
INSERT INTO entity_access (entity_id,entity_type,source_id,source_type,access_level) VALUES
 ('20000103-0000-0000-0000-000000000103','email_thread','77771111-0000-0000-0000-000000007777','team','view'),
 ('20000008-0000-0000-0000-000000000008','email_thread','00000000-0000-0000-0000-000000000c11','channel','view'),
 ('20000009-0000-0000-0000-000000000009','email_thread','00000000-0000-0000-0000-000000000c12','channel','view');
