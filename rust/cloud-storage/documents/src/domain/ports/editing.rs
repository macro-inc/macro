//! Port definition for the AI editing worker.

use macro_sync_service_jwt::DocumentPermissionToken;
use std::future::Future;

/// Result returned by a successful edit operation.
pub struct EditResult {
    /// Number of individual edit operations applied to the document.
    pub edits_applied: usize,
    /// Per-model token usage reported by the editing worker (the worker runs
    /// several models, supervisor, interpret, coder; this is one entry each).
    pub usage: Vec<EditUsage>,
    /// If set, the worker needs more information. Invoke again with the
    /// requested details appended to the instructions.
    pub clarification: Option<String>,
}

/// Token usage for one model used by the editing worker.
pub struct EditUsage {
    /// The model api id (e.g. `claude-haiku-4-5-xxxx`).
    pub model: String,
    /// Input tokens consumed.
    pub input_tokens: u32,
    /// Output tokens produced.
    pub output_tokens: u32,
}

/// Port for applying AI-driven edits to a document via the editing worker.
#[cfg_attr(test, mockall::automock)]
pub trait EditingWorkerService: Send + Sync + 'static {
    /// Apply AI-driven edits to `document_id` using a pre-minted `document_token`.
    fn edit(
        &self,
        document_id: &str,
        document_token: &DocumentPermissionToken,
        instructions: &str,
    ) -> impl Future<Output = anyhow::Result<EditResult>> + Send;

    /// Delete all AI edit trace records for `document_id`. Called during
    /// document deletion so traces (which hold full document content) don't
    /// outlive the document.
    fn delete_traces(&self, document_id: &str) -> impl Future<Output = anyhow::Result<()>> + Send;
}
