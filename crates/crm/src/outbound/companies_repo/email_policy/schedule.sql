-- One application UUIDv7 identifies this scheduling batch within each member slot.
-- Existing privacy actions schedule legacy history unchanged. Once a member has
-- an incarnation, capture it at this authorized producer, never at consumption.
WITH candidates AS MATERIALIZED (
    SELECT team_id, user_id, link_id, consent_incarnation, policy_version
    FROM crm_email_consent
    WHERE team_id = $1 AND ($2::text IS NULL OR user_id = $2)
      AND (enabled OR selected_enabled)
), modern AS (
    INSERT INTO crm_email_policy_work
        (team_id, user_id, link_id, consent_incarnation, policy_version, work_id, traceparent)
    SELECT team_id, user_id, link_id, consent_incarnation, policy_version, $4, $3
    FROM candidates WHERE consent_incarnation IS NOT NULL
    ON CONFLICT (team_id, user_id) DO UPDATE SET link_id = EXCLUDED.link_id,
        consent_incarnation = EXCLUDED.consent_incarnation, policy_version = EXCLUDED.policy_version,
        work_id = EXCLUDED.work_id, after_thread_id = NULL, after_contact_address = NULL,
        received_pass = FALSE, requested_at = now(), traceparent = EXCLUDED.traceparent
    RETURNING team_id, user_id, link_id, consent_incarnation, policy_version, work_id
)
INSERT INTO crm_email_backfill_outbox
    (team_id, user_id, link_id, consent_incarnation, policy_version, work_id, traceparent)
SELECT team_id, user_id, link_id, consent_incarnation, policy_version, work_id, $3 FROM modern
UNION ALL
SELECT team_id, user_id, NULL::uuid, NULL::uuid, NULL::bigint, NULL::uuid, $3
FROM candidates WHERE consent_incarnation IS NULL
ON CONFLICT (team_id, user_id) DO UPDATE SET link_id = EXCLUDED.link_id,
    consent_incarnation = EXCLUDED.consent_incarnation, policy_version = EXCLUDED.policy_version,
    work_id = EXCLUDED.work_id, traceparent = EXCLUDED.traceparent, requested_at = now()
