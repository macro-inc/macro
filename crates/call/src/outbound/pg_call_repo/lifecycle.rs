//! Atomic call archival and participant coordination.

use super::*;

impl PgCallRepo {
    #[tracing::instrument(err, skip(self))]
    pub(super) async fn archive_session(
        &self,
        call_id: &Uuid,
        require_empty: bool,
    ) -> Result<Option<ArchivedCall>, CallError> {
        let mut tx = self.pool.begin().await?;
        // The live share-with-team intent is translated into canonical team
        // sharing below, so take the shared guard before moving any rows.
        share_permission_db_utils::team_share::acquire_guard(&mut tx).await?;

        // Fetch and lock the active call so concurrent archive_call callers serialize.
        let call = sqlx::query!(
            r#"
            SELECT id, channel_id, room_name, created_by, created_at, egress_id, recording_key, preview_url, recording_started_at, share_permission_id, share_with_team, meeting_id,
                   (SELECT title FROM call_meetings WHERE id = calls.meeting_id) AS meeting_title
            FROM calls
            WHERE id = $1
            FOR UPDATE
            "#,
            call_id,
        )
        .fetch_optional(tx.as_mut())
        .await?
        .ok_or_else(|| CallError::NotFound(call_id.to_string()))?;

        if require_empty
            && sqlx::query_scalar!(
                r#"SELECT (
                    EXISTS(SELECT 1 FROM call_participants WHERE call_id = $1 AND left_at IS NULL)
                    OR EXISTS(SELECT 1 FROM call_guests WHERE call_id = $1 AND left_at IS NULL)
                ) AS "exists!""#,
                call_id,
            )
            .fetch_one(tx.as_mut())
            .await?
        {
            return Ok(None);
        }

        let ended_at = Utc::now().trunc_subsecs(6);
        let duration_ms = ended_at
            .signed_duration_since(call.created_at)
            .num_milliseconds()
            .max(0);
        let has_recording = call.egress_id.is_some();
        let share_with_team = crate::domain::models::permitted_team_memory_intent(
            call.channel_id,
            call.share_with_team,
        );
        // Insert into call_records (including egress_id and any early recording keys).
        // The record keeps the same id as the original call.
        // The legacy column is still copied for older readers until it is
        // dropped; new readers derive `share_with_team` from canonical state.
        sqlx::query!(
            r#"
            INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, egress_id, recording_key, preview_url, recording_started_at, share_permission_id, share_with_team, meeting_id, custom_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            "#,
            call_id,
            call.channel_id,
            call.room_name,
            call.created_by,
            call.created_at,
            ended_at,
            duration_ms,
            call.egress_id,
            call.recording_key,
            call.preview_url,
            call.recording_started_at,
            &call.share_permission_id,
            share_with_team,
            call.meeting_id,
            call.meeting_title,
        )
        .execute(tx.as_mut())
        .await?;

        // Translate the live intent into canonical team sharing: View for the
        // creator's current team when the toggle was on, nothing otherwise.
        team_share::translate_live_share_with_team(&mut tx, call_id, share_with_team).await?;

        // Copy all lifetime-distinct participants (including soft-deleted) to
        // call_record_participants. Each inserted row represents one participant.
        let participant_count = sqlx::query!(
            r#"
            INSERT INTO call_record_participants (call_record_id, user_id, joined_at, left_at)
            SELECT $1, user_id, joined_at, left_at
            FROM call_participants
            WHERE call_id = $2
            "#,
            call_id,
            call_id,
        )
        .execute(tx.as_mut())
        .await?
        .rows_affected() as usize;

        // Copy guests the same way; the archived rows keep the guest ids so
        // transcript speaker ids remain resolvable to display names.
        sqlx::query!(
            r#"
            INSERT INTO call_record_guests (call_record_id, id, display_name, joined_at, left_at)
            SELECT $1, id, display_name, joined_at, left_at
            FROM call_guests
            WHERE call_id = $2
            "#,
            call_id,
            call_id,
        )
        .execute(tx.as_mut())
        .await?;

        // Copy transcripts to call_record_transcripts, rolling up consecutive
        // segments that share both speaker_id and diarized_speaker_id when the
        // gap between them (next.started_at - prev.ended_at) is <= 5 seconds.
        // voice_id must also match so the propagated value is unambiguous.
        sqlx::query!(
            r#"
            WITH ordered AS (
                SELECT
                    segment_id,
                    speaker_id,
                    diarized_speaker_id,
                    voice_id,
                    content,
                    started_at,
                    ended_at,
                    sequence_num,
                    LAG(speaker_id) OVER w AS prev_speaker_id,
                    LAG(diarized_speaker_id) OVER w AS prev_diarized_speaker_id,
                    LAG(voice_id) OVER w AS prev_voice_id,
                    LAG(ended_at) OVER w AS prev_ended_at
                FROM call_transcripts
                WHERE call_id = $2
                WINDOW w AS (ORDER BY sequence_num)
            ),
            marked AS (
                SELECT
                    segment_id,
                    speaker_id,
                    diarized_speaker_id,
                    voice_id,
                    content,
                    started_at,
                    ended_at,
                    sequence_num,
                    CASE
                        WHEN prev_speaker_id IS NOT NULL
                            AND speaker_id = prev_speaker_id
                            AND diarized_speaker_id IS NOT DISTINCT FROM prev_diarized_speaker_id
                            AND voice_id IS NOT DISTINCT FROM prev_voice_id
                            AND prev_ended_at IS NOT NULL
                            AND started_at - prev_ended_at <= INTERVAL '5 seconds'
                        THEN 0
                        ELSE 1
                    END AS is_new_group
                FROM ordered
            ),
            grouped AS (
                SELECT
                    segment_id,
                    speaker_id,
                    diarized_speaker_id,
                    voice_id,
                    content,
                    started_at,
                    ended_at,
                    sequence_num,
                    SUM(is_new_group) OVER (ORDER BY sequence_num) AS group_id
                FROM marked
            )
            INSERT INTO call_record_transcripts (call_record_id, segment_id, speaker_id, diarized_speaker_id, voice_id, content, started_at, ended_at, sequence_num)
            SELECT
                $1,
                MIN(segment_id),
                MIN(speaker_id),
                MIN(diarized_speaker_id),
                -- voice_id is UUID (no MIN); all rows in a group share the same value via IS NOT DISTINCT FROM.
                (array_agg(voice_id ORDER BY sequence_num))[1],
                STRING_AGG(content, ' ' ORDER BY sequence_num),
                MIN(started_at),
                MAX(ended_at),
                MIN(sequence_num)
            FROM grouped
            GROUP BY group_id
            "#,
            call_id,
            call_id,
        )
        .execute(tx.as_mut())
        .await?;

        // Delete the ephemeral call (cascades to call_participants and call_transcripts).
        sqlx::query!(
            r#"
            DELETE FROM calls WHERE id = $1
            "#,
            call_id,
        )
        .execute(tx.as_mut())
        .await?;

        let archived = ArchivedCall {
            call_id: call.id,
            channel_id: call.channel_id,
            created_by: call.created_by,
            started_at: call.created_at,
            ended_at,
            duration_ms,
            has_recording,
            participant_count,
        };

        tx.commit().await?;
        Ok(Some(archived))
    }
}

pub(super) async fn lock_active_call(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    call_id: &Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query_scalar!("SELECT id FROM calls WHERE id = $1 FOR KEY SHARE", call_id)
        .fetch_one(tx.as_mut())
        .await?;
    Ok(())
}
