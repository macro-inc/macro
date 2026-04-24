use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

/// Row used to enqueue a call record for search indexing.
#[derive(Debug, Clone)]
pub struct CallRecordSearchBackfill {
    pub call_id: Uuid,
}

/// Metadata used to enrich call record search hits.
#[derive(Debug, Clone)]
pub struct CallRecordMetadataRow {
    pub call_id: Uuid,
    pub created_by: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_ms: i64,
    pub channel_name: Option<String>,
    /// Whether the requesting user was a participant on the call.
    pub attended: bool,
}

/// One transcript segment for indexing.
#[derive(Debug, Clone)]
pub struct CallRecordTranscriptSegment {
    /// `call_record_transcripts.id` — segment suffix of the OpenSearch `_id`.
    pub transcript_id: Uuid,
    pub speaker_id: String,
    pub sequence_num: i32,
    pub content: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

/// Everything needed to upsert a call into search (one doc per segment).
#[derive(Debug, Clone)]
pub struct CallRecordSearchPayload {
    pub call_id: Uuid,
    pub channel_id: Uuid,
    pub created_by: String,
    pub channel_name: Option<String>,
    pub participant_ids: Vec<String>,
    pub segments: Vec<CallRecordTranscriptSegment>,
}

/// Call ids the user can access, optionally narrowed by attended.
#[tracing::instrument(skip(db))]
pub async fn get_accessible_call_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    attended: Option<bool>,
) -> anyhow::Result<Vec<Uuid>> {
    let rows = sqlx::query(
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
        SELECT DISTINCT cr.id
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
    )
    .bind(user_id)
    .bind(attended)
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|r| r.get::<Uuid, _>("id")).collect())
}

/// Page through every archived call record (backfill).
#[tracing::instrument(skip(db))]
pub async fn get_call_records_for_search_backfill(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<CallRecordSearchBackfill>> {
    let rows =
        sqlx::query("SELECT id FROM call_records ORDER BY started_at DESC LIMIT $1 OFFSET $2")
            .bind(limit)
            .bind(offset)
            .fetch_all(db)
            .await?;

    Ok(rows
        .into_iter()
        .map(|r| CallRecordSearchBackfill {
            call_id: r.get::<Uuid, _>("id"),
        })
        .collect())
}

/// Load the indexing payload for a call, or `None` if missing.
#[tracing::instrument(skip(db))]
pub async fn get_call_record_search_payload(
    db: &sqlx::Pool<sqlx::Postgres>,
    call_id: &Uuid,
) -> anyhow::Result<Option<CallRecordSearchPayload>> {
    let Some(header) = sqlx::query(
        r#"
        SELECT
            cr.id,
            cr.channel_id,
            cr.created_by,
            cc.name AS channel_name
        FROM call_records cr
        LEFT JOIN comms_channels cc ON cc.id = cr.channel_id
        WHERE cr.id = $1
        "#,
    )
    .bind(call_id)
    .fetch_optional(db)
    .await?
    else {
        return Ok(None);
    };

    let participant_ids: Vec<String> = sqlx::query(
        r#"
        SELECT user_id
        FROM call_record_participants
        WHERE call_record_id = $1
        ORDER BY joined_at ASC
        "#,
    )
    .bind(call_id)
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|row| row.get::<String, _>("user_id"))
    .collect();

    let segments: Vec<CallRecordTranscriptSegment> = sqlx::query(
        r#"
        SELECT id, speaker_id, sequence_num, content, started_at, ended_at
        FROM call_record_transcripts
        WHERE call_record_id = $1
        ORDER BY sequence_num ASC
        "#,
    )
    .bind(call_id)
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|row| CallRecordTranscriptSegment {
        transcript_id: row.get("id"),
        speaker_id: row.get("speaker_id"),
        sequence_num: row.get("sequence_num"),
        content: row.get("content"),
        started_at: row.get("started_at"),
        ended_at: row.try_get("ended_at").ok(),
    })
    .collect();

    Ok(Some(CallRecordSearchPayload {
        call_id: header.get("id"),
        channel_id: header.get("channel_id"),
        created_by: header.get("created_by"),
        channel_name: header.try_get("channel_name").ok(),
        participant_ids,
        segments,
    }))
}

/// Enrichment metadata for a batch of call ids; `user_id` drives `attended`.
#[tracing::instrument(skip(db))]
pub async fn get_call_records_metadata(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    call_ids: &[Uuid],
) -> anyhow::Result<Vec<CallRecordMetadataRow>> {
    if call_ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query(
        r#"
        SELECT
            cr.id,
            cr.created_by,
            cr.started_at,
            cr.ended_at,
            cr.duration_ms,
            cc.name AS channel_name,
            EXISTS (
                SELECT 1 FROM call_record_participants crp
                WHERE crp.call_record_id = cr.id AND crp.user_id = $2
            ) AS attended
        FROM call_records cr
        LEFT JOIN comms_channels cc ON cc.id = cr.channel_id
        WHERE cr.id = ANY($1)
        "#,
    )
    .bind(call_ids)
    .bind(user_id)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| CallRecordMetadataRow {
            call_id: row.get("id"),
            created_by: row.get("created_by"),
            started_at: row.get("started_at"),
            ended_at: row.get("ended_at"),
            duration_ms: row.get("duration_ms"),
            channel_name: row.try_get("channel_name").ok(),
            attended: row.try_get("attended").unwrap_or(false),
        })
        .collect())
}
