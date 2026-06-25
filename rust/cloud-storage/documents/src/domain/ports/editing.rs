//! Port definition for the AI editing worker.

use std::future::Future;

/// Result returned by a successful edit operation.
pub struct EditResult {
    /// Number of individual edit operations applied to the document.
    pub edits_applied: usize,
    /// Token usage reported by the editing worker, if available.
    pub usage: Option<EditUsage>,
    /// If set, the worker needs more information. Invoke again with the
    /// requested details appended to the instructions.
    pub clarification: Option<String>,
}

/// Token usage reported by the editing worker.
pub struct EditUsage {
    /// Input tokens consumed.
    pub input_tokens: u32,
    /// Output tokens produced.
    pub output_tokens: u32,
}

/// Port for applying AI-driven edits to a document via the editing worker.
#[cfg_attr(test, mockall::automock)]
pub trait EditingWorkerService: Send + Sync + 'static {
    /// Apply AI-driven edits to `document_id` using `user_token` (the caller's
    /// Bearer token) for auth. The worker exchanges it for a document-scoped JWT.
    fn edit(
        &self,
        document_id: &str,
        user_token: &str,
        instructions: &str,
    ) -> impl Future<Output = anyhow::Result<EditResult>> + Send;
}
