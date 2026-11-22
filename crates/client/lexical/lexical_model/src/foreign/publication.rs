//! Read-only metadata notifications at real publication and rollback boundaries.
use crate::*;
use std::sync::Arc;

/// Observe native publication metadata without executing model, JavaScript or I/O work.
/// Implementations may retain receipts/identities, but must not reenter an editor.
/// A notification cannot undo publication; metadata failures must retain the real
/// receipt and report a fatal adapter status instead of inventing rollback.
pub trait ForeignPublicationObserver: Send + Sync + 'static {
    /// Called after actual state and commit identity publication, before the caller continues.
    /// Synthetic `Editor::noop_commit` does not notify this observer. Process only
    /// this receipt's own identity; preceding/following receipts notify separately.
    fn published(&self, commit: &Commit);
    /// The existing follow-up policy restored this state and revoked later publications.
    /// Retain raw evidence if needed, but never externally deliver revoked receipts.
    /// The cutoff is the editor publication-identity watermark at scope entry; it
    /// can name a previously revoked publication. Failed prepublication preparation
    /// may consume newer allocation IDs without changing this watermark.
    /// Apply revocations in notification order, scoped to the restored state's owner;
    /// never resurrect a receipt revoked by an earlier notification.
    fn rolled_back(&self, restored: &EditorState, cutoff: CommitId);
}

impl EditorBuilder {
    /// Install the metadata observer before initialization can publish native commits.
    pub fn foreign_publication_observer(
        mut self,
        observer: Arc<dyn ForeignPublicationObserver>,
    ) -> Self {
        self.foreign_publication_observer = Some(observer);
        self
    }
}

#[cfg(test)]
mod test;
