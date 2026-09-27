//! Email-owned display snapshots.
use crate::domain::models::calendar_invitation::CalendarInvitation;
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
