use super::EmailPgRepo;
use crate::domain::{draft_attachments::AttachmentError, mailbox::MailboxKey, message_source::*};
use uuid::Uuid;
fn failed<E>(_: E) -> AttachmentError {
    AttachmentError::Infrastructure
}
impl MessageSourceRepository for EmailPgRepo {
    async fn message_source_record(
        &self,
        id: Uuid,
    ) -> Result<Option<MessageSourceRecord>, AttachmentError> {
        let Some(row) = sqlx::query!(
            r#"SELECT m.thread_id, m.link_id, m.provider_id AS "provider_id!", m.subject,
                l.sync_generation, l.grant_generation
            FROM email_messages m JOIN email_links l ON l.id = m.link_id
            WHERE m.id = $1 AND NOT m.is_draft AND m.provider_id IS NOT NULL"#,
            id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failed)?
        else {
            return Ok(None);
        };
        let link = email_db_client::links::get::fetch_link_by_id(&self.pool, row.link_id)
            .await
            .map_err(failed)?
            .ok_or(AttachmentError::NotFound)?;
        Ok(Some(MessageSourceRecord {
            message_id: id,
            thread_id: row.thread_id,
            message_provider_id: row.provider_id,
            subject: row.subject,
            link,
            mailbox: MailboxKey {
                link_id: row.link_id,
                sync_generation: row.sync_generation,
                grant_generation: row.grant_generation,
            },
        }))
    }
}
