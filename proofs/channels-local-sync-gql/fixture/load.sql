BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM comms_channels WHERE id='5eed92f0-1c06-8932-b12c-277f6a59bad3') THEN RAISE EXCEPTION 'fixture already exists'; END IF; END $$;
CREATE TEMP TABLE perf_comms_channels ON COMMIT DROP AS SELECT id,name,channel_type,org_id,created_at,updated_at,owner_id,team_id,join_code,auto_join_team,profile_picture_id,label_id FROM comms_channels WITH NO DATA;
\copy perf_comms_channels (id,name,channel_type,org_id,created_at,updated_at,owner_id,team_id,join_code,auto_join_team,profile_picture_id,label_id) FROM '/tmp/channels-gql-private-fixture/comms_channels.csv' WITH (FORMAT csv)
INSERT INTO comms_channels (id,name,channel_type,org_id,created_at,updated_at,owner_id,team_id,join_code,auto_join_team,profile_picture_id,label_id) SELECT id,name,channel_type,org_id,created_at,updated_at,owner_id,team_id,join_code,auto_join_team,profile_picture_id,label_id FROM perf_comms_channels WHERE true ORDER BY id ON CONFLICT DO NOTHING;
CREATE TEMP TABLE perf_comms_messages ON COMMIT DROP AS SELECT id,thread_id,sender_id,content,created_at,updated_at,edited_at,deleted_at,triggered_by_user_id,parent_entity_type,parent_entity_id,imported_author,import_metadata,import_order,client_message_id,guest_name,triggered_via,kind FROM comms_messages WITH NO DATA;
\copy perf_comms_messages (id,thread_id,sender_id,content,created_at,updated_at,edited_at,deleted_at,triggered_by_user_id,parent_entity_type,parent_entity_id,imported_author,import_metadata,import_order,client_message_id,guest_name,triggered_via,kind) FROM '/tmp/channels-gql-private-fixture/comms_messages.csv' WITH (FORMAT csv)
INSERT INTO comms_messages (id,thread_id,sender_id,content,created_at,updated_at,edited_at,deleted_at,triggered_by_user_id,parent_entity_type,parent_entity_id,imported_author,import_metadata,import_order,client_message_id,guest_name,triggered_via,kind) SELECT id,thread_id,sender_id,content,created_at,updated_at,edited_at,deleted_at,triggered_by_user_id,parent_entity_type,parent_entity_id,imported_author,import_metadata,import_order,client_message_id,guest_name,triggered_via,kind FROM perf_comms_messages WHERE true ORDER BY thread_id IS NOT NULL, created_at, id ON CONFLICT DO NOTHING;
CREATE TEMP TABLE perf_comms_message_threads ON COMMIT DROP AS SELECT root_id,parent_entity_type,parent_entity_id,user_id,resolved,anchor,import_metadata,created_at,updated_at,deleted_at FROM comms_message_threads WITH NO DATA;
\copy perf_comms_message_threads (root_id,parent_entity_type,parent_entity_id,user_id,resolved,anchor,import_metadata,created_at,updated_at,deleted_at) FROM '/tmp/channels-gql-private-fixture/comms_message_threads.csv' WITH (FORMAT csv)
INSERT INTO comms_message_threads (root_id,parent_entity_type,parent_entity_id,user_id,resolved,anchor,import_metadata,created_at,updated_at,deleted_at) SELECT root_id,parent_entity_type,parent_entity_id,user_id,resolved,anchor,import_metadata,created_at,updated_at,deleted_at FROM perf_comms_message_threads WHERE true ORDER BY root_id ON CONFLICT (root_id) DO UPDATE SET parent_entity_type=EXCLUDED.parent_entity_type,parent_entity_id=EXCLUDED.parent_entity_id,user_id=EXCLUDED.user_id,resolved=EXCLUDED.resolved,anchor=EXCLUDED.anchor,import_metadata=EXCLUDED.import_metadata,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at;
CREATE TEMP TABLE perf_comms_attachments ON COMMIT DROP AS SELECT id,message_id,entity_type,entity_id,created_at,width,height FROM comms_attachments WITH NO DATA;
\copy perf_comms_attachments (id,message_id,entity_type,entity_id,created_at,width,height) FROM '/tmp/channels-gql-private-fixture/comms_attachments.csv' WITH (FORMAT csv)
INSERT INTO comms_attachments (id,message_id,entity_type,entity_id,created_at,width,height) SELECT id,message_id,entity_type,entity_id,created_at,width,height FROM perf_comms_attachments WHERE true ORDER BY id ON CONFLICT DO NOTHING;
CREATE TEMP TABLE perf_comms_reactions ON COMMIT DROP AS SELECT message_id,emoji,user_id,created_at FROM comms_reactions WITH NO DATA;
\copy perf_comms_reactions (message_id,emoji,user_id,created_at) FROM '/tmp/channels-gql-private-fixture/comms_reactions.csv' WITH (FORMAT csv)
INSERT INTO comms_reactions (message_id,emoji,user_id,created_at) SELECT message_id,emoji,user_id,created_at FROM perf_comms_reactions WHERE true ORDER BY message_id, emoji, user_id ON CONFLICT DO NOTHING;
CREATE TEMP TABLE perf_comms_entity_mentions ON COMMIT DROP AS SELECT created_at,entity_type,entity_id,source_entity_type,source_entity_id,id,user_id FROM comms_entity_mentions WITH NO DATA;
\copy perf_comms_entity_mentions (created_at,entity_type,entity_id,source_entity_type,source_entity_id,id,user_id) FROM '/tmp/channels-gql-private-fixture/comms_entity_mentions.csv' WITH (FORMAT csv)
INSERT INTO comms_entity_mentions (created_at,entity_type,entity_id,source_entity_type,source_entity_id,id,user_id) SELECT created_at,entity_type,entity_id,source_entity_type,source_entity_id,id,user_id FROM perf_comms_entity_mentions WHERE true ORDER BY id ON CONFLICT DO NOTHING;
CREATE TEMP TABLE perf_activity_events ON COMMIT DROP AS SELECT id,actor_id,subject_id,action,action_payload,entity_type,entity_id,occurred_at,agent_correlation_id,agent_verb,agent_session_id FROM activity_events WITH NO DATA;
\copy perf_activity_events (id,actor_id,subject_id,action,action_payload,entity_type,entity_id,occurred_at,agent_correlation_id,agent_verb,agent_session_id) FROM '/tmp/channels-gql-private-fixture/activity_events.csv' WITH (FORMAT csv)
INSERT INTO activity_events (id,actor_id,subject_id,action,action_payload,entity_type,entity_id,occurred_at,agent_correlation_id,agent_verb,agent_session_id) SELECT id,actor_id,subject_id,action,action_payload,entity_type,entity_id,occurred_at,agent_correlation_id,agent_verb,agent_session_id FROM perf_activity_events WHERE true ORDER BY id ON CONFLICT DO NOTHING;
INSERT INTO channel_change_counters(channel_id,seq) VALUES ('5eed92f0-1c06-8932-b12c-277f6a59bad3',1);
INSERT INTO channel_change_log(channel_id,seq,kind) VALUES ('5eed92f0-1c06-8932-b12c-277f6a59bad3',1,3);
COMMIT;
ANALYZE comms_channels;
ANALYZE comms_messages;
ANALYZE comms_message_threads;
ANALYZE comms_attachments;
ANALYZE comms_reactions;
ANALYZE comms_entity_mentions;
ANALYZE activity_events;
ANALYZE channel_change_counters;
ANALYZE channel_change_log;
