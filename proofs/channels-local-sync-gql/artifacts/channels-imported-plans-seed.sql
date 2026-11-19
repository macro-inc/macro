\set ON_ERROR_STOP on
SET session_replication_role=replica;
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,sender_id,content,created_at,updated_at)
VALUES ('019fd3b9-0000-7000-8000-000000000001','channel','019fd3b9-0000-7000-8000-000000000002','macro|query-test@example.com','root','2026-01-01','2026-01-01');
INSERT INTO comms_message_threads(root_id,parent_entity_type,parent_entity_id,user_id,created_at,updated_at)
VALUES ('019fd3b9-0000-7000-8000-000000000001','channel','019fd3b9-0000-7000-8000-000000000002','macro|query-test@example.com','2026-01-01','2026-01-01');
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,thread_id,sender_id,content,import_order,created_at,updated_at)
SELECT ('019fd3b9-0000-7000-8001-'||lpad(i::text,12,'0'))::uuid,'channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001','macro|query-test@example.com','reply',CASE WHEN i<=200 THEN i END,'2026-01-01'::timestamptz+ i*interval '1 second','2026-01-01' FROM generate_series(1,250) i;
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,sender_id,content,created_at,updated_at)
SELECT ('00000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,'channel','019fd3b9-0000-7000-8000-000000000003','macro|query-test@example.com','background','2026-01-01'::timestamptz+i*interval '1 second','2026-01-01' FROM generate_series(1,100000) i;
RESET session_replication_role;
ANALYZE comms_messages;
ANALYZE comms_message_threads;
