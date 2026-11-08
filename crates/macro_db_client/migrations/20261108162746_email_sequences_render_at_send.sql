-- Sequence steps are rendered when the sweep creates them, from the
-- sequence's current steps, so enrollments keep no copy and edits need no
-- version. Steps get stable ids, which step history is keyed by. An email that
-- didn't go out is `needs_attention` without a reason, and an inbox or access
-- problem only holds steps back.
--
-- Existing step ids derive from the sequence and position, so recorded
-- history keeps pointing at the step it was.
SET LOCAL lock_timeout = '5s';

UPDATE email_sequences s
SET steps = (
    SELECT COALESCE(
        jsonb_agg(t.step || jsonb_build_object('id', md5(s.id::text || '/' || (t.n - 1))::uuid) ORDER BY t.n),
        '[]'::jsonb)
    FROM jsonb_array_elements(s.steps) WITH ORDINALITY AS t(step, n));

ALTER TABLE email_sequences DROP COLUMN version;

ALTER TABLE email_sequence_steps ADD COLUMN step_id uuid;
UPDATE email_sequence_steps h
SET step_id = md5(e.sequence_id::text || '/' || h.step)::uuid
FROM email_sequence_enrollments e
WHERE e.id = h.enrollment_id;
ALTER TABLE email_sequence_steps
    ALTER COLUMN step_id SET NOT NULL,
    DROP CONSTRAINT email_sequence_steps_pkey,
    ADD PRIMARY KEY (enrollment_id, step_id),
    DROP COLUMN step;

UPDATE email_sequence_enrollments
SET status = 'active', reason = NULL, due_at = COALESCE(due_at, now())
WHERE reason IN ('access_lost', 'inbox_unavailable');
UPDATE email_sequence_enrollments SET reason = NULL WHERE status = 'needs_attention';

ALTER TABLE email_sequence_enrollments
    DROP CONSTRAINT email_sequence_enrollments_check,
    DROP CONSTRAINT email_sequence_enrollments_reason_check,
    ADD CONSTRAINT email_sequence_enrollments_reason_check
        CHECK (reason IN ('manual', 'replied', 'bounced', 'unsubscribed', 'contact_removed')),
    ADD CONSTRAINT email_sequence_enrollments_check CHECK ((status = 'stopped') = (reason IS NOT NULL)),
    DROP COLUMN steps,
    DROP COLUMN next_step,
    DROP COLUMN attempts;

DROP INDEX email_sequence_enrollments_waiting_idx;
