#[cfg(test)]
mod test;

use std::sync::{Arc, LazyLock};

use chrono::{DateTime, Utc};
use single_flight::{DatabaseKey, SingleFlight};
use uuid::Uuid;

type AccessibleCallsKey = (DatabaseKey, String, Vec<String>);
type AccessibleCalls = Result<Vec<Uuid>, Arc<sqlx::Error>>;

static RUNNING_CALL_LOOKUPS: LazyLock<SingleFlight<AccessibleCallsKey, AccessibleCalls>> =
    LazyLock::new(SingleFlight::new);

#[derive(Debug, Clone)]
pub struct CallRecordSearchBackfill {
    pub call_id: Uuid,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct CallRecordMetadataRow {
    pub call_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub created_by: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_ms: i64,
    pub custom_name: Option<String>,
    /// Whether the requesting user was a participant on the call.
    pub attended: bool,
    /// Viewer-relative call status for the requesting user.
    pub status: String,
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
    pub channel_id: Option<Uuid>,
    pub created_by: String,
    pub channel_name: Option<String>,
    /// Caller-assigned name for the call, if renamed. Indexed as the call's
    /// searchable name, falling back to `channel_name`.
    pub custom_name: Option<String>,
    pub participant_ids: Vec<String>,
    pub segments: Vec<CallRecordTranscriptSegment>,
}

/// `status_filter` optionally narrows visible calls by viewer-relative status.
/// Standalone and imported calls are discoverable only through the caller's
/// individual grant; team/channel grants and shared links do not add them to
/// team memory.
///
/// Nothing is cached, but callers asking at the same time for the same
/// database, user and status filter share one run of the query. A failure
/// reaches all of them as an `Arc<sqlx::Error>`.
#[tracing::instrument(skip(db, status_filter), err, fields(coalesced = tracing::field::Empty))]
pub async fn get_accessible_call_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    status_filter: &[String],
) -> anyhow::Result<Vec<Uuid>> {
    let key = (
        DatabaseKey::of(db),
        user_id.to_string(),
        status_filter.to_vec(),
    );
    let lookup = || {
        let db = db.clone();
        let user_id = user_id.to_string();
        let status_filter = status_filter.to_vec();

        async move {
            query_accessible_call_ids(&db, &user_id, &status_filter)
                .await
                .map_err(Arc::new)
        }
    };

    // Boxed so the lookup adds one pointer, not its whole state machine, to
    // the future of every caller up the stack: services near rustc's layout
    // depth limit stop compiling otherwise.
    Ok(Box::pin(RUNNING_CALL_LOOKUPS.run(key, lookup)).await?)
}

async fn query_accessible_call_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    status_filter: &[String],
) -> sqlx::Result<Vec<Uuid>> {
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
        ),
        visible_calls AS (
            SELECT
                cr.id,
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM call_record_participants crp
                        WHERE crp.call_record_id = cr.id AND crp.user_id = $1
                    ) THEN 'ATTENDED'
                    WHEN EXISTS (
                        SELECT 1 FROM comms_channel_participants ccp
                        WHERE ccp.channel_id = cr.channel_id
                          AND ccp.user_id = $1
                          AND ccp.left_at IS NULL
                    ) THEN 'MISSED'
                    ELSE 'UNATTENDED'
                END AS status
            FROM call_records cr
            WHERE (
                EXISTS (
                    SELECT 1 FROM entity_access ea
                    WHERE ea.entity_id = cr.id
                      AND ea.entity_type = 'call'
                      AND ea.source_id IN (SELECT source_id FROM user_source_ids)
                      AND (cr.channel_id IS NOT NULL OR (ea.source_type = 'user' AND ea.source_id = $1))
                ) OR EXISTS (
                    SELECT 1 FROM "SharePermission" sp
                    WHERE sp.id = cr.share_permission_id
                      AND cr.channel_id IS NOT NULL
                      AND sp."linkShareAccessLevel" IS NOT NULL
                      AND (
                          sp."linkShare" = 'PUBLIC'
                          OR (
                              sp."linkShare" = 'TEAM'
                              AND EXISTS (
                                  SELECT 1
                                  FROM team_user owner_team
                                  WHERE owner_team.user_id = cr.created_by
                                    AND owner_team.team_id::text IN (
                                        SELECT source_id FROM user_source_ids
                                    )
                              )
                          )
                      )
                )
            )
            UNION ALL
            -- Imported calls exist only as call entities (native calls are
            -- mirrored there too, so exclude them). They have no channel, so
            -- like standalone calls they are found only through the caller's
            -- own user grant. Start from those grants and look each call up
            -- by id, so the cost follows the caller's grants, not the table.
            -- The importer attended the meeting.
            SELECT
                ce.id,
                CASE WHEN ce.user_id = $1 THEN 'ATTENDED' ELSE 'UNATTENDED' END
            FROM (
                SELECT DISTINCT ea.entity_id
                FROM entity_access ea
                WHERE ea.source_id = $1
                  AND ea.source_type = 'user'
                  AND ea.entity_type = 'call'
                OFFSET 0
            ) own_grants
            CROSS JOIN LATERAL (
                SELECT ce.id, ce.user_id
                FROM call_entities ce
                WHERE ce.id = own_grants.entity_id AND ce.created_via <> 'native'
                -- One row by id; the limit keeps the planner from flattening
                -- this into a join over every imported call.
                LIMIT 1
            ) ce
        )
        SELECT id AS "id!"
        FROM visible_calls
        WHERE cardinality($2::text[]) = 0 OR status = ANY($2)
        "#,
        user_id,
        status_filter,
    )
    .fetch_all(db)
    .await
}

