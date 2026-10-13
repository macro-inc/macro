//! Persistence for call settings, team call policies, and the flags that track
//! who a live standalone call has had and whether it has recorded.

#[cfg(test)]
mod test;

use super::*;
use crate::domain::recording::{
    CallKind, CallKinds, CallPreferences, MeetingAttendance, MeetingKindChange, RecordingRules,
    ShareAudience, ShareByDefault, UpdateCallSettingsRequest, UpdateTeamCallPolicyRequest,
};

/// The audience stored as `name`.
fn stored_audience(name: &str) -> Result<ShareAudience, CallError> {
    ShareAudience::from_name(name)
        .ok_or_else(|| CallError::Internal(anyhow::anyhow!("unknown call share audience {name:?}")))
}

impl PgCallRepo {
    #[tracing::instrument(err, skip(self))]
    pub(super) async fn load_call_preferences(
        &self,
        user_id: &str,
        team_id: Option<Uuid>,
    ) -> Result<CallPreferences, CallError> {
        // Absent rows keep the column defaults: record everything, share each
        // kind with its default audience, refuse nothing, block nothing.
        let row = sqlx::query!(
            r#"
            SELECT
                COALESCE(p.record_huddles, TRUE) AS "record_huddles!",
                COALESCE(p.record_one_on_ones, TRUE) AS "record_one_on_ones!",
                COALESCE(p.record_internal_meetings, TRUE) AS "record_internal_meetings!",
                COALESCE(p.record_external_meetings, TRUE) AS "record_external_meetings!",
                COALESCE(p.share_huddles, 'channel') AS "share_huddles!",
                COALESCE(p.share_one_on_ones, 'participants') AS "share_one_on_ones!",
                COALESCE(p.share_internal_meetings, 'invited') AS "share_internal_meetings!",
                COALESCE(p.share_external_meetings, 'team') AS "share_external_meetings!",
                COALESCE(p.refuse_one_on_one_recording, FALSE)
                    AS "refuse_one_on_one_recording!",
                COALESCE(t.block_recording_huddles, FALSE) AS "block_recording_huddles!",
                COALESCE(t.block_recording_one_on_ones, FALSE)
                    AS "block_recording_one_on_ones!",
                COALESCE(t.block_recording_internal_meetings, FALSE)
                    AS "block_recording_internal_meetings!",
                COALESCE(t.block_recording_external_meetings, FALSE)
                    AS "block_recording_external_meetings!",
                COALESCE(t.block_huddle_sharing, FALSE) AS "block_huddle_sharing!"
            FROM (SELECT 1) AS anchor
            LEFT JOIN call_preferences p ON p.user_id = $1
            LEFT JOIN call_team_policies t ON t.team_id = $2
            "#,
            user_id,
            team_id,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(CallPreferences {
            recording: RecordingRules {
                record_by_default: CallKinds {
                    huddles: row.record_huddles,
                    one_on_ones: row.record_one_on_ones,
                    internal_meetings: row.record_internal_meetings,
                    external_meetings: row.record_external_meetings,
                },
                blocked: CallKinds {
                    huddles: row.block_recording_huddles,
                    one_on_ones: row.block_recording_one_on_ones,
                    internal_meetings: row.block_recording_internal_meetings,
                    external_meetings: row.block_recording_external_meetings,
                },
            },
            share_by_default: ShareByDefault {
                huddles: stored_audience(&row.share_huddles)?,
                one_on_ones: stored_audience(&row.share_one_on_ones)?,
                internal_meetings: stored_audience(&row.share_internal_meetings)?,
                external_meetings: stored_audience(&row.share_external_meetings)?,
            },
            huddle_sharing_blocked: row.block_huddle_sharing,
            refuses_one_on_one_recording: row.refuse_one_on_one_recording,
        })
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn patch_call_preferences(
        &self,
        user_id: &str,
        patch: UpdateCallSettingsRequest,
    ) -> Result<(), CallError> {
        // Each setting is merged in SQL so concurrent patches to different
        // settings both land.
        let record = patch.record_by_default;
        let share = patch.share_by_default;
        let audience = |audience: Option<ShareAudience>| audience.map(ShareAudience::as_str);
        sqlx::query!(
            r#"
            INSERT INTO call_preferences (
                user_id,
                record_huddles,
                record_one_on_ones,
                record_internal_meetings,
                record_external_meetings,
                share_huddles,
                share_one_on_ones,
                share_internal_meetings,
                share_external_meetings,
                refuse_one_on_one_recording
            )
            VALUES (
                $1,
                COALESCE($2, TRUE),
                COALESCE($3, TRUE),
                COALESCE($4, TRUE),
                COALESCE($5, TRUE),
                COALESCE($6, 'channel'),
                COALESCE($7, 'participants'),
                COALESCE($8, 'invited'),
                COALESCE($9, 'team'),
                COALESCE($10, FALSE)
            )
            ON CONFLICT (user_id) DO UPDATE SET
                record_huddles = COALESCE($2, call_preferences.record_huddles),
                record_one_on_ones =
                    COALESCE($3, call_preferences.record_one_on_ones),
                record_internal_meetings =
                    COALESCE($4, call_preferences.record_internal_meetings),
                record_external_meetings =
                    COALESCE($5, call_preferences.record_external_meetings),
                share_huddles = COALESCE($6, call_preferences.share_huddles),
                share_one_on_ones = COALESCE($7, call_preferences.share_one_on_ones),
                share_internal_meetings =
                    COALESCE($8, call_preferences.share_internal_meetings),
                share_external_meetings =
                    COALESCE($9, call_preferences.share_external_meetings),
                refuse_one_on_one_recording =
                    COALESCE($10, call_preferences.refuse_one_on_one_recording),
                updated_at = now()
            "#,
            user_id,
            record.huddles,
            record.one_on_ones,
            record.internal_meetings,
            record.external_meetings,
            audience(share.huddles),
            audience(share.one_on_ones),
            audience(share.internal_meetings),
            audience(share.external_meetings),
            patch.refuse_one_on_one_recording,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn patch_team_call_policy(
        &self,
        team_id: &Uuid,
        patch: UpdateTeamCallPolicyRequest,
    ) -> Result<(), CallError> {
        let recording = patch.recording_blocked;
        sqlx::query!(
            r#"
            INSERT INTO call_team_policies (
                team_id,
                block_recording_huddles,
                block_recording_one_on_ones,
                block_recording_internal_meetings,
                block_recording_external_meetings,
                block_huddle_sharing
            )
            VALUES (
                $1,
                COALESCE($2, FALSE),
                COALESCE($3, FALSE),
                COALESCE($4, FALSE),
                COALESCE($5, FALSE),
                COALESCE($6, FALSE)
            )
            ON CONFLICT (team_id) DO UPDATE SET
                block_recording_huddles =
                    COALESCE($2, call_team_policies.block_recording_huddles),
                block_recording_one_on_ones =
                    COALESCE($3, call_team_policies.block_recording_one_on_ones),
                block_recording_internal_meetings =
                    COALESCE($4, call_team_policies.block_recording_internal_meetings),
                block_recording_external_meetings =
                    COALESCE($5, call_team_policies.block_recording_external_meetings),
                block_huddle_sharing = COALESCE($6, call_team_policies.block_huddle_sharing),
                updated_at = now()
            "#,
            team_id,
            recording.huddles,
            recording.one_on_ones,
            recording.internal_meetings,
            recording.external_meetings,
            patch.huddle_sharing_blocked,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn flag_call_more_than_two(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<MeetingKindChange>, CallError> {
        // Participant rows outlive leaving, so this counts everyone who has
        // joined. Each join commits its own row before calling this, so of two
        // racing joins, the one that commits last sees both rows. An external
        // call is already past the one-on-one kind, so it never flips.
        let changed = sqlx::query!(
            r#"
            UPDATE calls
            SET has_more_than_two_participants = TRUE, one_on_one_recording_refused_by = '{}'
            WHERE id = $1
                AND NOT has_more_than_two_participants
                AND NOT has_external_participants
                AND (SELECT COUNT(*) FROM call_participants WHERE call_id = $1) > 2
            RETURNING egress_id
            "#,
            call_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(changed.map(|row| MeetingKindChange {
            egress_id: row.egress_id,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn flag_call_external(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<MeetingKindChange>, CallError> {
        // The row lock serializes this with recorder attachment, so the
        // returned egress id is whatever attached before the flag flipped.
        let changed = sqlx::query!(
            r#"
            UPDATE calls
            SET has_external_participants = TRUE, one_on_one_recording_refused_by = '{}'
            WHERE id = $1 AND NOT has_external_participants
            RETURNING egress_id
            "#,
            call_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(changed.map(|row| MeetingKindChange {
            egress_id: row.egress_id,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn read_meeting_attendance(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<MeetingAttendance>, CallError> {
        let attendance = sqlx::query!(
            r#"
            SELECT has_more_than_two_participants, has_external_participants
            FROM calls WHERE id = $1
            "#,
            call_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(attendance.map(|row| MeetingAttendance {
            more_than_two: row.has_more_than_two_participants,
            external: row.has_external_participants,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn claim_recorder(&self, call_id: &Uuid) -> Result<bool, CallError> {
        let claimed = sqlx::query!(
            "UPDATE calls SET recorder_claimed = TRUE WHERE id = $1 AND NOT recorder_claimed",
            call_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(claimed.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn claim_transcriber(&self, call_id: &Uuid) -> Result<bool, CallError> {
        let claimed = sqlx::query!(
            "UPDATE calls SET transcriber_claimed = TRUE WHERE id = $1 AND NOT transcriber_claimed",
            call_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(claimed.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn load_meeting_participant_ids(
        &self,
        call_id: &Uuid,
    ) -> Result<Vec<String>, CallError> {
        // Rows outlive leaving, so this is everyone who has joined.
        Ok(sqlx::query_scalar!(
            "SELECT user_id FROM call_participants WHERE call_id = $1 ORDER BY user_id",
            call_id,
        )
        .fetch_all(&self.pool)
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn load_direct_message_participants(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<Vec<String>>, CallError> {
        let is_direct_message = sqlx::query_scalar!(
            r#"
            SELECT channel_type = 'direct_message' AS "is_direct_message!"
            FROM comms_channels WHERE id = $1
            "#,
            channel_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        if is_direct_message != Some(true) {
            return Ok(None);
        }
        let participants = sqlx::query_scalar!(
            r#"
            SELECT user_id FROM comms_channel_participants
            WHERE channel_id = $1 AND left_at IS NULL
            ORDER BY user_id
            "#,
            channel_id,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(Some(participants))
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn load_one_on_one_refusers(
        &self,
        user_ids: &[String],
    ) -> Result<Vec<String>, CallError> {
        Ok(sqlx::query_scalar!(
            r#"
            SELECT user_id FROM call_preferences
            WHERE user_id = ANY($1) AND refuse_one_on_one_recording
            ORDER BY user_id
            "#,
            user_ids,
        )
        .fetch_all(&self.pool)
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn store_one_on_one_refusals(
        &self,
        call_id: &Uuid,
        refused_by: &[String],
    ) -> Result<bool, CallError> {
        // Only a call still in its one-on-one that has not started transcribing
        // is held to the refusal; a call past it has already been decided.
        let stored = sqlx::query!(
            r#"
            UPDATE calls SET one_on_one_recording_refused_by = $2
            WHERE id = $1
                AND NOT transcriber_claimed
                AND NOT has_more_than_two_participants
                AND NOT has_external_participants
            "#,
            call_id,
            refused_by,
        )
        .execute(&self.pool)
        .await?;
        Ok(stored.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn store_meeting_audience(
        &self,
        call_id: &Uuid,
        kind: CallKind,
        audience: ShareAudience,
    ) -> Result<(), CallError> {
        // Only the call's current kind writes, so a slow write for a kind the
        // call has since outgrown cannot undo a later one.
        let kind = match kind {
            CallKind::Huddle => return Ok(()),
            CallKind::OneOnOne => "one_on_one",
            CallKind::InternalMeeting => "internal",
            CallKind::ExternalMeeting => "external",
        };
        sqlx::query!(
            r#"
            UPDATE calls SET share_with_team = $3, share_with_invitees = $4
            WHERE id = $1
                AND channel_id IS NULL
                AND CASE $2::text
                    WHEN 'external' THEN has_external_participants
                    WHEN 'internal'
                        THEN has_more_than_two_participants AND NOT has_external_participants
                    ELSE NOT has_more_than_two_participants AND NOT has_external_participants
                END
            "#,
            call_id,
            kind,
            audience == ShareAudience::Team,
            audience == ShareAudience::Invited,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn unshare_live_huddles(&self, team_id: &Uuid) -> Result<(), CallError> {
        sqlx::query!(
            r#"
            UPDATE calls c SET share_with_team = FALSE
            FROM team_user tu
            WHERE tu.team_id = $1
                AND tu.user_id = c.created_by
                AND c.channel_id IS NOT NULL
                AND c.share_with_team
            "#,
            team_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
