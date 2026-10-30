SET LOCAL lock_timeout = '5s';

CREATE TABLE agent_session_notification (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    kind text NOT NULL,
    subject_id text NOT NULL,
    payload jsonb NOT NULL,
    dedupe_key text NOT NULL,
    wake boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    outcome text CHECK (outcome IN ('delivered', 'noop')),
    producer_context jsonb NOT NULL DEFAULT '{}',
    lease_id uuid,
    lease_until timestamptz,
    action_id uuid,
    UNIQUE (session_id, dedupe_key)
);
CREATE INDEX agent_session_notification_pending
    ON agent_session_notification (session_id, created_at, id)
    WHERE delivered_at IS NULL;
ALTER TABLE agent_session ADD COLUMN turn_prompter_kind text NOT NULL DEFAULT 'user';
ALTER TABLE agent_session_log DROP CONSTRAINT agent_session_log_direction_check;
ALTER TABLE agent_session_log ADD CONSTRAINT agent_session_log_direction_check
    CHECK (direction IN ('to_server', 'to_runtime', 'notification')) NOT VALID;

-- Preserve pending outcomes from the former review mini-outbox. Reuse its
-- action identity so recovery recognizes an outcome that already reached ACP.
INSERT INTO agent_session_notification (
    id, session_id, kind, subject_id, payload, dedupe_key, wake, action_id
)
SELECT (review.record->>'notificationId')::uuid,
       review.agent_session_id, 'review.settled', review.id::text,
       jsonb_build_object(
           'outcome', CASE WHEN outcomes.dismissed THEN 'dismissed'
                           WHEN outcomes.approved THEN 'approved' ELSE 'partial' END,
           'by', session.owner_id, 'via', 'card', 'items', outcomes.items
       ),
       'review.legacy:' || (review.record->>'notificationId'), true,
       (review.record->>'notificationId')::uuid
FROM agent_session_review review
JOIN agent_session session ON session.id = review.agent_session_id
CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', item.value->'id', 'status', item.value->'status',
               'edited', false, 'error', item.value->'error'
           ) ORDER BY item.ordinality), '[]'::jsonb) AS items,
           bool_and(item.value->>'status' = 'dismissed') AS dismissed,
           bool_and(item.value->>'status' IN ('completed', 'submitting')) AS approved
    FROM jsonb_array_elements(review.record->'items') WITH ORDINALITY AS item
) outcomes
WHERE review.record->>'notificationId' IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(review.record->'items') AS item
      WHERE item->>'status' = 'submitting'
  )
ON CONFLICT (session_id, dedupe_key) DO NOTHING;

-- Older replicas can finish a review after this migration's backfill. Bridge
-- those writes until all producers use the typed transaction-aware port.
CREATE FUNCTION queue_legacy_review_notification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO agent_session_notification (
        id, session_id, kind, subject_id, payload, dedupe_key, wake, action_id
    )
    SELECT (NEW.record->>'notificationId')::uuid,
           NEW.agent_session_id, 'review.settled', NEW.id::text,
           jsonb_build_object(
               'outcome', CASE WHEN outcomes.dismissed THEN 'dismissed'
                               WHEN outcomes.approved THEN 'approved' ELSE 'partial' END,
               'by', session.owner_id, 'via', 'card', 'items', outcomes.items
           ),
           'review.legacy:' || (NEW.record->>'notificationId'), true,
           (NEW.record->>'notificationId')::uuid
    FROM agent_session session
    CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'id', item.value->'id', 'status', item.value->'status',
                   'edited', false, 'error', item.value->'error'
               ) ORDER BY item.ordinality), '[]'::jsonb) AS items,
               bool_and(item.value->>'status' = 'dismissed') AS dismissed,
               bool_and(item.value->>'status' IN ('completed', 'submitting')) AS approved
        FROM jsonb_array_elements(NEW.record->'items') WITH ORDINALITY AS item
    ) outcomes
    WHERE session.id = NEW.agent_session_id
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(NEW.record->'items') AS item
          WHERE item->>'status' = 'submitting'
      )
    ON CONFLICT (session_id, dedupe_key) DO NOTHING;
    RETURN NEW;
END;
$$;
CREATE TRIGGER agent_session_review_legacy_notification
AFTER INSERT OR UPDATE OF record ON agent_session_review
FOR EACH ROW WHEN (NEW.record->>'notificationId' IS NOT NULL)
EXECUTE FUNCTION queue_legacy_review_notification();
