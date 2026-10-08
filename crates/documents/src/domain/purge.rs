//! Internal permanent cleanup for documents: owned description documents,
//! failed creations, and the documents of an owner being removed.

use super::{
    events::{DocumentMacroEvent, DocumentPurgedMetadata},
    models::DocumentError,
};
use macro_event_broker::MacroEventBroker;
use model_owner::Owner;
use rootcause::{Report, prelude::*};
use shared_entity_registry::{OwnedPurgeOutcome, PurgeOwnedEntity};
use std::future::Future;

/// Owning document cleanup; callers must obtain the ID from their own lifecycle state.
pub trait DocumentPurgeService: Send + Sync + 'static {
    /// Permanently delete document metadata and schedule removal of stored
    /// content. A document that is already gone is not an error.
    fn purge(
        &self,
        document_id: uuid::Uuid,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}

/// What a purge reads from a document while its rows still exist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurgeTarget {
    /// The recorded owner. Stored content is keyed by it.
    pub owner: Owner,
    /// The stored file type, such as `docx`.
    pub file_type: Option<String>,
}

/// What a row delete removed that other stores still hold.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PurgedRows {
    /// The SHA of each stored docx part the rows referenced, one entry per
    /// reference. Empty for every other file type.
    pub docx_part_shas: Vec<String>,
}

/// Permanent document persistence cleanup.
pub trait DocumentPurgeRepository: Send + Sync + 'static {
    /// The document, live or trashed. `None` if it does not exist.
    fn find(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<Option<PurgeTarget>, DocumentError>> + Send;

    /// Delete the document's rows, its access rows, and its registry row, and
    /// report what those rows referenced elsewhere. A document that is already
    /// gone is not an error.
    fn purge_rows(
        &self,
        document_id: &str,
        target: &PurgeTarget,
    ) -> impl Future<Output = Result<PurgedRows, DocumentError>> + Send;
}

/// Existing background content-deletion queue.
pub trait DocumentPurgeQueue: Send + Sync + 'static {
    /// Schedule content cleanup for a document whose rows still exist. Given
    /// the owner, the worker leaves the rows to this purge.
    fn enqueue(
        &self,
        document_id: String,
        owner: Owner,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}

/// Reference counts of stored docx parts, which documents share by SHA.
pub trait DocxPartReferences: Send + Sync + 'static {
    /// Drop one reference per entry in `shas`. A part left without references
    /// is collected.
    fn release(&self, shas: Vec<String>) -> impl Future<Output = Result<(), DocumentError>> + Send;
}

/// Shared lifecycle orchestration for permanent document cleanup.
pub struct DocumentPurger<R, Q, S, B> {
    repository: R,
    queue: Q,
    part_references: S,
    broker: B,
}

impl<R, Q, S, B> DocumentPurger<R, Q, S, B> {
    /// Compose persistence, cleanup delivery, docx part references and the
    /// shared event broker.
    pub fn new(repository: R, queue: Q, part_references: S, broker: B) -> Self {
        Self {
            repository,
            queue,
            part_references,
            broker,
        }
    }
}

impl<R, Q, S, B> DocumentPurger<R, Q, S, B>
where
    R: DocumentPurgeRepository,
    Q: DocumentPurgeQueue,
    S: DocxPartReferences,
    B: MacroEventBroker + 'static,
{
    /// Every failure before the row delete leaves the document findable, so
    /// the caller can retry the whole purge. Part references are released
    /// from what the row delete reports, so a retry cannot release them twice.
    async fn purge_found(
        &self,
        document_id: String,
        target: PurgeTarget,
    ) -> Result<(), DocumentError> {
        self.queue
            .enqueue(document_id.clone(), target.owner.clone())
            .await?;
        let event = DocumentMacroEvent::purged(
            document_id.clone(),
            DocumentPurgedMetadata {
                document_id: document_id.clone(),
            },
        );
        self.broker
            .send_event(&event)
            .map_err(|error| DocumentError::Internal(error.into()))?
            .await
            .map_err(|error| DocumentError::Internal(error.into()))?
            .map_err(|error| DocumentError::Internal(error.into()))?;
        let purged = self.repository.purge_rows(&document_id, &target).await?;
        if !purged.docx_part_shas.is_empty()
            && let Err(error) = self.part_references.release(purged.docx_part_shas).await
        {
            tracing::error!(?error, %document_id, "unable to release docx part references");
        }
        Ok(())
    }
}

impl<R, Q, S, B> DocumentPurgeService for DocumentPurger<R, Q, S, B>
where
    R: DocumentPurgeRepository,
    Q: DocumentPurgeQueue,
    S: DocxPartReferences,
    B: MacroEventBroker + 'static,
{
    #[tracing::instrument(skip(self), err)]
    async fn purge(&self, document_id: uuid::Uuid) -> Result<(), DocumentError> {
        let document_id = document_id.to_string();
        match self.repository.find(&document_id).await? {
            Some(target) => self.purge_found(document_id, target).await,
            None => Ok(()),
        }
    }
}

impl<R, Q, S, B> PurgeOwnedEntity for DocumentPurger<R, Q, S, B>
where
    R: DocumentPurgeRepository,
    Q: DocumentPurgeQueue,
    S: DocxPartReferences,
    B: MacroEventBroker + 'static,
{
    #[tracing::instrument(
        skip(self, expected_owner),
        fields(expected_owner.kind = ?expected_owner.owner_type()),
        err
    )]
    async fn purge_owned(
        &self,
        entity_id: uuid::Uuid,
        expected_owner: &Owner,
    ) -> Result<OwnedPurgeOutcome, Report> {
        let document_id = entity_id.to_string();
        let Some(target) = self
            .repository
            .find(&document_id)
            .await
            .context("unable to look up the document")?
        else {
            return Ok(OwnedPurgeOutcome::Purged);
        };
        if target.owner != *expected_owner {
            return Ok(OwnedPurgeOutcome::OwnedElsewhere);
        }
        self.purge_found(document_id, target)
            .await
            .context("unable to purge the document")?;
        Ok(OwnedPurgeOutcome::Purged)
    }
}

#[cfg(test)]
mod test;
