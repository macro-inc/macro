-- Calendars added by URL in Google now read as subscriptions. The flag is
-- computed from the calendar id on read, but a client holding a calendar
-- cache refetches a calendar only when the change log names it, so log an
-- upsert for every visible one on its inbox's link. Counter locks are taken
-- in link order, as every calendar write takes them. A rerun logs each
-- calendar again, which costs clients one more refetch.
WITH logged AS (
    SELECT account.email_link_id AS link_id,
           calendar.id AS calendar_id,
           row_number() OVER (PARTITION BY account.email_link_id ORDER BY calendar.id) AS position,
           count(*) OVER (PARTITION BY account.email_link_id) AS total
    FROM calendars calendar
    JOIN calendar_accounts account ON account.id = calendar.account_id
    WHERE account.provider = 'google'
      AND account.sync_status <> 'disabled'
      AND NOT calendar.is_deleted
      AND calendar.provider_calendar_id LIKE '%@import.calendar.google.com'
),
counters AS (
    INSERT INTO calendar_change_counters (link_id, seq)
    SELECT link_id, count(*)
    FROM logged
    GROUP BY link_id
    ORDER BY link_id
    ON CONFLICT (link_id) DO UPDATE
    SET seq = calendar_change_counters.seq + EXCLUDED.seq,
        updated_at = now()
    RETURNING link_id, seq
)
INSERT INTO calendar_change_log (link_id, seq, kind, calendar_id)
SELECT logged.link_id,
       counters.seq - logged.total + logged.position,
       3,
       logged.calendar_id
FROM logged
JOIN counters ON counters.link_id = logged.link_id;
