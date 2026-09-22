//! Email-owned display snapshots and leased attachment extraction work.
use crate::domain::models::calendar_invitation::{
    CalendarInvitation, InvitationExtractionStatus, MessageCalendarInvitations,
};
use rootcause::Report;
use sqlx::{PgPool, types::Json};
use std::collections::HashMap;
use uuid::Uuid;

/// Snapshot persistence adapter shared by ingestion and thread reads.
#[derive(Clone)]
pub struct InvitationPgRepository(pub PgPool);

/// Load an entire thread page in one query; absence means unprocessed.
pub async fn load(
    pool: &PgPool,
    ids: &[Uuid],
) -> Result<HashMap<Uuid, MessageCalendarInvitations>, sqlx::Error> {
    let rows = sqlx::query!(r#"
        SELECT e.message_id, e.status,
            COALESCE(jsonb_agg(i.snapshot ORDER BY i.component_id) FILTER (WHERE i.component_id IS NOT NULL), '[]'::jsonb)
                AS "snapshots!: Json<Vec<CalendarInvitation>>"
        FROM email_message_calendar_extraction e
        LEFT JOIN email_message_calendar_invites i ON i.message_id = e.message_id
        WHERE e.message_id = ANY($1)
        GROUP BY e.message_id
    "#, ids).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.message_id,
                MessageCalendarInvitations {
                    status: match r.status.as_str() {
                        "unprocessed" => InvitationExtractionStatus::Unprocessed,
                        "ready" => InvitationExtractionStatus::Ready,
                        "pending" => InvitationExtractionStatus::Pending,
                        "absent" => InvitationExtractionStatus::Absent,
                        _ => InvitationExtractionStatus::Unsupported,
                    },
                    invitations: r.snapshots.0,
                },
            )
        })
        .collect())
}

