WITH requested AS (
    SELECT token, starts_at, ends_at, ordinal
    FROM unnest($1::text[], $2::timestamptz[], $3::timestamptz[])
        WITH ORDINALITY AS r(token, starts_at, ends_at, ordinal)
)
SELECT r.ordinal AS "ordinal!",
       COALESCE(e.attendance_tracked AND e.ended_at IS NOT NULL AND NOT m.attendance_incomplete, false) AS "tracked!",
       a.user_id, a.participant_sid AS "participant_sid?"
FROM requested r
LEFT JOIN call_meetings m ON m.share_token = r.token
LEFT JOIN LATERAL (
    SELECT id, ended_at, attendance_tracked
    FROM call_entities
    WHERE meeting_id = m.id AND created_via = 'native'
      AND started_at < r.ends_at
      AND COALESCE(ended_at, 'infinity'::timestamptz) > r.starts_at
    LIMIT 10001
) e ON true
LEFT JOIN LATERAL (
    SELECT user_id, participant_sid
    FROM call_rtc_attendance
    WHERE call_id = e.id AND joined_at < r.ends_at
      AND COALESCE(left_at, e.ended_at, 'infinity'::timestamptz) > r.starts_at
    LIMIT 10001
) a ON true
LIMIT 10001
