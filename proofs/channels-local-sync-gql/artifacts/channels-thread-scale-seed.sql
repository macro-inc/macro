SET session_replication_role=replica;
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,sender_id,content,created_at,updated_at)
SELECT id,'channel','019fd3b9-0000-7000-8000-000000000002','macro|query-test@example.com','root','2026-01-01','2026-01-01' FROM unnest(ARRAY['019fd3b9-0050-7000-8000-000000000001'::uuid,'019fd3b9-1000-7000-8000-000000000001'::uuid]) id;
INSERT INTO comms_message_threads(root_id,parent_entity_type,parent_entity_id,user_id,created_at,updated_at)
SELECT id,parent_entity_type,parent_entity_id,sender_id,created_at,updated_at FROM comms_messages WHERE id=ANY(ARRAY['019fd3b9-0050-7000-8000-000000000001'::uuid,'019fd3b9-1000-7000-8000-000000000001'::uuid]);
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,thread_id,sender_id,content,import_order,created_at,updated_at)
SELECT (prefix||'-7000-8001-'||lpad(i::text,12,'0'))::uuid,'channel','019fd3b9-0000-7000-8000-000000000002',(prefix||'-7000-8000-000000000001')::uuid,'macro|query-test@example.com','reply',CASE WHEN i<=size*4/5 THEN i END,'2026-01-01'::timestamptz+i*interval '1 second','2026-01-01' FROM (VALUES('019fd3b9-0050',50),('019fd3b9-1000',1000)) fixture(prefix,size) CROSS JOIN LATERAL generate_series(1,size) i;
RESET session_replication_role;
ANALYZE comms_messages;
ANALYZE comms_message_threads;
