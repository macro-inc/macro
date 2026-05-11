//! Postgres-backed repository for call state.

mod edit;

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};

use chrono::Utc;
use comms::outbound::postgres::channel_name::batch_resolve_channel_names;
use entity_access::domain::models::AccessLevel;
use filter_ast::Expr;
use item_filters::ast::{LiteralTree, call::CallLiteral};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    AddParticipantError, Call, CallParticipant, CallRecord, CallRecordParticipant,
    CallRecordPreview, CallRecordPreviewData, CallRecordTranscriptSegment, CustomSpeakerAssignment,
    EditCallRecordRequest, TranscriptSegmentRequest, WithCallId,
};
use crate::domain::ports::CallRepository;

/// Name of the partial unique index enforcing one active call per user.
const ACTIVE_CALL_UNIQUE_INDEX: &str = "call_participants_one_active_per_user";

/// Translate a sqlx error from an `add_participant` insert into the domain
/// [`AddParticipantError`]. A unique-violation on the
/// `call_participants_one_active_per_user` partial index becomes
/// [`AddParticipantError::UserAlreadyActive`]; everything else is wrapped.
fn classify_add_participant_err(err: sqlx::Error) -> AddParticipantError {
    if err.as_database_error().and_then(|db| db.constraint()) == Some(ACTIVE_CALL_UNIQUE_INDEX) {
        AddParticipantError::UserAlreadyActive
    } else {
        AddParticipantError::Repository(err.into())
    }
}

/// Extract channel_id UUIDs from a call filter AST.
fn extract_channel_ids(filter: &LiteralTree<CallLiteral>) -> Vec<Uuid> {
    let Some(expr) = filter else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    collect_channel_ids(expr, &mut ids);
    ids
}

fn collect_channel_ids(expr: &Expr<CallLiteral>, ids: &mut Vec<Uuid>) {
    match expr {
        Expr::Literal(CallLiteral::ChannelId(id)) => ids.push(*id),
        Expr::Literal(CallLiteral::CallId(_)) => {}
        Expr::Literal(CallLiteral::Attended(_)) => {}
        // Speaker is transcript-segment-only; soup's call list ignores it.
        Expr::Literal(CallLiteral::Speaker(_)) => {}
        Expr::And(a, b) | Expr::Or(a, b) => {
            collect_channel_ids(a, ids);
            collect_channel_ids(b, ids);
        }
        Expr::Not(inner) => collect_channel_ids(inner, ids),
    }
}

/// Extract call_id UUIDs from a call filter AST.
fn extract_call_ids(filter: &LiteralTree<CallLiteral>) -> Vec<Uuid> {
    let Some(expr) = filter else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    collect_call_ids(expr, &mut ids);
    ids
}

fn collect_call_ids(expr: &Expr<CallLiteral>, ids: &mut Vec<Uuid>) {
    match expr {
        Expr::Literal(CallLiteral::CallId(id)) => ids.push(*id),
        Expr::Literal(CallLiteral::ChannelId(_)) => {}
        Expr::Literal(CallLiteral::Attended(_)) => {}
        Expr::Literal(CallLiteral::Speaker(_)) => {}
        Expr::And(a, b) | Expr::Or(a, b) => {
            collect_call_ids(a, ids);
            collect_call_ids(b, ids);
        }
        Expr::Not(inner) => collect_call_ids(inner, ids),
    }
}

/// Extract the `attended` literal from a call filter AST, if any.
///
/// `ExpandFrame::expand_ast` only emits at most one `Attended` literal, so we
/// return the first one we find during a simple traversal.
fn extract_attended(filter: &LiteralTree<CallLiteral>) -> Option<bool> {
    let expr = filter.as_ref()?;
    find_attended(expr)
}

