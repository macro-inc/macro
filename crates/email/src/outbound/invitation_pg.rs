//! Email-owned display snapshots.
use crate::domain::models::calendar_invitation::CalendarInvitation;
#[cfg(feature = "calendar_invitations")]
use rootcause::Report;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

/// Snapshot persistence adapter for ingestion and invitation resolution.
#[derive(Clone)]
pub struct InvitationPgRepository(pub PgPool);

/// An undecodable snapshot hides its card instead of failing the whole thread read.
fn decode(message_id: Uuid, snapshot: serde_json::Value) -> Option<CalendarInvitation> {
    serde_json::from_value(snapshot)
        .inspect_err(|error| {
            tracing::warn!(error = ?error, %message_id, "skipping undecodable invitation snapshot");
        })
        .ok()
}

/// Load saved components for fully hydrated messages in one query.
pub(crate) async fn load(
    pool: &PgPool,
    ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<CalendarInvitation>>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT message_id, snapshot
        FROM email_message_calendar_invites
        WHERE message_id = ANY($1)
        ORDER BY message_id, component_id"#,
        ids
    )
    .fetch_all(pool)
    .await?;
    let mut loaded = HashMap::<Uuid, Vec<CalendarInvitation>>::new();
    for row in rows {
        if let Some(invitation) = decode(row.message_id, row.snapshot) {
            loaded.entry(row.message_id).or_default().push(invitation);
        }
    }
    Ok(loaded)
}

#[cfg(feature = "calendar_invitations")]
impl crate::domain::invitation_extraction::InvitationExtractionRepository
    for InvitationPgRepository
{
    async fn save(
        &self,
        message_id: Uuid,
        invitations: &[CalendarInvitation],
    ) -> Result<(), Report> {
        if invitations.is_empty() {
            return Ok(());
        }
        let mut tx = self.0.begin().await?;
        for snapshot in invitations {
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
        // Inline calendar parts are not stored as attachments.
        sqlx::query!(
            r#"UPDATE email_threads SET has_calendar_attachment = true
            WHERE id = (SELECT thread_id FROM email_messages WHERE id = $1)
              AND NOT has_calendar_attachment"#,
            message_id
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(feature = "calendar_invitations")]
impl crate::domain::invitation_resolution::InvitationSnapshotRepository for InvitationPgRepository {
    async fn thread_invitations(
        &self,
        thread_id: Uuid,
        limit: i64,
    ) -> Result<Vec<crate::domain::invitation_resolution::ThreadInvitation>, Report> {
        let rows = sqlx::query!(
            r#"SELECT m.id AS message_id, m.link_id, i.snapshot
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
            .filter_map(|r| {
                Some(crate::domain::invitation_resolution::ThreadInvitation {
                    invitation: decode(r.message_id, r.snapshot)?,
                    message_id: r.message_id,
                    link_id: r.link_id,
                })
            })
            .collect())
    }
}

#[cfg(all(test, feature = "calendar_invitations"))]
mod test;
