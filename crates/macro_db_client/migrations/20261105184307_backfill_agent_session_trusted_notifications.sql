-- Runs after the marking trigger has committed, so rows appended meanwhile are
-- marked by the trigger and this pass only has to cover existing rows. The
-- metadata key first shipped with 20261021213634_agent_session_notifications;
-- older rows cannot carry it.
UPDATE agent_session AS session
SET has_trusted_notifications = true
WHERE NOT session.has_trusted_notifications
  AND EXISTS (
      SELECT 1
      FROM agent_session_log AS log
      WHERE log.agent_session_id = session.id
        AND log.created_at >= '2026-10-21'
        AND log.direction IN ('notification', 'to_runtime')
        AND log.content->'params'->'_meta' ? 'macro.dev/notifications'
  );
