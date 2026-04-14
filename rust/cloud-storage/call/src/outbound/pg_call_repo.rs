//! Postgres-backed repository for call state.

#[cfg(test)]
mod test;

use chrono::Utc;
use entity_access::domain::models::AccessLevel;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    Call, CallParticipant, CallRecord, CallRecordParticipant, CallRecordTranscriptSegment,
    TranscriptSegmentRequest,
};
use crate::domain::ports::CallRepository;

/// Postgres implementation of [`CallRepository`].
pub struct PgCallRepo {
    pool: PgPool,
}

impl PgCallRepo {
    /// Create a new repo with the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl CallRepository for PgCallRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self))]
    async fn create_call(
        &self,
        call_id: &Uuid,
        channel_id: &Uuid,
        room_name: &str,
        created_by: MacroUserIdStr<'_>,
    ) -> Result<Option<Call>, Self::Err> {
        // Create share permission
        let share_permission_id = uuid::Uuid::now_v7();
        let share_permission = SharePermissionV2 {
            id: share_permission_id.to_string(),
            is_public: false,
            public_access_level: None,
            owner: created_by.to_string(),
            channel_share_permissions: Some(vec![ChannelSharePermission {
                channel_id: channel_id.to_string(),
                access_level: AccessLevel::View,
            }]),
        };

        let mut tx = self.pool.begin().await?;

        // insert share permission
        sqlx::query!(
            r#"
            INSERT INTO "SharePermission" ("id", "isPublic","publicAccessLevel", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, NOW(), NOW())
        "#,
            share_permission.id,
            share_permission.is_public,
            share_permission
                .public_access_level
                .as_ref()
                .map(|s| s.to_string()),
        )
        .execute(tx.as_mut())
        .await?;

        // insert channel share permission
        sqlx::query!(
            r#"
            INSERT INTO "ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
            VALUES ($1, $2, $3)
            "#,
            &share_permission.id,
            &channel_id.to_string(),
            share_permission.channel_share_permissions.as_ref().unwrap()[0].access_level as _,
        )
        .execute(tx.as_mut())
        .await?;

        let row = sqlx::query!(
            r#"
            INSERT INTO calls (id, channel_id, room_name, created_by, share_permission_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (channel_id) DO NOTHING
            RETURNING id, channel_id, room_name, created_by, created_at, egress_id
            "#,
            call_id,
            channel_id,
            room_name,
            created_by.as_ref(),
            &share_permission_id.to_string(),
        )
        .fetch_optional(tx.as_mut())
        .await?;

        // only commit if there is a channel to create
        if let Some(r) = row {
            tx.commit().await?;

            Ok(Some(Call {
                id: r.id,
                channel_id: r.channel_id,
                room_name: r.room_name,
                created_by: r.created_by,
                created_at: r.created_at,
                egress_id: r.egress_id,
            }))
        } else {
            Ok(None)
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_by_channel_id(&self, channel_id: &Uuid) -> Result<Option<Call>, Self::Err> {
        sqlx::query!(
            r#"
            SELECT id, channel_id, room_name, created_by, created_at, egress_id
            FROM calls
            WHERE channel_id = $1
            "#,
            channel_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map(|opt| {
            opt.map(|row| Call {
                id: row.id,
                channel_id: row.channel_id,
                room_name: row.room_name,
                created_by: row.created_by,
                created_at: row.created_at,
                egress_id: row.egress_id,
            })
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_active_call_by_channel(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<Call>, Self::Err> {
        sqlx::query!(
            r#"
            SELECT id, channel_id, room_name, created_by, created_at, egress_id
            FROM calls
            WHERE channel_id = $1
            "#,
            channel_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map(|opt| {
            opt.map(|row| Call {
                id: row.id,
                channel_id: row.channel_id,
                room_name: row.room_name,
                created_by: row.created_by,
                created_at: row.created_at,
                egress_id: row.egress_id,
            })
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_by_room_name(&self, room_name: &str) -> Result<Option<Call>, Self::Err> {
        sqlx::query!(
            r#"
            SELECT id, channel_id, room_name, created_by, created_at, egress_id
            FROM calls
            WHERE room_name = $1
            "#,
            room_name,
        )
        .fetch_optional(&self.pool)
        .await
        .map(|opt| {
            opt.map(|row| Call {
                id: row.id,
                channel_id: row.channel_id,
                room_name: row.room_name,
                created_by: row.created_by,
                created_at: row.created_at,
                egress_id: row.egress_id,
            })
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn add_participant(
        &self,
        call_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<CallParticipant, Self::Err> {
        let row = sqlx::query!(
            r#"
            INSERT INTO call_participants (call_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (call_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now()
            RETURNING call_id, user_id, joined_at
            "#,
            call_id,
            user_id.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(CallParticipant {
            call_id: row.call_id,
            user_id: row.user_id,
            joined_at: row.joined_at,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn remove_participant(
        &self,
        call_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE call_participants
            SET left_at = now()
            WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL
            "#,
            call_id,
            user_id.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_participants(&self, call_id: &Uuid) -> Result<Vec<CallParticipant>, Self::Err> {
        sqlx::query!(
            r#"
            SELECT call_id, user_id, joined_at
            FROM call_participants
            WHERE call_id = $1 AND left_at IS NULL
            ORDER BY joined_at ASC
            "#,
            call_id,
        )
        .fetch_all(&self.pool)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(|row| CallParticipant {
                    call_id: row.call_id,
                    user_id: row.user_id,
                    joined_at: row.joined_at,
                })
                .collect()
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_participant_count(&self, call_id: &Uuid) -> Result<i64, Self::Err> {
        sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM call_participants
            WHERE call_id = $1 AND left_at IS NULL
            "#,
            call_id,
        )
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn is_participant(&self, call_id: &Uuid, user_id: &str) -> Result<bool, Self::Err> {
        sqlx::query_scalar!(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM call_participants
                WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL
            ) as "exists!"
            "#,
            call_id,
            user_id,
        )
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_call(&self, call_id: &Uuid) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            DELETE FROM calls WHERE id = $1
            "#,
            call_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn set_egress_id(&self, call_id: &Uuid, egress_id: &str) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE calls SET egress_id = $2 WHERE id = $1
            "#,
            call_id,
            egress_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn archive_call(&self, call_id: &Uuid) -> Result<Uuid, Self::Err> {
        let mut tx = self.pool.begin().await?;

        // Fetch and lock the active call so concurrent archive_call callers serialize.
        let call = sqlx::query!(
            r#"
            SELECT id, channel_id, room_name, created_by, created_at, egress_id, recording_key, share_permission_id
            FROM calls
            WHERE id = $1
            FOR UPDATE
            "#,
            call_id,
        )
        .fetch_optional(tx.as_mut())
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

        let now = Utc::now();
        let duration_ms = now
            .signed_duration_since(call.created_at)
            .num_milliseconds()
            .max(0);
        // Insert into call_records (including egress_id and any early recording_key).
        // The record keeps the same id as the original call.
        sqlx::query!(
            r#"
            INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, egress_id, recording_key, share_permission_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            "#,
            call_id,
            call.channel_id,
            call.room_name,
            call.created_by,
            call.created_at,
            now,
            duration_ms,
            call.egress_id,
            call.recording_key,
            &call.share_permission_id,
        )
        .execute(tx.as_mut())
        .await?;

        // Copy all participants (including soft-deleted) to call_record_participants.
        sqlx::query!(
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
        .await?;

        // Copy transcripts to call_record_transcripts.
        sqlx::query!(
            r#"
            INSERT INTO call_record_transcripts (call_record_id, segment_id, speaker_id, content, started_at, ended_at, sequence_num)
            SELECT $1, segment_id, speaker_id, content, started_at, ended_at, sequence_num
            FROM call_transcripts
            WHERE call_id = $2
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

        tx.commit().await?;
        Ok(*call_id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn set_recording_key(
        &self,
        call_record_id: &Uuid,
        recording_key: &str,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE call_records SET recording_key = $2 WHERE id = $1
            "#,
            call_record_id,
            recording_key,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_record_by_egress_id(
        &self,
        egress_id: &str,
    ) -> Result<Option<Uuid>, Self::Err> {
        sqlx::query_scalar!(
            r#"
            SELECT id FROM call_records WHERE egress_id = $1
            "#,
            egress_id,
        )
        .fetch_optional(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn set_active_call_recording_key(
        &self,
        egress_id: &str,
        recording_key: &str,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE calls SET recording_key = $2 WHERE egress_id = $1
            "#,
            egress_id,
            recording_key,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self, segment))]
    async fn create_transcript_segment(
        &self,
        call_id: &Uuid,
        segment: &TranscriptSegmentRequest,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO call_transcripts (call_id, segment_id, speaker_id, content, started_at, ended_at, sequence_num)
            VALUES ($1, $2, $3, $4, $5, $6, (
                SELECT COALESCE(MAX(sequence_num), 0) + 1
                FROM call_transcripts
                WHERE call_id = $1
            ))
            ON CONFLICT (call_id, segment_id) DO NOTHING
            "#,
            call_id,
            segment.segment_id,
            segment.speaker_id,
            segment.content,
            segment.started_at,
            segment.ended_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_record_by_call_id(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<CallRecord>, Self::Err> {
        // Use a read-only snapshot-isolation transaction so the call row and its
        // participants/transcripts all reflect the same point in time. Without this,
        // a concurrent `archive_call` can move rows from `calls` -> `call_records`
        // between our SELECTs, leaving us with an "active" call row but empty
        // participants/transcript (or vice versa). REPEATABLE READ gives a stable
        // snapshot; READ ONLY avoids blocking writers.
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await?;

        // Try active `calls` first.
        if let Some(active) = sqlx::query!(
            r#"
            SELECT id, channel_id, room_name, created_by, created_at, egress_id, recording_key
            FROM calls
            WHERE id = $1
            "#,
            call_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        {
            let participants = sqlx::query!(
                r#"
                SELECT user_id, joined_at, left_at
                FROM call_participants
                WHERE call_id = $1
                ORDER BY joined_at ASC
                "#,
                call_id,
            )
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|row| CallRecordParticipant {
                user_id: row.user_id,
                joined_at: row.joined_at,
                left_at: row.left_at,
            })
            .collect();

            let transcript = sqlx::query!(
                r#"
                SELECT segment_id, speaker_id, content, started_at, ended_at, sequence_num
                FROM call_transcripts
                WHERE call_id = $1
                ORDER BY sequence_num ASC
                "#,
                call_id,
            )
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|row| CallRecordTranscriptSegment {
                segment_id: Some(row.segment_id),
                speaker_id: row.speaker_id,
                content: row.content,
                started_at: row.started_at,
                ended_at: row.ended_at,
                sequence_num: row.sequence_num,
            })
            .collect();

            tx.commit().await?;
            return Ok(Some(CallRecord {
                call_id: active.id,
                channel_id: active.channel_id,
                room_name: active.room_name,
                created_by: active.created_by,
                started_at: active.created_at,
                ended_at: None,
                duration_ms: None,
                egress_id: active.egress_id,
                recording_key: active.recording_key,
                recording_url: None,
                is_active: true,
                participants,
                transcript,
            }));
        }

        // Fall back to archived `call_records`.
        let Some(archived) = sqlx::query!(
            r#"
            SELECT id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, egress_id, recording_key
            FROM call_records
            WHERE id = $1
            "#,
            call_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        else {
            tx.commit().await?;
            return Ok(None);
        };

        let participants = sqlx::query!(
            r#"
            SELECT user_id, joined_at, left_at
            FROM call_record_participants
            WHERE call_record_id = $1
            ORDER BY joined_at ASC
            "#,
            call_id,
        )
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|row| CallRecordParticipant {
            user_id: row.user_id,
            joined_at: row.joined_at,
            left_at: row.left_at,
        })
        .collect();

        let transcript = sqlx::query!(
            r#"
            SELECT segment_id, speaker_id, content, started_at, ended_at, sequence_num
            FROM call_record_transcripts
            WHERE call_record_id = $1
            ORDER BY sequence_num ASC
            "#,
            call_id,
        )
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|row| CallRecordTranscriptSegment {
            segment_id: row.segment_id,
            speaker_id: row.speaker_id,
            content: row.content,
            started_at: row.started_at,
            ended_at: row.ended_at,
            sequence_num: row.sequence_num,
        })
        .collect();

        tx.commit().await?;
        Ok(Some(CallRecord {
            call_id: archived.id,
            channel_id: archived.channel_id,
            room_name: archived.room_name,
            created_by: archived.created_by,
            started_at: archived.started_at,
            ended_at: Some(archived.ended_at),
            duration_ms: Some(archived.duration_ms),
            egress_id: archived.egress_id,
            recording_key: archived.recording_key,
            recording_url: None,
            is_active: false,
            participants,
            transcript,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_user_profile_picture<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> Result<Option<String>, Self::Err> {
        sqlx::query_scalar!(
            r#"
            SELECT mui.profile_picture
            FROM macro_user_info mui
            JOIN "User" u ON mui.macro_user_id = u.macro_user_id
            WHERE u.id = $1 AND mui.profile_picture IS NOT NULL
            LIMIT 1
            "#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .map(|opt| opt.flatten())
    }
}
