//! Authorized reads of a message's original RFC 822 source, for `.eml` download.
//! Access matches attachment reads; the owner mailbox supplies provider credentials.
use super::{draft_attachments::AttachmentError, mailbox::MailboxKey, ports::EmailUserRepo};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_email::service::link::Link;
use std::future::Future;
use uuid::Uuid;

#[derive(Clone)]
pub struct MessageSourceRecord {
    pub message_id: Uuid,
    pub thread_id: Uuid,
    pub message_provider_id: String,
    pub subject: Option<String>,
    pub link: Link,
    pub mailbox: MailboxKey,
}

/// A message's original bytes with the file name they download under.
pub struct MessageSource {
    pub filename: String,
    pub bytes: Vec<u8>,
}

pub trait MessageSourceRepository: EmailUserRepo {
    /// The provider-backed record of a synced, non-draft message.
    fn message_source_record(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<MessageSourceRecord>, AttachmentError>> + Send;
}
pub trait MessageSourceBytes: Send + Sync + 'static {
    fn bytes(
        &self,
        record: &MessageSourceRecord,
    ) -> impl Future<Output = Result<Vec<u8>, AttachmentError>> + Send;
}
pub struct MessageSourceService<R, P, A> {
    pub repository: R,
    pub provider: P,
    pub access: A,
}
impl<R: MessageSourceRepository, P: MessageSourceBytes, A: EntityAccessService>
    MessageSourceService<R, P, A>
{
    pub async fn download(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<MessageSource, AttachmentError> {
        let record = self
            .repository
            .message_source_record(id)
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
        let bytes = self.provider.bytes(&record).await?;
        Ok(MessageSource {
            filename: eml_filename(record.subject.as_deref()),
            bytes,
        })
    }
}

const MAX_FILENAME_STEM_CHARS: usize = 120;

/// A portable `.eml` file name from the subject: characters that file systems or
/// `Content-Disposition` reject become spaces, and an empty subject is "email".
pub fn eml_filename(subject: Option<&str>) -> String {
    let cleaned: String = subject
        .unwrap_or_default()
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let stem: String = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_FILENAME_STEM_CHARS)
        .collect();
    let stem = stem.trim().trim_matches('.');
    format!("{}.eml", if stem.is_empty() { "email" } else { stem })
}

#[cfg(test)]
mod test;
