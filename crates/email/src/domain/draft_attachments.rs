//! Draft attachment authorization, validation and revision policy.

use super::{
    models::{AttachmentDraft, UserProvider},
    ports::EmailUserRepo,
};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use std::future::Future;
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Debug, thiserror::Error)]
pub enum AttachmentError {
    #[error("Attachment or draft not found")]
    NotFound,
    #[error("You do not have access to this attachment or inbox")]
    Forbidden,
    #[error("Cancel delivery before changing attachments")]
    DeliveryConflict,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("Attachment storage is temporarily unavailable")]
    Infrastructure,
    #[error("Reconnect the source inbox to download this attachment")]
    Reauthorization,
    #[error("The email provider is busy; try again shortly")]
    RateLimited,
}

#[derive(Debug, Clone)]
pub struct AttachmentReference {
    pub reference_url: Option<String>,
    pub id: Uuid,
    pub link_id: Uuid,
    pub thread_id: Uuid,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
}

#[derive(Debug, Clone, Copy)]
pub enum RemovalKind {
    UploadedOrNative,
    Forwarded,
}

pub enum AttachmentChange {
    Upload(AttachmentDraft),
    /// Mark an existing immutable upload reservation complete after verification.
    CompleteUpload(AttachmentDraft),
    Forward(AttachmentReference),
    Remove {
        attachment_id: Uuid,
        kind: RemovalKind,
    },
}

/// Facts reloaded under the same lock as a draft edit or send claim.
pub struct AttachmentEditFacts {
    pub authorized: bool,
    pub editable: bool,
    pub scheduled: bool,
    pub provider: UserProvider,
    pub total_bytes: u64,
}

pub fn validate_attachment_edit(
    facts: &AttachmentEditFacts,
    added_bytes: u64,
) -> Result<(), AttachmentError> {
    if !facts.authorized {
        return Err(AttachmentError::Forbidden);
    }
    if !facts.editable {
        return Err(AttachmentError::NotFound);
    }
    if facts.scheduled {
        return Err(AttachmentError::DeliveryConflict);
    }
    let maximum = match facts.provider {
        UserProvider::Gmail => 18_000_000,
        UserProvider::Outlook => 150_000_000,
    };
    if added_bytes > 0 && facts.total_bytes.saturating_add(added_bytes) > maximum {
        return Err(AttachmentError::Invalid(
            "Combined attachment size exceeds this provider's upload limit",
        ));
    }
    Ok(())
}

pub fn validate_upload(file_name: &str, sha: &str, size: i32) -> Result<(), AttachmentError> {
    if file_name.trim().is_empty()
        || file_name.len() > 255
        || file_name.chars().any(char::is_control)
    {
        return Err(AttachmentError::Invalid(
            "File name must contain 1–255 bytes and no control characters",
        ));
    }
    if sha.len() != 64 || !sha.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(AttachmentError::Invalid("SHA256 must be 64 hex characters"));
    }
    if size <= 0 {
        return Err(AttachmentError::Invalid(
            "File size must be greater than zero",
        ));
    }
    Ok(())
}