/// Gets call records for search backfill.
///
/// Pagination is **keyset (seek-method)**: pass `cursor` as the last
/// row's `(started_at, id)` pair from the previous page (or `None` for
/// the first page). call_records doesn't have an updated_at column so
/// the cursor and `started_after` / `started_before` filters use
/// started_at — functionally equivalent because calls are immutable
/// after creation.
#[tracing::instrument(skip(db))]
pub async fn get_call_records_for_search_backfill(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    started_after: Option<DateTime<Utc>>,
    started_before: Option<DateTime<Utc>>,
) -> anyhow::Result<Vec<CallRecordSearchBackfill>> {
    let (cursor_started_at, cursor_id) = match cursor {
        Some((t, id)) => (Some(t), Some(id)),
        None => (None, None),
    };

    sqlx::query_as!(
        CallRecordSearchBackfill,
        r#"
        SELECT
            id AS "call_id!",
            started_at AS "started_at!"
        FROM call_records
        WHERE
            ($2::timestamptz IS NULL OR started_at >= $2)
            AND ($3::timestamptz IS NULL OR started_at < $3)
            AND (
                $4::timestamptz IS NULL
                OR (started_at, id) > ($4, $5::uuid)
            )
        ORDER BY started_at ASC, id ASC
        LIMIT $1
        "#,
        limit,
        started_after as Option<DateTime<Utc>>,
        started_before as Option<DateTime<Utc>>,
        cursor_started_at as Option<DateTime<Utc>>,
        cursor_id as Option<Uuid>,
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
            cr.channel_id AS "channel_id?",
            cr.created_by AS "created_by!",
            cr.custom_name AS "custom_name?",
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
        return get_imported_call_search_payload(db, call_id).await;
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
        custom_name: header.custom_name,
        participant_ids,
        segments,
    }))
}

