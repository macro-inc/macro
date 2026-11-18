-- Until November 2026 the Outlook sync logged no change when a calendar's
-- sync error badge appeared, changed or cleared, so a client holding a
-- calendar cache can still show an error the server has cleared, or miss one
-- it shows. Which caches missed which change is unknown, so log an upsert for
-- every visible Outlook calendar on its inbox's link, and every cache
-- refetches those calendars on its next sync. Counter locks are taken in link
-- order, as every calendar write takes them. A rerun logs each calendar
-- again, which costs clients one more refetch.
WITH logged AS (
    SELECT account.email_link_id AS link_id,
           calendar.id AS calendar_id,
           row_number() OVER (PARTITION BY account.email_link_id ORDER BY calendar.id) AS position,
           count(*) OVER (PARTITION BY account.email_link_id) AS total
    FROM calendars calendar
    JOIN calendar_accounts account ON account.id = calendar.account_id
    WHERE account.provider = 'outlook'
      AND account.sync_status <> 'disabled'
      AND NOT calendar.is_deleted
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
