ALTER TABLE comms_messages SET (autovacuum_enabled=false);
ALTER TABLE comms_message_threads SET (autovacuum_enabled=false);
SET session_replication_role=replica;
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,thread_id,sender_id,content,import_order,created_at,updated_at)
SELECT ('019fd3b9-0000-7000-8002-'||lpad(i::text,12,'0'))::uuid,'channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001','macro|query-test@example.com','reply',200+i,'2026-01-01'::timestamptz+(200+i)*interval '1 second','2026-01-01' FROM generate_series(1,100000) i;
