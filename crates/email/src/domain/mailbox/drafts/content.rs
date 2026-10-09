//! Freeze draft content and authorize every referenced source in the domain.
use super::{models::*, ports::DraftMaterializer};
use crate::domain::{
    attachment_access::{AttachmentReadRecord, AttachmentReadRepository},
    mailbox::MailboxError,
};
use email_api_client::domain::models::{EmailApiError, ProviderId, SendRequest};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{address::ContactInfo, message::MessageToSend};
use sha2::{Digest, Sha256};
use std::future::Future;
use uuid::Uuid;

pub struct ReplyContext {
    pub global_id: Option<String>,
    pub headers_jsonb: Option<serde_json::Value>,
    pub link_id: Uuid,
    pub thread_id: Uuid,
    pub provider_id: Option<String>,
}
pub trait DraftContentRepository: AttachmentReadRepository {
    fn sender_address(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<String, MailboxError>> + Send;
    fn reply_context(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<ReplyContext>, MailboxError>> + Send;
}
pub trait DraftContentBytes: Send + Sync + 'static {
    fn uploaded(&self, key: &str) -> impl Future<Output = Result<Vec<u8>, MailboxError>> + Send;
    fn provider(
        &self,
        record: &AttachmentReadRecord,
    ) -> impl Future<Output = Result<Vec<u8>, MailboxError>> + Send;
}
pub struct DraftContentService<R, B, A> {
    pub repository: R,
    pub bytes: B,
    pub access: A,
}

impl<R: DraftContentRepository, B: DraftContentBytes, A: EntityAccessService>
    crate::domain::attachment_access::AuthorizedAttachmentBytes for DraftContentService<R, B, A>
{
    fn read<'a>(
        &'a self,
        actor: &'a str,
        id: Uuid,
    ) -> BoxFuture<'a, Result<(AttachmentReadRecord, Vec<u8>), MailboxError>> {
        Box::pin(async move {
            let record = self
                .repository
                .attachment_read_record(id)
                .await
                .map_err(|_| MailboxError::Persistence)?
                .ok_or(EmailApiError::NotFound)?;
            self.authorize(actor, record.link.id, record.thread_id)
                .await?;
            if record.attachment.reference_url.is_some() {
                return Err(EmailApiError::Permanent {
                    message:
                        "Share cloud attachment links from Outlook before changing the sender inbox"
                            .into(),
                }
                .into());
            }
            let bytes = self.bytes.provider(&record).await?;
            Ok((record, bytes))
        })
    }
}
impl<R: DraftContentRepository, B: DraftContentBytes, A: EntityAccessService>
    DraftContentService<R, B, A>
{
    async fn authorize(&self, actor: &str, link: Uuid, thread: Uuid) -> Result<(), MailboxError> {
        let actor =
            MacroUserIdStr::try_from(actor.to_owned()).map_err(|_| EmailApiError::Forbidden)?;
        let links = self
            .repository
            .user_accessible_inboxes(actor.clone())
            .await
            .map_err(|_| MailboxError::Persistence)?;
        if !links.iter().any(|item| item.id == link) {
            self.access
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    &actor,
                    None,
                    &thread.to_string(),
                    model_entity::EntityType::EmailThread,
                )
                .await
                .map_err(|_| EmailApiError::Forbidden)?;
        }
        Ok(())
    }
    async fn provider_bytes(
        &self,
        lease: &DraftLease,
        source: &AttachmentSource,
    ) -> Result<Vec<u8>, MailboxError> {
        match source {
            AttachmentSource::Uploaded { key } => self.bytes.uploaded(key).await,
            AttachmentSource::Provider {
                db_id,
                link_id,
                generation,
                message_id,
                ..
            } => {
                let record = self
                    .repository
                    .attachment_read_record(*db_id)
                    .await
                    .map_err(|_| MailboxError::Persistence)?
                    .ok_or(EmailApiError::NotFound)?;
                if record.link.id != *link_id || record.message_provider_id != message_id.as_str() {
                    return Err(EmailApiError::Conflict.into());
                }
                let actor = lease
                    .checkpoint
                    .as_ref()
                    .map_or(lease.actor_id.as_str(), |c| c.actor_id.as_str());
                self.authorize(actor, record.link.id, record.thread_id)
                    .await?;
                if record.blob.is_none()
                    && (!record.link.is_sync_active
                        || (record.link.provider
                            == models_email::service::link::UserProvider::Outlook
                            && record.mailbox.grant_generation != *generation))
                {
                    return Err(EmailApiError::AuthRequired.into());
                }
                if record.attachment.reference_url.is_some() {
                    return Err(EmailApiError::Permanent {
                        message: "Share cloud attachment links from Outlook".into(),
                    }
                    .into());
                }
                self.bytes.provider(&record).await
            }
        }
    }
}

