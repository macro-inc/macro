//! Authorized attachment reads; the owner mailbox supplies provider credentials.
use super::{draft_attachments::AttachmentError, mailbox::MailboxKey, ports::EmailUserRepo};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use entity_kind::EntityType;
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{attachment::Attachment, link::Link};
use std::future::Future;
use uuid::Uuid;

/// Authorized bytes for forwarding or moving a draft between provider accounts.
pub trait AuthorizedAttachmentBytes: Send + Sync + 'static {
    fn read<'a>(
        &'a self,
        actor: &'a str,
        id: Uuid,
    ) -> BoxFuture<'a, Result<(AttachmentReadRecord, Vec<u8>), super::mailbox::MailboxError>>;
}

#[derive(Clone)]
pub struct AttachmentReadRecord {
    pub blob: Option<StoredAttachmentBlob>,
    pub attachment: Attachment,
    pub message_id: Uuid,
    pub thread_id: Uuid,
    pub message_provider_id: String,
    pub link: Link,
    pub mailbox: MailboxKey,
}

#[derive(Debug, Clone)]
pub struct StoredAttachmentBlob {
    pub key: String,
    pub sha256: String,
    pub size: i64,
}

/// The Macro document already linked to an attachment.
#[derive(Debug, Clone)]
pub struct ExistingAttachmentDocument {
    pub id: String,
    /// The document's bytes have not finished reaching storage.
    pub awaiting_upload: bool,
}

pub trait AttachmentReadRepository: EmailUserRepo {
    fn attachment_read_record(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<AttachmentReadRecord>, AttachmentError>> + Send;
    fn existing_attachment_document(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<ExistingAttachmentDocument>, AttachmentError>> + Send;
}
pub trait AttachmentBytes: Send + Sync + 'static {
    fn bytes(
        &self,
        record: &AttachmentReadRecord,
    ) -> impl Future<Output = Result<Vec<u8>, AttachmentError>> + Send;
}
pub trait AttachmentFiles: Send + Sync + 'static {
    fn cached_url(
        &self,
        record: &AttachmentReadRecord,
    ) -> impl Future<Output = Result<Option<String>, AttachmentError>> + Send;
    fn store_download(
        &self,
        record: &AttachmentReadRecord,
        bytes: Vec<u8>,
    ) -> impl Future<Output = Result<String, AttachmentError>> + Send;
    fn store_document(
        &self,
        record: &AttachmentReadRecord,
        bytes: Vec<u8>,
    ) -> impl Future<Output = Result<String, AttachmentError>> + Send;
}
pub struct AttachmentReadService<R, P, S, A> {
    pub repository: R,
    pub provider: P,
    pub files: S,
    pub access: A,
}
impl<R: AttachmentReadRepository, P: AttachmentBytes, S: AttachmentFiles, A: EntityAccessService>
    AttachmentReadService<R, P, S, A>
{
    pub async fn authorize(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<AttachmentReadRecord, AttachmentError> {
        let record = self
            .repository
            .attachment_read_record(id)
            .await?
            .ok_or(AttachmentError::NotFound)?;
        let links = self
            .repository
            .user_accessible_inboxes(actor.clone())
            .await
            .map_err(|_| AttachmentError::Infrastructure)?;
        if !links.iter().any(|link| link.id == record.link.id) {
            self.access
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    actor,
                    None,
                    &record.thread_id.to_string(),
                    EntityType::EmailThread,
                )
                .await
                .map_err(|_| AttachmentError::Forbidden)?;
        }
        Ok(record)
    }
    pub async fn download(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Attachment, AttachmentError> {
        let mut record = self.authorize(actor, id).await?;
        if record.attachment.reference_url.is_some() {
            return Ok(record.attachment);
        }
        let url = match self.files.cached_url(&record).await? {
            Some(url) => url,
            None => {
                let bytes = self.provider.bytes(&record).await?;
                self.files.store_download(&record, bytes).await?
            }
        };
        record.attachment.data_url = Some(url);
        Ok(record.attachment)
    }
    pub async fn document(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<String, AttachmentError> {
        let record = self.authorize(actor, id).await?;
        if record.attachment.reference_url.is_some() {
            return Err(AttachmentError::Invalid(
                "Open this linked attachment in Outlook",
            ));
        }
        // Authorization precedes even the cache hit: a document ID is not proof
        // that this caller can read the attachment's source thread.
        if let Some(document) = self.repository.existing_attachment_document(id).await? {
            if document.awaiting_upload {
                self.store_unfinished_document(&record, &document.id).await;
            }
            return Ok(document.id);
        }
        let bytes = self.provider.bytes(&record).await?;
        self.files.store_document(&record, bytes).await
    }

    /// Stores the bytes again for a document whose upload never finished. Its
    /// link to the attachment is written first, so sync and later imports treat
    /// the attachment as done and nothing else retries it. A failure still
    /// opens the document: the first upload may simply be finishing.
    #[tracing::instrument(
        name = "email.attachment.store_unfinished_document",
        skip_all,
        fields(attachment_id = %record.attachment.db_id, document_id = %document_id)
    )]
    async fn store_unfinished_document(&self, record: &AttachmentReadRecord, document_id: &str) {
        let stored = async {
            let bytes = self.provider.bytes(record).await?;
            self.files.store_document(record, bytes).await
        }
        .await;
        if let Err(error) = stored {
            tracing::warn!(?error, "could not store an unfinished attachment document");
        }
    }
}

#[cfg(test)]
mod test;
