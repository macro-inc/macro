set plan_cache_mode=force_generic_plan;
prepare prune(timestamptz,bigint) as DELETE FROM channel_change_log WHERE ctid = ANY(ARRAY(SELECT ctid FROM channel_change_log WHERE created_at < $1 ORDER BY created_at, channel_id, seq LIMIT $2));
explain execute prune(now(), 10000);
prepare rl(uuid,bigint,bigint,bigint) as WITH position AS MATERIALIZED (SELECT COALESCE((SELECT seq FROM channel_change_counters WHERE channel_id = $1), 0) AS seq)
SELECT position.seq AS counter, COALESCE((SELECT min(retained.seq) - 1 FROM channel_change_log retained WHERE retained.channel_id = $1), position.seq) AS floor, change.seq, change.kind, change.message_id, change.activity_id
FROM position LEFT JOIN LATERAL (SELECT log.seq, log.kind, log.message_id, log.activity_id FROM channel_change_log log WHERE log.channel_id = $1 AND log.seq > $2 AND position.seq - $2 <= $3 ORDER BY log.seq LIMIT $4) change ON true ORDER BY change.seq;
explain execute rl(gen_random_uuid(),0,1000,500);
prepare act(uuid[],text,text,text[],text[]) as SELECT id, actor_id, occurred_at, action, action_payload FROM activity_events WHERE id = ANY($1) AND entity_type = $2 AND entity_id = $3 AND action = ANY($4) AND (action <> 'property_changed' OR cardinality($5::text[]) = 0 OR action_payload->>'property' = ANY($5::text[])) ORDER BY array_position($1, id);
explain execute act(array[gen_random_uuid()],'channel','x',array['a'],array[]::text[]);
prepare hyd(uuid[],uuid) as SELECT to_jsonb(message) FROM comms_messages message JOIN comms_messages root ON root.id = COALESCE(message.thread_id, message.id) WHERE message.id = ANY($1) AND message.parent_entity_type = 'channel' AND message.parent_entity_id = $2::text AND root.parent_entity_type = 'channel' AND root.parent_entity_id = $2::text ORDER BY array_position($1, message.id);
explain execute hyd(array[gen_random_uuid()],gen_random_uuid());
prepare pk(uuid) as SELECT job_id, message_id, channel_id FROM slack_import_message_reference WHERE completed_at IS NULL AND job_id > COALESCE($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid) ORDER BY job_id, message_id LIMIT 1;
explain execute pk(null);
prepare ce(uuid) as SELECT channel_id FROM call_entities WHERE id = $1 AND discussion = 'channel_thread' AND channel_id IS NOT NULL;
explain execute ce(gen_random_uuid());