#[cfg(feature = "calendar_parser")]
impl crate::domain::invitation_extraction::InvitationExtractionRepository
    for InvitationPgRepository
{
    async fn is_processed(&self, message_id: Uuid) -> Result<bool, Report> {
        Ok(sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM email_message_calendar_extraction WHERE message_id = $1 AND parser_version >= $2) AS \"exists!\"", message_id, crate::domain::models::calendar_invitation::INVITATION_PARSER_VERSION as i16).fetch_one(&self.0).await?)
    }
    async fn save(
        &self,
        message_id: Uuid,
        parsed: &MessageCalendarInvitations,
        pending: &[crate::domain::invitation_extraction::PendingInvitationPart],
        generation: Option<i64>,
    ) -> Result<bool, Report> {
        let mut tx = self.0.begin().await?;
        // Serialize competing ingestion/retry writes for one message.
        sqlx::query!(
            "SELECT id FROM email_messages WHERE id = $1 FOR UPDATE",
            message_id
        )
        .fetch_optional(&mut *tx)
        .await?;
        let current = sqlx::query!("SELECT generation, parser_version FROM email_message_calendar_extraction WHERE message_id = $1 FOR UPDATE", message_id).fetch_optional(&mut *tx).await?;
        let parser_version =
            crate::domain::models::calendar_invitation::INVITATION_PARSER_VERSION as i16;
        if current.as_ref().is_some_and(|row| {
            row.parser_version > parser_version
                || match generation {
                    Some(expected) => row.generation != expected,
                    None => row.parser_version >= parser_version,
                }
        }) {
            return Ok(false);
        }
        if current
            .as_ref()
            .is_some_and(|row| row.parser_version < parser_version)
        {
            // Reinspection starts a new component set; retries within it still append.
            sqlx::query!(
                "DELETE FROM email_message_calendar_invites WHERE message_id = $1",
                message_id
            )
            .execute(&mut *tx)
            .await?;
        }
        for snapshot in &parsed.invitations {
            let json = serde_json::to_value(snapshot)?;
            sqlx::query!(
                r#"INSERT INTO email_message_calendar_invites(message_id, component_id, snapshot)
                VALUES ($1, $2, $3) ON CONFLICT (message_id, component_id) DO NOTHING"#,
                message_id,
                snapshot.id,
                json
            )
            .execute(&mut *tx)
            .await?;
        }
        let has_pending = !pending.is_empty();
        let unsupported = parsed.status == InvitationExtractionStatus::Unsupported;
        let pending_json = serde_json::to_value(pending)?;
        sqlx::query!(r#"
            INSERT INTO email_message_calendar_extraction(message_id, status, parser_version, pending_parts, retry_after, notification_pending)
            VALUES ($1, CASE WHEN $2 THEN 'pending' WHEN EXISTS (SELECT 1 FROM email_message_calendar_invites WHERE message_id = $1) THEN 'ready' WHEN $3 THEN 'unsupported' ELSE 'absent' END, $4, $5, now() + interval '1 minute', true)
            ON CONFLICT (message_id) DO UPDATE SET status = EXCLUDED.status,
                parser_version = EXCLUDED.parser_version, pending_parts = EXCLUDED.pending_parts, notification_pending = true,
                generation = email_message_calendar_extraction.generation + CASE WHEN $6::bigint IS NULL THEN 1 ELSE 0 END,
                retry_after = now() + interval '1 minute' * LEAST(60, 1 + email_message_calendar_extraction.attempts), updated_at = now()
        "#, message_id, has_pending, unsupported, crate::domain::models::calendar_invitation::INVITATION_PARSER_VERSION as i16, pending_json, generation).execute(&mut *tx).await?;
        sqlx::query!(
            r#"UPDATE email_threads SET has_calendar_attachment = true
            WHERE id = (SELECT thread_id FROM email_messages WHERE id = $1)
              AND EXISTS (SELECT 1 FROM email_message_calendar_invites WHERE message_id = $1)
              AND NOT has_calendar_attachment"#,
            message_id
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }
    async fn claim(
        &self,
    ) -> Result<Vec<crate::domain::invitation_extraction::InvitationExtractionJob>, Report> {
        use crate::domain::invitation_extraction::{
            InvitationExtractionJob, PendingInvitationPart,
        };
        // Resume recent attachment-flagged history without inspecting MIME on reads.
        sqlx::query!(r#"INSERT INTO email_message_calendar_extraction(message_id, status, parser_version, retry_after)
            SELECT m.id, 'unprocessed', 0, now() FROM email_messages m
            JOIN email_threads t ON t.id = m.thread_id
            WHERE t.has_calendar_attachment AND NOT m.is_draft AND m.provider_id IS NOT NULL
              AND m.created_at >= now() - interval '90 days'
              AND NOT EXISTS (SELECT 1 FROM email_message_calendar_extraction e WHERE e.message_id = m.id)
            ORDER BY m.created_at DESC LIMIT 16 ON CONFLICT DO NOTHING"#).execute(&self.0).await?;
        let rows = sqlx::query!(r#"
            WITH due AS (
                SELECT message_id FROM email_message_calendar_extraction
                WHERE parser_version <= $1
                  AND (status IN ('unprocessed', 'pending') OR notification_pending)
                  AND retry_after <= now()
                ORDER BY retry_after LIMIT 16 FOR UPDATE SKIP LOCKED
            ), claimed AS (
                UPDATE email_message_calendar_extraction e SET retry_after = now() + interval '5 minutes', attempts = LEAST(e.attempts + 1, 30000), generation = e.generation + 1
                FROM due WHERE e.message_id = due.message_id RETURNING e.message_id, e.pending_parts, e.generation, e.status, e.parser_version
            ) SELECT c.message_id, c.generation, c.status, c.parser_version, m.link_id, m.provider_id AS "provider_id!", c.pending_parts AS "parts!: Json<Vec<PendingInvitationPart>>"
            FROM claimed c JOIN email_messages m ON m.id = c.message_id WHERE m.provider_id IS NOT NULL
        "#, crate::domain::models::calendar_invitation::INVITATION_PARSER_VERSION as i16).fetch_all(&self.0).await?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let discover = r.status == "unprocessed"
                    || r.parser_version
                        < crate::domain::models::calendar_invitation::INVITATION_PARSER_VERSION
                            as i16;
                InvitationExtractionJob {
                    message_id: r.message_id,
                    link_id: r.link_id,
                    provider_id: r.provider_id,
                    parts: if discover { Vec::new() } else { r.parts.0 },
                    notification_only: !discover && r.status != "pending",
                    discover,
                    generation: r.generation,
                }
            })
            .collect())
    }
    async fn notified(&self, message_id: Uuid, generation: i64) -> Result<(), Report> {
        sqlx::query!("UPDATE email_message_calendar_extraction SET notification_pending = false WHERE message_id = $1 AND generation = $2", message_id, generation).execute(&self.0).await?;
        Ok(())
    }
}

#[cfg(feature = "calendar_resolution")]
impl crate::domain::invitation_resolution::InvitationRevisionRepository for InvitationPgRepository {
    async fn revisions(
        &self,
        viewer: &str,
        thread_id: Uuid,
        uids: &[String],
    ) -> Result<Vec<(Uuid, CalendarInvitation)>, Report> {
        let rows = sqlx::query!(
            r#"SELECT m.link_id, i.snapshot AS "snapshot!: Json<CalendarInvitation>"
            FROM email_message_calendar_invites i JOIN email_messages m ON m.id = i.message_id
            JOIN email_links l ON l.id = m.link_id
            WHERE (m.thread_id = $2 OR l.macro_id = $1) AND i.snapshot->>'uid' = ANY($3)
              AND i.snapshot->>'method' IN ('request', 'cancel')
            ORDER BY (i.snapshot->>'sequence')::bigint DESC,
                COALESCE(i.snapshot->>'last_modified', i.snapshot->>'dtstamp', '') DESC
            LIMIT 3200"#,
            viewer,
            thread_id,
            uids
        )
        .fetch_all(&self.0)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| (r.link_id, r.snapshot.0))
            .collect())
    }
}

#[cfg(all(test, feature = "calendar_parser"))]
mod test;
