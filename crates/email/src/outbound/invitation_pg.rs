//! Email-owned display snapshots and leased attachment extraction work.
use crate::domain::models::calendar_invitation::CalendarInvitation;
#[cfg(feature = "calendar_parser")]
use crate::domain::models::calendar_invitation::{InvitationExtractionStatus, ParsedInvitations};
use rootcause::Report;
use sqlx::{PgPool, types::Json};
use std::collections::HashMap;
use uuid::Uuid;

/// Snapshot persistence adapter shared by ingestion and thread reads.
#[derive(Clone)]
pub struct InvitationPgRepository(pub PgPool);

/// Load saved components for fully hydrated messages in one query.
pub(crate) async fn load(
    pool: &PgPool,
    ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<CalendarInvitation>>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT message_id, snapshot AS "snapshot: Json<CalendarInvitation>"
        FROM email_message_calendar_invites
        WHERE message_id = ANY($1)
        ORDER BY message_id, component_id"#,
        ids
    )
    .fetch_all(pool)
    .await?;
    let mut loaded = HashMap::<Uuid, Vec<CalendarInvitation>>::new();
    for row in rows {
        loaded
            .entry(row.message_id)
            .or_default()
            .push(row.snapshot.0);
    }
    Ok(loaded)
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
        parsed: &ParsedInvitations,
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
        let current = sqlx::query!(r#"SELECT generation, parser_version,
            EXISTS(SELECT 1 FROM email_message_calendar_invites WHERE message_id = $1) AS "has_snapshots!"
            FROM email_message_calendar_extraction WHERE message_id = $1 FOR UPDATE"#, message_id).fetch_optional(&mut *tx).await?;
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
        // Keep the last usable snapshot until reinspection can replace the whole set.
        // Keeping its version makes the durable retry rediscover every MIME part.
        let deferred_version = current
            .as_ref()
            .filter(|row| {
                row.parser_version < parser_version
                    && row.has_snapshots
                    && (!pending.is_empty() || parsed.status == InvitationExtractionStatus::Absent)
            })
            .map(|row| row.parser_version);
        let mut changed = false;
        if deferred_version.is_none() {
            if current
                .as_ref()
                .is_some_and(|row| row.parser_version < parser_version)
            {
                // Reinspection starts a new component set; retries within it still append.
                changed |= sqlx::query!(
                    "DELETE FROM email_message_calendar_invites WHERE message_id = $1",
                    message_id
                )
                .execute(&mut *tx)
                .await?
                .rows_affected()
                    > 0;
            }
            for snapshot in &parsed.invitations {
                let json = serde_json::to_value(snapshot)?;
                changed |= sqlx::query!(
                    r#"INSERT INTO email_message_calendar_invites(message_id, component_id, snapshot)
                    VALUES ($1, $2, $3) ON CONFLICT (message_id, component_id) DO NOTHING"#,
                    message_id,
                    snapshot.id,
                    json
                )
                .execute(&mut *tx)
                .await?
                .rows_affected()
                    > 0;
            }
        }
        let has_pending = deferred_version.is_some() || !pending.is_empty();
        let stored_version = deferred_version.unwrap_or(parser_version);
        let unsupported = parsed.status == InvitationExtractionStatus::Unsupported;
        let pending_json = serde_json::to_value(pending)?;
        // Only changed snapshots need a refresh; an undelivered one stays due.
        let refresh_due = sqlx::query_scalar!(r#"
            INSERT INTO email_message_calendar_extraction(message_id, status, parser_version, pending_parts, retry_after, notification_pending)
            VALUES ($1, CASE WHEN $2 THEN 'pending' WHEN EXISTS (SELECT 1 FROM email_message_calendar_invites WHERE message_id = $1) THEN 'ready' WHEN $3 THEN 'unsupported' ELSE 'absent' END, $4, $5, now() + interval '1 minute', $7)
            ON CONFLICT (message_id) DO UPDATE SET status = EXCLUDED.status,
                parser_version = EXCLUDED.parser_version, pending_parts = EXCLUDED.pending_parts,
                notification_pending = email_message_calendar_extraction.notification_pending OR EXCLUDED.notification_pending,
                generation = email_message_calendar_extraction.generation + CASE WHEN $6::bigint IS NULL THEN 1 ELSE 0 END,
                retry_after = now() + interval '1 minute' * LEAST(60, 1 + email_message_calendar_extraction.attempts), updated_at = now()
            RETURNING notification_pending
        "#, message_id, has_pending, unsupported, stored_version, pending_json, generation, changed).fetch_one(&mut *tx).await?;
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
        Ok(refresh_due)
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
                let notification_only = !matches!(r.status.as_str(), "unprocessed" | "pending");
                let discover = !notification_only
                    && (r.status == "unprocessed"
                        || r.parser_version
                            < crate::domain::models::calendar_invitation::INVITATION_PARSER_VERSION
                                as i16);
                InvitationExtractionJob {
                    message_id: r.message_id,
                    link_id: r.link_id,
                    provider_id: r.provider_id,
                    parts: if discover { Vec::new() } else { r.parts.0 },
                    notification_only,
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
impl crate::domain::invitation_resolution::InvitationSnapshotRepository for InvitationPgRepository {
    async fn thread_invitations(
        &self,
        thread_id: Uuid,
        limit: i64,
    ) -> Result<Vec<crate::domain::invitation_resolution::ThreadInvitation>, Report> {
        let rows = sqlx::query!(
            r#"SELECT m.id AS message_id, m.link_id, i.snapshot AS "snapshot!: Json<CalendarInvitation>"
            FROM email_message_calendar_invites i JOIN email_messages m ON m.id = i.message_id
            WHERE m.thread_id = $1
            ORDER BY COALESCE(m.internal_date_ts, m.sent_at, m.created_at) DESC, m.id DESC, i.component_id
            LIMIT $2"#,
            thread_id,
            limit
        )
        .fetch_all(&self.0)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| crate::domain::invitation_resolution::ThreadInvitation {
                message_id: r.message_id,
                link_id: r.link_id,
                invitation: r.snapshot.0,
            })
            .collect())
    }
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
