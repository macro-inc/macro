use super::EmailPgRepo;
use crate::domain::{
    attachment_access::*, draft_attachments::AttachmentError, mailbox::MailboxKey,
};
use uuid::Uuid;
fn failed<E>(_: E) -> AttachmentError {
    AttachmentError::Infrastructure
}
impl AttachmentReadRepository for EmailPgRepo {
    async fn attachment_read_record(
        &self,
        id: Uuid,
    ) -> Result<Option<AttachmentReadRecord>, AttachmentError> {
        let Some(row)=sqlx::query!("SELECT a.message_id,m.thread_id,m.link_id,l.sync_generation,l.grant_generation FROM email_attachments a JOIN email_messages m ON m.id = a.message_id JOIN email_links l ON l.id = m.link_id WHERE a.id = $1",id).fetch_optional(&self.pool).await.map_err(failed)? else {return Ok(None)};
        let link = email_db_client::links::get::fetch_link_by_id(&self.pool, row.link_id)
            .await
            .map_err(failed)?
            .ok_or(AttachmentError::NotFound)?;
        let Some((attachment, message_provider_id)) =
            email_db_client::attachments::provider::fetch_attachment_by_id(
                &self.pool,
                id,
                row.link_id,
            )
            .await
            .map_err(failed)?
        else {
            return Ok(None);
        };
        Ok(Some(AttachmentReadRecord {
            blob: sqlx::query!("SELECT object_key,sha256,size_bytes FROM email_attachment_blobs WHERE attachment_id=$1",id)
                .fetch_optional(&self.pool).await.map_err(failed)?.map(|blob|StoredAttachmentBlob { key:blob.object_key,sha256:blob.sha256,size:blob.size_bytes }),
            attachment,
            message_id: row.message_id,
            thread_id: row.thread_id,
            message_provider_id,
            link,
            mailbox: MailboxKey {
                link_id: row.link_id,
                sync_generation: row.sync_generation,
                grant_generation: row.grant_generation,
            },
        }))
    }
    async fn existing_attachment_document(
        &self,
        id: Uuid,
    ) -> Result<Option<String>, AttachmentError> {
        email_db_client::attachments::provider::get_document_id_by_att_id(&self.pool, id)
            .await
            .map_err(failed)
    }
}

impl crate::domain::mailbox::drafts::content::DraftContentRepository for EmailPgRepo {
    async fn sender_address(
        &self,
        link: Uuid,
    ) -> Result<String, crate::domain::mailbox::MailboxError> {
        sqlx::query_scalar!("SELECT email_address FROM email_links WHERE id = $1", link)
            .fetch_one(&self.pool)
            .await
            .map_err(|_| crate::domain::mailbox::MailboxError::Persistence)
    }
    async fn reply_context(
        &self,
        id: Uuid,
    ) -> Result<
        Option<crate::domain::mailbox::drafts::content::ReplyContext>,
        crate::domain::mailbox::MailboxError,
    > {
        let row=sqlx::query!("SELECT global_id,headers_jsonb,link_id,thread_id,provider_id FROM email_messages WHERE id = $1",id).fetch_optional(&self.pool).await.map_err(|_|crate::domain::mailbox::MailboxError::Persistence)?;
        Ok(row.map(
            |row| crate::domain::mailbox::drafts::content::ReplyContext {
                global_id: row.global_id,
                headers_jsonb: row.headers_jsonb,
                link_id: row.link_id,
                thread_id: row.thread_id,
                provider_id: row.provider_id,
            },
        ))
    }
}