/// Index payload for an imported call, or `None` when `call_id` is not one.
///
/// Mirrors the detail view's read in
/// `crates/call/src/outbound/pg_call_repo/imported.rs`, so a search hit and
/// the opened call agree on segment ids, times and speakers.
async fn get_imported_call_search_payload(
    db: &sqlx::Pool<sqlx::Postgres>,
    call_id: &Uuid,
) -> anyhow::Result<Option<CallRecordSearchPayload>> {
    let Some(call) = sqlx::query!(
        r#"
        SELECT ce.id, ce.user_id, ce.title, COALESCE(ce.started_at, ce.created_at) AS "started_at!"
        FROM call_entities ce
        WHERE ce.id = $1 AND ce.created_via <> 'native'
        "#,
        call_id,
    )
    .fetch_optional(db)
    .await?
    else {
        return Ok(None);
    };

    let participants = sqlx::query!(
        r#"
        SELECT id, user_id, display_name, email
        FROM call_entity_participants
        WHERE call_id = $1
        ORDER BY id
        "#,
        call_id,
    )
    .fetch_all(db)
    .await?;

    let segments = sqlx::query!(
        r#"
        SELECT s.transcript_id, s.sequence_num, s.participant_id, s.speaker_label, s.content,
               s.start_ms, s.end_ms, t.started_at AS transcript_started_at
        FROM call_entity_transcript_segments s
        JOIN call_entity_transcripts t ON t.call_id = s.call_id AND t.id = s.transcript_id
        WHERE s.call_id = $1
        ORDER BY t.started_at NULLS LAST, t.id, s.sequence_num
        "#,
        call_id,
    )
    .fetch_all(db)
    .await?;

    // Attendees show under their name, else their email.
    let attendee_names: Vec<(Uuid, String)> = participants
        .iter()
        .map(|p| {
            let name = p
                .display_name
                .clone()
                .or_else(|| p.email.clone())
                .unwrap_or_else(|| "Participant".into());
            (p.id, name)
        })
        .collect();

    let segments = segments
        .into_iter()
        .enumerate()
        .map(|(index, s)| {
            let origin = s.transcript_started_at.unwrap_or(call.started_at);
            let at = |ms: i64| origin + chrono::Duration::milliseconds(ms);

            // A segment belongs to the attendee the provider linked, else to
            // the attendee its label names, else to the label itself.
            let speaker_id = match s.participant_id {
                Some(id) => id.to_string(),
                None => {
                    let label = s.speaker_label.unwrap_or_else(|| "Unknown speaker".into());
                    attendee_names
                        .iter()
                        .find(|(_, name)| name.eq_ignore_ascii_case(&label))
                        .map(|(id, _)| id.to_string())
                        .unwrap_or(label)
                }
            };

            CallRecordTranscriptSegment {
                // Segments have a composite key; the detail view derives the
                // same per-segment id for its deep links.
                transcript_id: Uuid::new_v5(&s.transcript_id, &s.sequence_num.to_be_bytes()),
                speaker_id,
                // Renumbered across transcripts, as the detail view does.
                sequence_num: index as i32,
                content: s.content,
                started_at: s.start_ms.map(at).unwrap_or(origin),
                ended_at: s.end_ms.map(at),
            }
        })
        .collect();

    Ok(Some(CallRecordSearchPayload {
        call_id: call.id,
        channel_id: None,
        created_by: call.user_id,
        channel_name: None,
        custom_name: call.title,
        participant_ids: participants.into_iter().filter_map(|p| p.user_id).collect(),
        segments,
    }))
}

/// `user_id` drives the per-row viewer-specific status and legacy `attended` flag.
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
            cr.channel_id AS "channel_id?",
            cr.created_by AS "created_by!",
            cr.started_at AS "started_at!",
            cr.ended_at AS "ended_at!",
            cr.duration_ms AS "duration_ms!",
            cr.custom_name AS "custom_name?",
            EXISTS (
                SELECT 1 FROM call_record_participants crp
                WHERE crp.call_record_id = cr.id AND crp.user_id = $2
            ) AS "attended!",
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM call_record_participants crp
                    WHERE crp.call_record_id = cr.id AND crp.user_id = $2
                ) THEN 'ATTENDED'
                WHEN EXISTS (
                    SELECT 1 FROM comms_channel_participants ccp
                    WHERE ccp.channel_id = cr.channel_id
                      AND ccp.user_id = $2
                      AND ccp.left_at IS NULL
                ) THEN 'MISSED'
                ELSE 'UNATTENDED'
            END AS "status!"
        FROM call_records cr
        WHERE cr.id = ANY($1)
        UNION ALL
        -- Imported calls, timed as the call list times them; the importer
        -- attended the meeting.
        SELECT
            ce.id,
            NULL::uuid,
            ce.user_id,
            COALESCE(ce.started_at, ce.created_at),
            COALESCE(ce.ended_at, ce.started_at, ce.created_at),
            COALESCE(ce.duration_ms, 0),
            ce.title,
            ce.user_id = $2,
            CASE WHEN ce.user_id = $2 THEN 'ATTENDED' ELSE 'UNATTENDED' END
        FROM call_entities ce
        WHERE ce.id = ANY($1) AND ce.created_via <> 'native'
        "#,
        call_ids,
        user_id,
    )
    .fetch_all(db)
    .await
    .map_err(Into::into)
}
