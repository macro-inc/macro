-- Scheduled actions for the source-list equality test, after
-- viewer_matrix.sql: one per grant source and one holding every grant, plus
-- grants on an action that no longer exists.
INSERT INTO scheduled_action (id, owner, name, schedule, kind, timezone, task, next_run_at, enabled)
SELECT matrix_item('scheduled-action', source_id), 'macro|matrix-owner@example.com', 'Direct',
       '0 * * * *', 'Agent', 'UTC', '{}'::jsonb, now(), true
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('scheduled-action', 'all'), 'macro|matrix-owner@example.com', 'All grants',
       '0 * * * *', 'Agent', 'UTC', '{}'::jsonb, now(), true;
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('scheduled-action', source_id), 'scheduled_action', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('scheduled-action', 'all'), 'scheduled_action', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('scheduled-action-gone', source_id), 'scheduled_action', source_id, source_type, level
FROM matrix_grant_source;