impl<R, B, A> DraftMaterializer for DraftContentService<R, B, A>
where
    R: DraftContentRepository,
    B: DraftContentBytes,
    A: EntityAccessService,
{
    async fn prepare_draft(&self, lease: &DraftLease) -> Result<PreparedDraft, MailboxError> {
        let input = &lease.input;
        let from = self
            .repository
            .sender_address(lease.mailbox.link_id)
            .await?;
        let parent = if let Some(id) = input.replying_to_id.filter(|_| !lease.delete_requested) {
            let parent = self
                .repository
                .reply_context(id)
                .await?
                .ok_or(EmailApiError::NotFound)?;
            self.authorize(&lease.actor_id, parent.link_id, parent.thread_id)
                .await?;
            Some(parent)
        } else {
            None
        };
        let reply_to = parent
            .as_ref()
            .filter(|p| p.link_id == lease.mailbox.link_id)
            .and_then(|p| p.provider_id.clone())
            .map(ProviderId::new)
            .transpose()?;
        let parent_message_id = parent.as_ref().and_then(|p| {
            p.global_id
                .clone()
                .or_else(|| header(p.headers_jsonb.as_ref(), "message-id"))
        });
        let mut references: Vec<String> = parent
            .as_ref()
            .and_then(|p| header(p.headers_jsonb.as_ref(), "references"))
            .map(|r| r.split_whitespace().map(str::to_owned).collect())
            .unwrap_or_default();
        if let Some(parent) = &parent_message_id {
            references.push(parent.clone());
        }
        let request = SendRequest {
            message: MessageToSend {
                db_id: Some(lease.message_id),
                provider_id: lease.provider_id.as_ref().map(|id| id.as_str().to_owned()),
                replying_to_id: input.replying_to_id,
                provider_thread_id: input.provider_thread_id.clone(),
                thread_db_id: Some(input.thread_db_id),
                link_id: lease.mailbox.link_id,
                subject: input.subject.clone(),
                to: Some(input.to.iter().map(contact).collect()),
                cc: Some(input.cc.iter().map(contact).collect()),
                bcc: Some(input.bcc.iter().map(contact).collect()),
                body_text: input.body_text.clone(),
                body_html: input.body_html.clone(),
                body_macro: input.body_macro.clone(),
                attachments: None,
                headers_json: input.headers_json.clone(),
                send_time: input.send_time,
            },
            from: ContactInfo {
                email: from,
                name: None,
                photo_url: None,
            },
            parent_message_id,
            references: (!references.is_empty()).then_some(references),
        };
        if lease.delete_requested {
            return Ok(PreparedDraft {
                reply_to,
                request,
                files: Vec::new(),
                removals: Vec::new(),
            });
        }
        let mut files = Vec::new();
        for upload in lease.attachments.uploads.clone() {
            let source = AttachmentSource::Uploaded { key: upload.s3_key };
            let bytes = self.provider_bytes(lease, &source).await?;
            if bytes.len() as i64 != i64::from(upload.size)
                || format!("{:x}", Sha256::digest(&bytes)) != upload.sha.to_ascii_lowercase()
            {
                return Err(EmailApiError::Conflict.into());
            }
            files.push(DraftFile {
                source,
                name: upload.file_name,
                content_type: upload.content_type,
                content_id: upload
                    .content_id
                    .unwrap_or_else(|| format!("{}@attachments.macro.com", upload.id)),
                inline: upload.is_inline,
                size: bytes.len() as u64,
                sha256: format!("{:x}", Sha256::digest(&bytes)),
            });
        }
        for attachment in lease.attachments.forwarded.clone() {
            let source = AttachmentSource::Provider {
                db_id: attachment.id,
                link_id: attachment.link_id,
                generation: attachment.grant_generation,
                message_id: ProviderId::new(
                    attachment.provider_id.ok_or(EmailApiError::NotFound)?,
                )?,
                attachment_id: ProviderId::new(
                    attachment
                        .provider_attachment_id
                        .ok_or(EmailApiError::NotFound)?,
                )?,
            };
            let bytes = self.provider_bytes(lease, &source).await?;
            let inline = attachment.content_id.as_ref().is_some_and(|cid| {
                input.body_html.as_ref().is_some_and(|html| {
                    html.contains(&format!("cid:{}", cid.trim_matches(['<', '>'])))
                })
            });
            let content_id = if inline {
                attachment
                    .content_id
                    .unwrap_or_default()
                    .trim_matches(['<', '>'])
                    .to_owned()
            } else {
                format!("{}@attachments.macro.com", attachment.id)
            };
            files.push(DraftFile {
                source,
                name: attachment.filename.unwrap_or_else(|| "attachment".into()),
                content_type: attachment
                    .mime_type
                    .unwrap_or_else(|| "application/octet-stream".into()),
                content_id,
                inline,
                size: bytes.len() as u64,
                sha256: format!("{:x}", Sha256::digest(&bytes)),
            });
        }
        let removals = lease.attachments.removals.clone();
        Ok(PreparedDraft {
            reply_to,
            request,
            files,
            removals,
        })
    }

    async fn draft_file_bytes(
        &self,
        lease: &DraftLease,
        file: &DraftFile,
    ) -> Result<Vec<u8>, MailboxError> {
        self.provider_bytes(lease, &file.source).await
    }
}

fn contact(value: &crate::domain::models::ContactInfo) -> ContactInfo {
    ContactInfo {
        email: value.email.clone(),
        name: value.name.clone(),
        photo_url: value.photo_url.clone(),
    }
}

fn header(headers: Option<&serde_json::Value>, name: &str) -> Option<String> {
    headers?
        .as_array()?
        .iter()
        .find(|h| {
            h.get("name")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|n| n.eq_ignore_ascii_case(name))
        })?
        .get("value")?
        .as_str()
        .map(str::to_owned)
}
