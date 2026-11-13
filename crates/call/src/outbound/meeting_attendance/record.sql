INSERT INTO call_rtc_attendance (call_id, participant_sid, user_id, joined_at, left_at)
SELECT id, $2, $3, $4, LEAST($5::timestamptz, ended_at)
FROM call_entities
WHERE id = $1 AND created_via = 'native' AND attendance_tracked
  AND (ended_at IS NULL OR $4 < ended_at)
ON CONFLICT (call_id, participant_sid) DO UPDATE
SET joined_at = LEAST(call_rtc_attendance.joined_at, EXCLUDED.joined_at),
    left_at = LEAST(call_rtc_attendance.left_at, EXCLUDED.left_at)
WHERE call_rtc_attendance.user_id IS NOT DISTINCT FROM EXCLUDED.user_id
