use super::*;
use crate::domain::mailbox::{gmail_history::*, lifecycle::InboxLifecycleEffect};

#[cfg(test)]
mod test;

impl GmailHistoryRepository for PgMailboxSync {
    async fn commit_history(
        &self,
        link: Uuid,
        expected: &str,
        next: &str,
        work: &[HistoryWork],
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        let current=sqlx::query!(r#"SELECT h.history_id FROM email_links l JOIN email_gmail_histories h ON h.link_id=l.id
            WHERE l.id=$1 AND l.provider='GMAIL' AND l.is_sync_active AND l.disconnect_requested_at IS NULL FOR UPDATE OF l,h"#,link)
            .fetch_optional(&mut *tx).await.map_err(db_error)?.ok_or(MailboxError::Stale)?;
        if current.history_id != expected {
            return Err(MailboxError::Stale);
        }
        for item in work {
            let payload =
                serde_json::to_value(InboxLifecycleEffect::GmailHistory { work: item.clone() })
                    .map_err(|_| MailboxError::Persistence)?;
            sqlx::query!(
                "INSERT INTO email_mailbox_lifecycle_outbox(id,link_id,payload) VALUES($1,$2,$3)",
                macro_uuid::generate_uuid_v7(),
                link,
                payload
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        sqlx::query!(
            "UPDATE email_gmail_histories SET history_id=$2,updated_at=now() WHERE link_id=$1",
            link,
            next
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }
}