fn find_attended(expr: &Expr<CallLiteral>) -> Option<bool> {
    match expr {
        Expr::Literal(CallLiteral::Attended(b)) => Some(*b),
        Expr::Literal(CallLiteral::CallId(_)) => None,
        Expr::Literal(CallLiteral::ChannelId(_)) => None,
        Expr::Literal(CallLiteral::Speaker(_)) => None,
        Expr::And(a, b) | Expr::Or(a, b) => find_attended(a).or_else(|| find_attended(b)),
        Expr::Not(inner) => find_attended(inner).map(|b| !b),
    }
}

/// Postgres implementation of [`CallRepository`].
#[derive(Clone)]
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
                access_level: AccessLevel::Edit,
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
            AccessLevel::Edit as _,
        )
        .execute(tx.as_mut())
        .await?;

        // owner entity access row
        entity_access_db_utils::insert_entity_access_row(
            &mut tx,
            call_id,
            entity_access_db_utils::EntityType::Call,
            created_by.as_ref(),
            entity_access_db_utils::EntityAccessSourceType::User,
            entity_access_db_utils::AccessLevel::Owner,
        )
        .await?;

        entity_access_db_utils::insert_entity_access_row(
            &mut tx,
            call_id,
            entity_access_db_utils::EntityType::Call,
            &channel_id.to_string(),
            entity_access_db_utils::EntityAccessSourceType::Channel,
            entity_access_db_utils::AccessLevel::Edit,
        )
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
    ) -> Result<CallParticipant, AddParticipantError> {
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
        .await
        .map_err(classify_add_participant_err)?;

        Ok(CallParticipant {
            call_id: row.call_id,
            user_id: row.user_id,
            joined_at: row.joined_at,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn find_active_call_for_user(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Option<(Uuid, Uuid)>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT c.id, c.channel_id
            FROM call_participants cp
            JOIN calls c ON c.id = cp.call_id
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
            LIMIT 1
            "#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| (r.id, r.channel_id)))
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
        let mut tx = self.pool.begin().await?;

        sqlx::query!(
            r#"
            DELETE FROM calls WHERE id = $1
            "#,
            call_id,
        )
        .execute(tx.as_mut())
        .await?;

        entity_access_db_utils::delete_entity_access_rows(
            &mut tx,
            call_id,
            entity_access_db_utils::EntityType::Call,
        )
        .await?;

        tx.commit().await?;
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
    async fn toggle_share_with_team(&self, call_id: &Uuid) -> Result<(bool, Uuid), Self::Err> {
        let row = sqlx::query!(
            r#"
            UPDATE calls
               SET share_with_team = NOT share_with_team
             WHERE id = $1
            RETURNING share_with_team, channel_id
            "#,
            call_id,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok((row.share_with_team, row.channel_id))
    }

    #[tracing::instrument(err, skip(self))]
    async fn archive_call(&self, call_id: &Uuid) -> Result<Uuid, Self::Err> {
        let mut tx = self.pool.begin().await?;

        // Fetch and lock the active call so concurrent archive_call callers serialize.
        let call = sqlx::query!(
            r#"
            SELECT id, channel_id, room_name, created_by, created_at, egress_id, recording_key, recording_started_at, share_permission_id, share_with_team
            FROM calls
            WHERE id = $1
            FOR UPDATE
            "#,
            call_id,
        )
        .fetch_optional(tx.as_mut())
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

        // If the call opted in to team sharing, grant the creator's team View
        // access on the archived call. Silently skip if the creator has no team.
        if call.share_with_team {
            let team_id: Option<Uuid> = sqlx::query_scalar!(
                r#"
                SELECT team_id
                FROM team_user
                WHERE user_id = $1
                LIMIT 1
                "#,
                &call.created_by,
            )
            .fetch_optional(tx.as_mut())
            .await?;

            if let Some(team_id) = team_id {
                entity_access_db_utils::insert_entity_access_row(
                    &mut tx,
                    call_id,
                    entity_access_db_utils::EntityType::Call,
                    &team_id.to_string(),
                    entity_access_db_utils::EntityAccessSourceType::Team,
                    entity_access_db_utils::AccessLevel::View,
                )
                .await?;
            }
        }

        let now = Utc::now();
        let duration_ms = now
            .signed_duration_since(call.created_at)
            .num_milliseconds()
            .max(0);
        // Insert into call_records (including egress_id and any early recording_key).
        // The record keeps the same id as the original call.
        sqlx::query!(
            r#"
            INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, egress_id, recording_key, recording_started_at, share_permission_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
            call.recording_started_at,
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

    #[tracing::instrument(err, skip(self))]
    async fn set_recording_started_at_by_egress_id(
        &self,
        egress_id: &str,
        started_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<bool, Self::Err> {
        let active = sqlx::query!(
            r#"
            UPDATE calls
               SET recording_started_at = $2
             WHERE egress_id = $1
               AND recording_started_at IS NULL
            "#,
            egress_id,
            started_at,
        )
        .execute(&self.pool)
        .await?;
        if active.rows_affected() > 0 {
            return Ok(true);
        }

        // Fall through: if the call already archived (rare race), persist on
        // the archived row instead.
        let archived = sqlx::query!(
            r#"
            UPDATE call_records
               SET recording_started_at = $2
             WHERE egress_id = $1
               AND recording_started_at IS NULL
            "#,
            egress_id,
            started_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(archived.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self, segment))]
    async fn create_transcript_segment(
        &self,
        call_id: &Uuid,
        segment: &TranscriptSegmentRequest,
        voice_id: Option<Uuid>,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO call_transcripts (call_id, segment_id, speaker_id, diarized_speaker_id, content, started_at, ended_at, voice_id, sequence_num)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (
                SELECT COALESCE(MAX(sequence_num), 0) + 1
                FROM call_transcripts
                WHERE call_id = $1
            ))
            ON CONFLICT (call_id, segment_id) DO NOTHING
            "#,
            call_id,
            segment.segment_id,
            segment.speaker_id,
            segment.diarized_speaker_id,
            segment.content,
            segment.started_at,
            segment.ended_at,
            voice_id,
        )
        .execute(&self.pool)
        .await?;

        // The agent's first-audio-frame wall-clock is a more accurate
        // recording-timeline anchor than the `egress_started` webhook's
        // envelope time (which fires when egress bootstraps, ~seconds
        // before any audio frame is encoded). Overwrite the column when:
        //   - it's still NULL (no webhook yet), OR
        //   - the existing value is at exact second precision (i.e., from
        //     the webhook, which stores `from_timestamp(secs, 0)`), OR
        //   - the new value is earlier than the existing agent value
        //     (across multiple participants, take the earliest first-audio).
        if let Some(stream_started_at) = segment.stream_started_at {
            let active = sqlx::query!(
                r#"
                UPDATE calls
                SET recording_started_at = $1
                WHERE id = $2
                  AND (
                    recording_started_at IS NULL
                    OR recording_started_at = date_trunc('second', recording_started_at)
                    OR $1 < recording_started_at
                  )
                "#,
                stream_started_at,
                call_id,
            )
            .execute(&self.pool)
            .await?;

            // Race fallback: if `archive_call` moved the row to `call_records`
            // between transcript-ingest's lookup and now, the active UPDATE
            // affects 0 rows. Apply the same conditional update to the
            // archived row (same id is reused on archive). Mirrors
            // `set_recording_started_at_by_egress_id`.
            if active.rows_affected() == 0 {
                sqlx::query!(
                    r#"
                    UPDATE call_records
                    SET recording_started_at = $1
                    WHERE id = $2
                      AND (
                        recording_started_at IS NULL
                        OR recording_started_at = date_trunc('second', recording_started_at)
                        OR $1 < recording_started_at
                      )
                    "#,
                    stream_started_at,
                    call_id,
                )
                .execute(&self.pool)
                .await?;
            }
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_transcript_voice_id_for_speaker(
        &self,
        call_id: &Uuid,
        speaker_id: &str,
        diarized_speaker_id: Option<&str>,
    ) -> Result<Option<Uuid>, Self::Err> {
        sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT voice_id
            FROM call_transcripts
            WHERE call_id = $1
              AND voice_id IS NOT NULL
              AND (
                  ($3::text IS NOT NULL AND diarized_speaker_id = $3)
                  OR ($3::text IS NULL AND diarized_speaker_id IS NULL AND speaker_id = $2)
              )
            ORDER BY sequence_num ASC
            LIMIT 1
            "#,
        )
        .bind(call_id)
        .bind(speaker_id)
        .bind(diarized_speaker_id)
        .fetch_optional(&self.pool)
        .await
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
            SELECT id, channel_id, room_name, created_by, created_at, egress_id, recording_key, recording_started_at
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
                SELECT id, segment_id, speaker_id, diarized_speaker_id, content, started_at, ended_at, sequence_num
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
                transcript_id: row.id,
                segment_id: Some(row.segment_id),
                speaker_id: row.speaker_id,
                diarized_speaker_id: row.diarized_speaker_id,
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
                recording_started_at: active.recording_started_at,
                recording_key: active.recording_key,
                recording_url: None,
                channel_name: None,
                custom_name: None,
                summary: None,
                is_active: true,
                participants,
                transcript,
            }));
        }

        // Fall back to archived `call_records`.
        let Some(archived) = sqlx::query!(
            r#"
            SELECT id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, egress_id, recording_key, recording_started_at, custom_name, summary
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
            SELECT id, segment_id, speaker_id, diarized_speaker_id, custom_speaker, content, started_at, ended_at, sequence_num
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
            transcript_id: row.id,
            segment_id: row.segment_id,
            speaker_id: row.custom_speaker.unwrap_or(row.speaker_id),
            diarized_speaker_id: row.diarized_speaker_id,
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
            recording_started_at: archived.recording_started_at,
            recording_key: archived.recording_key,
            recording_url: None,
            channel_name: None,
            custom_name: archived.custom_name,
            summary: archived.summary,
            is_active: false,
            participants,
            transcript,
        }))
    }

    #[tracing::instrument(err, skip(self, call_ids), fields(num_call_ids = call_ids.len()))]
    async fn batch_get_call_record_previews<'a>(
        &self,
        call_ids: &[Uuid],
        user_id: MacroUserIdStr<'a>,
    ) -> Result<Vec<CallRecordPreview>, Self::Err> {
        if call_ids.is_empty() {
            return Ok(Vec::new());
        }

        // Deduplicate ids while preserving first-occurrence order for the response.
        let mut seen = HashSet::new();
        let unique_call_ids: Vec<Uuid> = call_ids
            .iter()
            .copied()
            .filter(|id| seen.insert(*id))
            .collect();

        // Single query across both `calls` (active) and `call_records` (archived).
        // An id in both tables should be impossible; if it somehow happens the
        // active row wins by appearing first.
        let rows = sqlx::query!(
            r#"
            SELECT
                id as "call_id!",
                channel_id as "channel_id!",
                created_at as "started_at!",
                NULL::timestamptz as "ended_at"
            FROM calls
            WHERE id = ANY($1)
            UNION ALL
            SELECT
                id as "call_id!",
                channel_id as "channel_id!",
                started_at as "started_at!",
                ended_at as "ended_at"
            FROM call_records
            WHERE id = ANY($1)
            "#,
            &unique_call_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        struct Found {
            channel_id: Uuid,
            started_at: chrono::DateTime<Utc>,
            ended_at: Option<chrono::DateTime<Utc>>,
        }

        let mut found: HashMap<Uuid, Found> = HashMap::with_capacity(rows.len());
        for row in rows {
            // If the same id ever shows up twice, keep the first (active) hit.
            found.entry(row.call_id).or_insert(Found {
                channel_id: row.channel_id,
                started_at: row.started_at,
                ended_at: row.ended_at,
            });
        }

        let unique_channel_ids: Vec<Uuid> = {
            let mut seen = HashSet::new();
            found
                .values()
                .filter_map(|f| seen.insert(f.channel_id).then_some(f.channel_id))
                .collect()
        };

        let channel_names =
            batch_resolve_channel_names(&self.pool, &unique_channel_ids, user_id).await?;

        let previews = unique_call_ids
            .into_iter()
            .map(|call_id| match found.remove(&call_id) {
                Some(f) => CallRecordPreview::Exists(CallRecordPreviewData {
                    call_id,
                    channel_id: f.channel_id,
                    channel_name: channel_names.get(&f.channel_id).cloned(),
                    started_at: f.started_at,
                    ended_at: f.ended_at,
                }),
                None => CallRecordPreview::DoesNotExist(WithCallId { call_id }),
            })
            .collect();

        Ok(previews)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_records_by_user<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
        limit: u32,
        filter: &LiteralTree<CallLiteral>,
    ) -> Result<Vec<CallRecord>, Self::Err> {
        // Fetch call headers from both active and archived tables, ordered by
        // start time descending. We intentionally exclude transcripts (too
        // large for the soup feed).
        //
        // Visibility is derived from the `entity_access` table: a call is
        // visible to the user if there's an entity_access row whose
        // `source_id` matches one of the user's source ids (their
        // channel memberships, team memberships, or their own user id).
        // This mirrors `entity_access::pg_access_repo::queries::call_access`.
        let channel_ids = extract_channel_ids(filter);
        let has_channel_filter = !channel_ids.is_empty();
        let call_ids = extract_call_ids(filter);
        let has_call_id_filter = !call_ids.is_empty();
        let attended = extract_attended(filter);

        let rows = sqlx::query!(
            r#"
            WITH user_source_ids AS (
                SELECT cp.channel_id::text AS source_id
                FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
                UNION ALL
                SELECT t.team_id::text AS source_id
                FROM team_user t
                WHERE t.user_id = $1
                UNION ALL
                SELECT $1 AS source_id
            )
            SELECT
                id as "call_id!",
                channel_id as "channel_id!",
                room_name as "room_name!",
                created_by as "created_by!",
                created_at as "started_at!",
                NULL::timestamptz as "ended_at",
                NULL::bigint as "duration_ms",
                egress_id,
                recording_key,
                recording_started_at,
                NULL::text as "custom_name",
                NULL::text as "summary",
                true as "is_active!"
            FROM calls c
            WHERE EXISTS (
                SELECT 1 FROM entity_access ea
                JOIN user_source_ids u ON u.source_id = ea.source_id
                WHERE ea.entity_id = c.id
                  AND ea.entity_type = 'call'
            )
            AND ($3::bool IS FALSE OR c.channel_id = ANY($4))
            AND ($5::bool IS NULL OR EXISTS (
                SELECT 1 FROM call_participants cp
                WHERE cp.call_id = c.id AND cp.user_id = $1
            ) = $5)
            AND ($6::bool IS FALSE OR c.id = ANY($7))
            UNION ALL
            SELECT
                id as "call_id!",
                channel_id as "channel_id!",
                room_name as "room_name!",
                created_by as "created_by!",
                started_at as "started_at!",
                ended_at as "ended_at",
                duration_ms as "duration_ms",
                egress_id,
                recording_key,
                recording_started_at,
                custom_name,
                summary,
                false as "is_active!"
            FROM call_records cr
            WHERE EXISTS (
                SELECT 1 FROM entity_access ea
                JOIN user_source_ids u ON u.source_id = ea.source_id
                WHERE ea.entity_id = cr.id
                  AND ea.entity_type = 'call'
            )
            AND ($3::bool IS FALSE OR cr.channel_id = ANY($4))
            AND ($5::bool IS NULL OR EXISTS (
                SELECT 1 FROM call_record_participants crp
                WHERE crp.call_record_id = cr.id AND crp.user_id = $1
            ) = $5)
            AND ($6::bool IS FALSE OR cr.id = ANY($7))
            ORDER BY "started_at!" DESC
            LIMIT $2
            "#,
            user_id.as_ref(),
            limit as i64,
            has_channel_filter,
            &channel_ids,
            attended,
            has_call_id_filter,
            &call_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut records = Vec::with_capacity(rows.len());
        for row in rows {
            // Fetch participants from the appropriate table.
            let participants = if row.is_active {
                sqlx::query!(
                    r#"
                    SELECT user_id, joined_at, left_at
                    FROM call_participants
                    WHERE call_id = $1
                    ORDER BY joined_at ASC
                    "#,
                    row.call_id,
                )
                .fetch_all(&self.pool)
                .await?
                .into_iter()
                .map(|p| CallRecordParticipant {
                    user_id: p.user_id,
                    joined_at: p.joined_at,
                    left_at: p.left_at,
                })
                .collect()
            } else {
                sqlx::query!(
                    r#"
                    SELECT user_id, joined_at, left_at
                    FROM call_record_participants
                    WHERE call_record_id = $1
                    ORDER BY joined_at ASC
                    "#,
                    row.call_id,
                )
                .fetch_all(&self.pool)
                .await?
                .into_iter()
                .map(|p| CallRecordParticipant {
                    user_id: p.user_id,
                    joined_at: p.joined_at,
                    left_at: p.left_at,
                })
                .collect()
            };

            records.push(CallRecord {
                call_id: row.call_id,
                channel_id: row.channel_id,
                room_name: row.room_name,
                created_by: row.created_by,
                started_at: row.started_at,
                ended_at: row.ended_at,
                duration_ms: row.duration_ms,
                egress_id: row.egress_id,
                recording_started_at: row.recording_started_at,
                recording_key: row.recording_key,
                recording_url: None,
                channel_name: None,
                custom_name: row.custom_name,
                summary: row.summary,
                is_active: row.is_active,
                participants,
                transcript: Vec::new(),
            });
        }

        // --- Resolve channel names ---
        let unique_channel_ids: Vec<Uuid> = {
            let mut seen = HashSet::new();
            records
                .iter()
                .filter_map(|r| seen.insert(r.channel_id).then_some(r.channel_id))
                .collect()
        };

        let channel_names =
            batch_resolve_channel_names(&self.pool, &unique_channel_ids, user_id.copied()).await?;

        for record in &mut records {
            record.channel_name = channel_names.get(&record.channel_id).cloned();
        }

        Ok(records)
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

    #[tracing::instrument(err, skip(self))]
    async fn get_user_display_name<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> Result<Option<String>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT
                NULLIF(mui.first_name,  'N/A') AS first_name,
                NULLIF(mui.last_name,   'N/A') AS last_name
            FROM macro_user_info mui
            JOIN "User" u ON mui.macro_user_id = u.macro_user_id
            WHERE u.id = $1
            LIMIT 1
            "#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.and_then(|r| match (r.first_name, r.last_name) {
            (None, None) => None,
            (None, Some(last)) => Some(last),
            (Some(first), None) => Some(first),
            (Some(first), Some(last)) => Some(format!("{first} {last}")),
        }))
    }

    #[tracing::instrument(err, skip(self))]
    async fn resolve_channel_name<'a>(
        &self,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'a>,
    ) -> Result<Option<String>, Self::Err> {
        let mut map = batch_resolve_channel_names(&self.pool, &[*channel_id], user_id).await?;
        Ok(map.remove(channel_id))
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_call_record(&self, call_record_id: &Uuid) -> Result<Option<String>, Self::Err> {
        let mut tx = self.pool.begin().await?;

        let row = sqlx::query!(
            r#"
            DELETE FROM call_records WHERE id = $1 RETURNING recording_key
            "#,
            call_record_id,
        )
        .fetch_optional(tx.as_mut())
        .await?;

        entity_access_db_utils::delete_entity_access_rows(
            &mut tx,
            call_record_id,
            entity_access_db_utils::EntityType::Call,
        )
        .await?;

        tx.commit().await?;
        Ok(row.and_then(|r| r.recording_key))
    }

    #[tracing::instrument(skip(self), err)]
    async fn patch_call_record(
        &self,
        call_record_id: &Uuid,
        request: &EditCallRecordRequest,
    ) -> Result<(), Self::Err> {
        let mut tx = self.pool.begin().await?;

        if let Some(share_permission) = request.share_permission.as_ref() {
            edit::update_share_permission(&mut tx, call_record_id, share_permission).await?;
        }

        if let Some(share_with_team) = request.share_with_team {
            edit::set_share_with_team(&mut tx, call_record_id, share_with_team).await?;
        }

        if let Some(custom_name) = request.custom_name.as_deref() {
            let custom_name = if custom_name.is_empty() {
                None
            } else {
                Some(custom_name)
            };
            edit::set_custom_name(&mut tx, call_record_id, custom_name).await?;
        }

        tx.commit().await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, assignments), fields(num_assignments = assignments.len()), err)]
    async fn patch_call_transcript_custom_speakers(
        &self,
        call_record_id: &Uuid,
        assignments: &[CustomSpeakerAssignment],
    ) -> Result<(), Self::Err> {
        if assignments.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await?;
        edit::set_custom_speakers(&mut tx, call_record_id, assignments).await?;
        tx.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_distinct_voice_speakers_for_call_record(
        &self,
        call_record_id: &Uuid,
    ) -> Result<Vec<(String, Uuid)>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT DISTINCT diarized_speaker_id AS "diarized_speaker_id!", voice_id AS "voice_id!"
            FROM call_record_transcripts
            WHERE call_record_id = $1
              AND diarized_speaker_id IS NOT NULL
              AND voice_id IS NOT NULL
            "#,
            call_record_id,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| (r.diarized_speaker_id, r.voice_id))
            .collect())
    }

    #[tracing::instrument(skip(self, assignments), fields(num_assignments = assignments.len()), err)]
    async fn patch_call_transcript_speakers_from_voice_match(
        &self,
        call_record_id: &Uuid,
        assignments: &[(String, Uuid)],
    ) -> Result<(), Self::Err> {
        if assignments.is_empty() {
            return Ok(());
        }
        let diarized_ids: Vec<&str> = assignments.iter().map(|(d, _)| d.as_str()).collect();
        let user_ids: Vec<Uuid> = assignments.iter().map(|(_, u)| *u).collect();
        sqlx::query!(
            r#"
            UPDATE call_record_transcripts AS t
            SET custom_speaker = u.id
            FROM UNNEST($2::text[], $3::uuid[]) AS a(diarized_speaker_id, macro_user_id)
            JOIN "User" u ON u.macro_user_id = a.macro_user_id
            WHERE t.call_record_id = $1
              AND t.diarized_speaker_id = a.diarized_speaker_id
              AND t.custom_speaker IS NULL
            "#,
            call_record_id,
            &diarized_ids as &[&str],
            &user_ids,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, summary), err)]
    async fn insert_call_summary(&self, call_id: &Uuid, summary: &str) -> Result<(), Self::Err> {
        // Tolerate missing rows: summarization can race with record deletion.
        sqlx::query!(
            r#"
            UPDATE call_records SET summary = $2 WHERE id = $1
            "#,
            call_id,
            summary,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, name), err)]
    async fn set_custom_name_if_null(&self, call_id: &Uuid, name: &str) -> Result<(), Self::Err> {
        let mut tx = self.pool.begin().await?;
        edit::set_custom_name_if_null(&mut tx, call_id, name).await?;
        tx.commit().await?;
        Ok(())
    }
}
