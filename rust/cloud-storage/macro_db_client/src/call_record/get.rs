use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct CallRecordSearchBackfill {
    pub call_id: Uuid,
}

#[derive(Debug, Clone)]
pub struct CallRecordMetadataRow {
    pub call_id: Uuid,
    pub channel_id: Uuid,
    pub created_by: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_ms: i64,
    pub custom_name: Option<String>,
    /// Whether the requesting user was a participant on the call.
    pub attended: bool,
}

#[derive(Debug, Clone)]
pub struct CallRecordTranscriptSegment {
    pub transcript_id: Uuid,
    pub speaker_id: String,
    pub sequence_num: i32,
    pub content: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct CallRecordSearchPayload {
    pub call_id: Uuid,
    pub channel_id: Uuid,
    pub created_by: String,
    pub channel_name: Option<String>,
    pub participant_ids: Vec<String>,
    pub segments: Vec<CallRecordTranscriptSegment>,
}

/// `attended` optionally narrows by participation.
#[tracing::instrument(skip(db))]
pub async fn get_accessible_call_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    attended: Option<bool>,
) -> anyhow::Result<Vec<Uuid>> {
    sqlx::query_scalar!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text AS source_id
            FROM comms_channel_participants cp
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text
            FROM team_user t
            WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        )
        SELECT DISTINCT cr.id AS "id!"
        FROM call_records cr
        WHERE (
            EXISTS (
                SELECT 1 FROM entity_access ea
                WHERE ea.entity_id = cr.id
                  AND ea.entity_type = 'call'
                  AND ea.source_id IN (SELECT source_id FROM user_source_ids)
            ) OR EXISTS (
                SELECT 1 FROM "SharePermission" sp
                WHERE sp.id = cr.share_permission_id
                  AND sp."isPublic" = true
                  AND sp."publicAccessLevel" IS NOT NULL
            )
        )
        AND ($2::bool IS NULL OR EXISTS (
            SELECT 1 FROM call_record_participants crp
            WHERE crp.call_record_id = cr.id AND crp.user_id = $1
        ) = $2)
        "#,
        user_id,
        attended,
    )
    .fetch_all(db)
    .await
    .map_err(Into::into)
}

#[tracing::instrument(skip(db))]
pub async fn get_call_records_for_search_backfill(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<CallRecordSearchBackfill>> {
    sqlx::query_as!(
        CallRecordSearchBackfill,
        r#"SELECT id AS "call_id!" FROM call_records ORDER BY started_at DESC LIMIT $1 OFFSET $2"#,
        limit,
        offset,
    )
    .fetch_all(db)
    .await
    .map_err(Into::into)
}

/// Returns `None` if the call has been deleted.
#[tracing::instrument(skip(db))]
pub async fn get_call_record_search_payload(
    db: &sqlx::Pool<sqlx::Postgres>,
    call_id: &Uuid,
) -> anyhow::Result<Option<CallRecordSearchPayload>> {
    let Some(header) = sqlx::query!(
        r#"
        SELECT
            cr.id AS "call_id!",
            cr.channel_id AS "channel_id!",
            cr.created_by AS "created_by!",
            cc.name AS "channel_name?"
        FROM call_records cr
        LEFT JOIN comms_channels cc ON cc.id = cr.channel_id
        WHERE cr.id = $1
        "#,
        call_id,
    )
    .fetch_optional(db)
    .await?
    else {
        return Ok(None);
    };

    let participant_ids = sqlx::query_scalar!(
        r#"
        SELECT user_id AS "user_id!"
        FROM call_record_participants
        WHERE call_record_id = $1
        ORDER BY joined_at ASC
        "#,
        call_id,
    )
    .fetch_all(db)
    .await?;

    let segments = sqlx::query_as!(
        CallRecordTranscriptSegment,
        r#"
        SELECT
            id AS "transcript_id!",
            speaker_id AS "speaker_id!",
            sequence_num AS "sequence_num!",
            content AS "content!",
            started_at AS "started_at!",
            ended_at
        FROM call_record_transcripts
        WHERE call_record_id = $1
        ORDER BY sequence_num ASC
        "#,
        call_id,
    )
    .fetch_all(db)
    .await?;

    Ok(Some(CallRecordSearchPayload {
        call_id: header.call_id,
        channel_id: header.channel_id,
        created_by: header.created_by,
        channel_name: header.channel_name,
        participant_ids,
        segments,
    }))
}

/// `user_id` drives the per-row `attended` flag.
#[tracing::instrument(skip(db))]
pub async fn get_call_records_metadata(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    call_ids: &[Uuid],
) -> anyhow::Result<Vec<CallRecordMetadataRow>> {
    if call_ids.is_empty() {
        return Ok(Vec::new());
    }

    sqlx::query_as!(
        CallRecordMetadataRow,
        r#"
        SELECT
            cr.id AS "call_id!",
            cr.channel_id AS "channel_id!",
            cr.created_by AS "created_by!",
            cr.started_at AS "started_at!",
            cr.ended_at AS "ended_at!",
            cr.duration_ms AS "duration_ms!",
            cr.custom_name AS "custom_name?",
            EXISTS (
                SELECT 1 FROM call_record_participants crp
                WHERE crp.call_record_id = cr.id AND crp.user_id = $2
            ) AS "attended!"
        FROM call_records cr
        WHERE cr.id = ANY($1)
        "#,
        call_ids,
        user_id,
    )
    .fetch_all(db)
    .await
    .map_err(Into::into)
}
