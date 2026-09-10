//! Port definitions for tracking the mentions embedded in document content.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;

/// Records the entity mentions embedded in a document's markdown, so a
/// mentioned entity can surface the mentioning document in its references.
pub trait DocumentMentionTrackingPort: Send + Sync {
    /// Record every mention embedded in `markdown` as a reference owned by
    /// `document_id`, attributed to `user_id`.
    fn track_document_mentions(
        &self,
        document_id: &str,
        user_id: &MacroUserIdStr<'static>,
        markdown: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Mention tracker that records nothing, for callers without a MacroDB pool.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpDocumentMentionTracker;

impl DocumentMentionTrackingPort for NoOpDocumentMentionTracker {
    async fn track_document_mentions(
        &self,
        _document_id: &str,
        _user_id: &MacroUserIdStr<'static>,
        _markdown: &str,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}
