//! Persistence for recording defaults, team recording blocks, and the flag
//! that marks a live call as joined by someone from outside its host's team.

#[cfg(test)]
mod test;

use super::*;
use crate::domain::recording::{CallKinds, CallKindsPatch, CallTurnedExternal, RecordingRules};

impl PgCallRepo {
    #[tracing::instrument(err, skip(self))]
    pub(super) async fn load_recording_rules(
        &self,
        user_id: &str,
        team_id: Option<Uuid>,
    ) -> Result<RecordingRules, CallError> {
        // Absent rows keep the column defaults: record everything, block nothing.
        let row = sqlx::query!(
            r#"
            SELECT
                COALESCE(p.record_huddles, TRUE) AS "record_huddles!",
                COALESCE(p.record_internal_meetings, TRUE) AS "record_internal_meetings!",
                COALESCE(p.record_external_meetings, TRUE) AS "record_external_meetings!",
                COALESCE(t.block_huddles, FALSE) AS "block_huddles!",
                COALESCE(t.block_internal_meetings, FALSE) AS "block_internal_meetings!",
                COALESCE(t.block_external_meetings, FALSE) AS "block_external_meetings!"
            FROM (SELECT 1) AS anchor
            LEFT JOIN call_recording_preferences p ON p.user_id = $1
            LEFT JOIN call_team_recording_policies t ON t.team_id = $2
            "#,
            user_id,
            team_id,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(RecordingRules {
            record_by_default: CallKinds {
                huddles: row.record_huddles,
                internal_meetings: row.record_internal_meetings,
                external_meetings: row.record_external_meetings,
            },
            blocked: CallKinds {
                huddles: row.block_huddles,
                internal_meetings: row.block_internal_meetings,
                external_meetings: row.block_external_meetings,
            },
        })
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn patch_recording_defaults(
        &self,
        user_id: &str,
        patch: CallKindsPatch,
    ) -> Result<CallKinds, CallError> {
        // Each kind is merged in SQL so concurrent patches to different kinds
        // both land.
        let row = sqlx::query!(
            r#"
            INSERT INTO call_recording_preferences
                (user_id, record_huddles, record_internal_meetings, record_external_meetings)
            VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE))
            ON CONFLICT (user_id) DO UPDATE SET
                record_huddles = COALESCE($2, call_recording_preferences.record_huddles),
                record_internal_meetings =
                    COALESCE($3, call_recording_preferences.record_internal_meetings),
                record_external_meetings =
                    COALESCE($4, call_recording_preferences.record_external_meetings),
                updated_at = now()
            RETURNING record_huddles, record_internal_meetings, record_external_meetings
            "#,
            user_id,
            patch.huddles,
            patch.internal_meetings,
            patch.external_meetings,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(CallKinds {
            huddles: row.record_huddles,
            internal_meetings: row.record_internal_meetings,
            external_meetings: row.record_external_meetings,
        })
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn patch_team_recording_blocks(
        &self,
        team_id: &Uuid,
        patch: CallKindsPatch,
    ) -> Result<CallKinds, CallError> {
        let row = sqlx::query!(
            r#"
            INSERT INTO call_team_recording_policies
                (team_id, block_huddles, block_internal_meetings, block_external_meetings)
            VALUES ($1, COALESCE($2, FALSE), COALESCE($3, FALSE), COALESCE($4, FALSE))
            ON CONFLICT (team_id) DO UPDATE SET
                block_huddles = COALESCE($2, call_team_recording_policies.block_huddles),
                block_internal_meetings =
                    COALESCE($3, call_team_recording_policies.block_internal_meetings),
                block_external_meetings =
                    COALESCE($4, call_team_recording_policies.block_external_meetings),
                updated_at = now()
            RETURNING block_huddles, block_internal_meetings, block_external_meetings
            "#,
            team_id,
            patch.huddles,
            patch.internal_meetings,
            patch.external_meetings,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(CallKinds {
            huddles: row.block_huddles,
            internal_meetings: row.block_internal_meetings,
            external_meetings: row.block_external_meetings,
        })
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn flag_call_external(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<CallTurnedExternal>, CallError> {
        // The row lock serializes this with recorder attachment, so the
        // returned egress id is whatever attached before the flag flipped.
        let turned = sqlx::query!(
            r#"
            UPDATE calls SET has_external_participants = TRUE
            WHERE id = $1 AND NOT has_external_participants
            RETURNING egress_id
            "#,
            call_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(turned.map(|row| CallTurnedExternal {
            egress_id: row.egress_id,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn call_has_external_participants(
        &self,
        call_id: &Uuid,
    ) -> Result<bool, CallError> {
        let external = sqlx::query_scalar!(
            "SELECT has_external_participants FROM calls WHERE id = $1",
            call_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(external.unwrap_or(false))
    }
}
