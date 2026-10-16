//! Byte access for the email domain's frozen draft-content service.
use email::domain::{
    attachment_access::{AttachmentBytes, AttachmentReadRecord},
    draft_attachments::AttachmentError,
    mailbox::{MailboxError, drafts::content::DraftContentBytes},
};
use email_api_client::domain::models::EmailApiError;

pub struct MailboxDraftContent<P> {
    pub provider: P,
    pub s3: s3_client::S3,
    pub bucket: String,
}
impl<P: AttachmentBytes> DraftContentBytes for MailboxDraftContent<P> {
    async fn uploaded(&self, key: &str) -> Result<Vec<u8>, MailboxError> {
        self.s3
            .get(&self.bucket, key)
            .await
            .map_err(|_| MailboxError::Persistence)
    }
    async fn provider(&self, record: &AttachmentReadRecord) -> Result<Vec<u8>, MailboxError> {
        self.provider.bytes(record).await.map_err(|e| match e {
            AttachmentError::Forbidden => EmailApiError::Forbidden.into(),
            AttachmentError::NotFound => EmailApiError::NotFound.into(),
            AttachmentError::Reauthorization => EmailApiError::AuthRequired.into(),
            _ => MailboxError::Persistence,
        })
    }
}