pub trait DraftAttachmentRepository: EmailUserRepo {
    fn draft_upload(
        &self,
        link: Uuid,
        draft: Uuid,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<AttachmentDraft>, AttachmentError>> + Send;
    fn attachment_reference(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<AttachmentReference>, AttachmentError>> + Send;
    /// Rechecks draft ownership, send state and size under the message lock,
    /// then commits the attachment change and draft revision together.
    fn commit_attachment_change(
        &self,
        actor: &str,
        link: Uuid,
        draft: Uuid,
        change: AttachmentChange,
    ) -> impl Future<Output = Result<(), AttachmentError>> + Send;
}

pub trait DraftAttachmentStorage: Send + Sync + 'static {
    fn content_type(&self, filename: &str) -> String;
    fn upload_url(
        &self,
        attachment: &AttachmentDraft,
    ) -> impl Future<Output = Result<String, AttachmentError>> + Send;
    /// Confirms storage accepted exactly the reserved bytes and checksum.
    fn verify_upload(
        &self,
        attachment: &AttachmentDraft,
    ) -> impl Future<Output = Result<(), AttachmentError>> + Send;
}

/// File metadata and optional idempotency key for a draft attachment upload.
pub struct DraftAttachmentUpload {
    /// Original file name used to determine the content type.
    pub file_name: String,
    /// Hex-encoded SHA256 checksum of the file.
    pub sha: String,
    /// File size in bytes.
    pub size: i32,
    /// Stable client upload identifier, when supplied.
    pub upload_id: Option<Uuid>,
}

pub struct DraftAttachmentService<R, S, A> {
    pub repository: R,
    pub storage: S,
    pub access: A,
}

impl<R: DraftAttachmentRepository, S: DraftAttachmentStorage, A: EntityAccessService>
    DraftAttachmentService<R, S, A>
{
    async fn inbox(
        &self,
        actor: &MacroUserIdStr<'static>,
        link: Uuid,
    ) -> Result<UserProvider, AttachmentError> {
        let links = self
            .repository
            .user_accessible_inboxes(actor.clone())
            .await
            .map_err(|_| AttachmentError::Infrastructure)?;
        links
            .into_iter()
            .find(|item| item.id == link)
            .map(|item| item.provider)
            .ok_or(AttachmentError::Forbidden)
    }

    pub async fn upload(
        &self,
        actor: &MacroUserIdStr<'static>,
        link: Uuid,
        draft: Uuid,
        upload: DraftAttachmentUpload,
    ) -> Result<(AttachmentDraft, String), AttachmentError> {
        let DraftAttachmentUpload {
            file_name,
            sha,
            size,
            upload_id,
        } = upload;
        validate_upload(&file_name, &sha, size)?;
        let provider = self.inbox(actor, link).await?;
        // Existing Gmail clients predate upload completion. Outlook and every
        // client supplying an idempotency key use the verified upload protocol.
        let upload_pending = upload_id.is_some() || provider == UserProvider::Outlook;
        let id = upload_id.unwrap_or_else(macro_uuid::generate_uuid_v7);
        let attachment = AttachmentDraft {
            id,
            draft_id: draft,
            content_type: self.storage.content_type(&file_name),
            file_name,
            sha: sha.to_ascii_lowercase(),
            size,
            s3_key: format!("draft/{draft}/{id}"),
            upload_pending,
            content_id: None,
            is_inline: false,
        };
        self.repository
            .commit_attachment_change(
                actor.as_ref(),
                link,
                draft,
                AttachmentChange::Upload(attachment.clone()),
            )
            .await?;
        let url = self.storage.upload_url(&attachment).await?;
        Ok((attachment, url))
    }

    pub async fn complete_upload(
        &self,
        actor: &MacroUserIdStr<'static>,
        link: Uuid,
        draft: Uuid,
        id: Uuid,
    ) -> Result<(), AttachmentError> {
        self.inbox(actor, link).await?;
        let attachment = self
            .repository
            .draft_upload(link, draft, id)
            .await?
            .ok_or(AttachmentError::NotFound)?;
        self.storage.verify_upload(&attachment).await?;
        self.repository
            .commit_attachment_change(
                actor.as_ref(),
                link,
                draft,
                AttachmentChange::CompleteUpload(attachment),
            )
            .await
    }

    pub async fn forward(
        &self,
        actor: &MacroUserIdStr<'static>,
        link: Uuid,
        draft: Uuid,
        id: Uuid,
    ) -> Result<AttachmentReference, AttachmentError> {
        self.inbox(actor, link).await?;
        let source = self
            .repository
            .attachment_reference(id)
            .await?
            .ok_or(AttachmentError::NotFound)?;
        let links = self
            .repository
            .user_accessible_inboxes(actor.clone())
            .await
            .map_err(|_| AttachmentError::Infrastructure)?;
        if !links.iter().any(|item| item.id == source.link_id) {
            self.access
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    actor,
                    None,
                    &source.thread_id.to_string(),
                    EntityType::EmailThread,
                )
                .await
                .map_err(|_| AttachmentError::Forbidden)?;
        }
        if source.reference_url.is_some() {
            return Err(AttachmentError::Invalid(
                "Share linked attachments from Outlook",
            ));
        }
        self.repository
            .commit_attachment_change(
                actor.as_ref(),
                link,
                draft,
                AttachmentChange::Forward(source.clone()),
            )
            .await?;
        Ok(source)
    }

    pub async fn remove(
        &self,
        actor: &MacroUserIdStr<'static>,
        link: Uuid,
        draft: Uuid,
        attachment_id: Uuid,
        kind: RemovalKind,
    ) -> Result<(), AttachmentError> {
        self.inbox(actor, link).await?;
        self.repository
            .commit_attachment_change(
                actor.as_ref(),
                link,
                draft,
                AttachmentChange::Remove {
                    attachment_id,
                    kind,
                },
            )
            .await
    }
}
