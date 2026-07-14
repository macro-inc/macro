#[cfg(test)]
mod test;

use crate::domain::ports::{
    ContactsBackfillOutboxMessage, ContactsBackfillOutboxRepo, ContactsRepository,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Database-backed implementation of [`ContactsRepository`].
pub struct DbContactsRepository {
    /// The PostgreSQL connection pool.
    pub db: PgPool,
}

impl DbContactsRepository {
    /// Creates a new repository with the given connection pool.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl ContactsRepository for DbContactsRepository {
    async fn get_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let rows = sqlx::query!(
            "
            SELECT user1 AS contact FROM contacts_connections WHERE user2 = $1
            UNION
            SELECT user2 AS contact FROM contacts_connections WHERE user1 = $1
            ",
            user_id.as_ref()
        )
        .fetch_all(&self.db)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|r| r.contact)
            .filter_map(|s| MacroUserIdStr::try_from(s).ok())
            .collect())
    }

    async fn create_connections(
        &self,
        connections: Vec<(MacroUserIdStr<'_>, MacroUserIdStr<'_>)>,
    ) -> Result<(), Report> {
        let (users1, users2): (Vec<_>, Vec<_>) = connections
            .into_iter()
            .filter(|(a, b)| a.as_ref() != b.as_ref())
            .map(|(a, b)| {
                if a.as_ref() <= b.as_ref() {
                    (a, b)
                } else {
                    (b, a)
                }
            })
            .unzip();

        let u1: Vec<&str> = users1.iter().map(|u| u.as_ref()).collect();
        let u2: Vec<&str> = users2.iter().map(|u| u.as_ref()).collect();

        sqlx::query!(
            "
            INSERT INTO contacts_connections(user1, user2)
            SELECT * FROM unnest($1::text[], $2::text[])
            ON CONFLICT(user1, user2) DO UPDATE SET updated_at = now()
            ",
            &u1 as &[&str],
            &u2 as &[&str]
        )
        .execute(&self.db)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "couldn't create connections");
        })?;

        Ok(())
    }
}

struct BackfillOutboxRow {
    id: i32,
    comms_channel_id: Uuid,
    user_ids: serde_json::Value,
}

impl ContactsBackfillOutboxRepo for DbContactsRepository {
    async fn get_unapplied_messages(&self) -> Result<Vec<ContactsBackfillOutboxMessage>, Report> {
        let rows = sqlx::query_as!(
            BackfillOutboxRow,
            "SELECT id, comms_channel_id, user_ids
             FROM contacts_backfill_outbox
             WHERE applied_at IS NULL
             ORDER BY id"
        )
        .fetch_all(&self.db)
        .await?;

        rows.into_iter()
            .map(|r| -> Result<ContactsBackfillOutboxMessage, Report> {
                let user_ids: Vec<String> = serde_json::from_value(r.user_ids)?;
                let channel_participants = user_ids
                    .into_iter()
                    .filter_map(|id| MacroUserIdStr::try_from(id).ok())
                    .collect();
                Ok(ContactsBackfillOutboxMessage {
                    id: r.id as u64,
                    channel_id: r.comms_channel_id,
                    channel_participants,
                })
            })
            .collect()
    }

    #[tracing::instrument(err, skip(self))]
    async fn mark_message_applied(&self, id: u64) -> Result<(), Report> {
        sqlx::query!(
            "UPDATE contacts_backfill_outbox SET applied_at = now() WHERE id = $1",
            id as i64
        )
        .execute(&self.db)
        .await
        .inspect_err(
            |e| tracing::error!(error=?e, "couldn't mark backfill outbox message applied"),
        )?;
        Ok(())
    }
}
