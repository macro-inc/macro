//! Authorize source inboxes when registering and delivering forwarded attachments.

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{AttachmentForwarded, MessageAttachment};

/// A provider attachment together with the inbox whose credentials can read it.
#[derive(Debug, Clone)]
pub struct ForwardedAttachmentSource {
    /// The original message's inbox, which may differ from the sending inbox.
    pub source_link_id: Uuid,
    /// The registered original attachment and its provider identifiers.
    pub attachment: AttachmentForwarded,
}

/// Persistence facts needed to authorize and register forwarded attachments.
pub trait ForwardedAttachmentRepo: Send + Sync {
    /// Repository failures are preserved in the domain error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Return the caller's own and delegated inboxes.
    fn accessible_inboxes(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;
    /// Check that the destination is still a draft in the selected inbox.
    fn draft_exists(
        &self,
        link_id: Uuid,
        draft_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Resolve attachment metadata and its original inbox.
    fn source_attachment(
        &self,
        attachment_id: Uuid,
    ) -> impl Future<Output = Result<Option<(Uuid, MessageAttachment)>, Self::Err>> + Send;
    /// Idempotently register the original attachment on the destination draft.
    fn insert(
        &self,
        link_id: Uuid,
        draft_id: Uuid,
        attachment_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Read registrations scoped to the destination inbox, including source inboxes.
    fn registered_sources(
        &self,
        link_id: Uuid,
        draft_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ForwardedAttachmentSource>, Self::Err>> + Send;
}

/// Missing and inaccessible resources share the same public error.
#[derive(Debug, thiserror::Error)]
pub enum ForwardedAttachmentError {
    /// The destination draft is missing or inaccessible.
    #[error("Draft not found")]
    DraftNotFound,
    /// The source attachment is missing or inaccessible.
    #[error("Attachment not found")]
    AttachmentNotFound,
    /// A persistence operation failed.
    #[error("Internal error")]
    Internal(rootcause::Report),
}

/// Owns source access policy; adapters provide only persisted facts.
#[derive(Clone)]
pub struct ForwardedAttachmentService<R> {
    repo: R,
}

impl<R: ForwardedAttachmentRepo> ForwardedAttachmentService<R> {
    /// Construct with the email repository adapter.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    /// Register a source the authenticated caller can read on their selected draft.
    #[tracing::instrument(skip(self, actor), fields(source_link_id = tracing::field::Empty, source_accessible = tracing::field::Empty), err)]
    pub async fn add(
        &self,
        actor: &MacroUserIdStr<'_>,
        link_id: Uuid,
        draft_id: Uuid,
        attachment_id: Uuid,
    ) -> Result<MessageAttachment, ForwardedAttachmentError> {
        let inboxes = self
            .repo
            .accessible_inboxes(actor)
            .await
            .map_err(internal)?;
        if !inboxes.contains(&link_id)
            || !self
                .repo
                .draft_exists(link_id, draft_id)
                .await
                .map_err(internal)?
        {
            return Err(ForwardedAttachmentError::DraftNotFound);
        }
        let (source_link_id, attachment) = self
            .repo
            .source_attachment(attachment_id)
            .await
            .map_err(internal)?
            .ok_or(ForwardedAttachmentError::AttachmentNotFound)?;
        let accessible = inboxes.contains(&source_link_id);
        tracing::Span::current().record("source_link_id", tracing::field::display(source_link_id));
        tracing::Span::current().record("source_accessible", accessible);
        if !accessible {
            return Err(ForwardedAttachmentError::AttachmentNotFound);
        }
        self.repo
            .insert(link_id, draft_id, attachment_id)
            .await
            .map_err(internal)?;
        Ok(attachment)
    }

    /// Recheck cross-inbox sources at delivery, including after a scheduled delay.
    /// Legacy same-inbox sends predate actor attribution and remain deliverable.
    #[tracing::instrument(skip(self, actor), fields(source_accessible = tracing::field::Empty), err)]
    pub async fn for_delivery(
        &self,
        actor: Option<&MacroUserIdStr<'_>>,
        link_id: Uuid,
        draft_id: Uuid,
    ) -> Result<Vec<ForwardedAttachmentSource>, ForwardedAttachmentError> {
        let sources = self
            .repo
            .registered_sources(link_id, draft_id)
            .await
            .map_err(internal)?;
        if sources
            .iter()
            .all(|source| source.source_link_id == link_id)
        {
            return Ok(sources);
        }
        let actor = actor.ok_or(ForwardedAttachmentError::AttachmentNotFound)?;
        let inboxes = self
            .repo
            .accessible_inboxes(actor)
            .await
            .map_err(internal)?;
        let accessible = inboxes.contains(&link_id)
            && sources
                .iter()
                .all(|source| inboxes.contains(&source.source_link_id));
        tracing::Span::current().record("source_accessible", accessible);
        if !accessible {
            return Err(ForwardedAttachmentError::AttachmentNotFound);
        }
        Ok(sources)
    }
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> ForwardedAttachmentError {
    ForwardedAttachmentError::Internal(rootcause::Report::new(error).into())
}

#[cfg(test)]
mod test;
