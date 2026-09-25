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

/// Which pipeline the editing worker runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditMode {
    /// Interpreter, supervisor, and parallel coders. Reviews its own work
    /// across rounds; the right choice for multi-part or structural edits.
    Supervised,
    /// One model, the whole document, straight to `runCode`. Seconds instead
    /// of tens of seconds, for a single contained edit.
    Fast,
}

/// What became of a request to place a comment mark.
#[cfg(feature = "ai_tools")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommentMarkPlacement {
    /// The mark now wraps the requested text.
    Placed {
        /// The text the mark covers, as the document reads.
        marked_text: String,
    },
    /// The text could not be anchored exactly, so the document was left
    /// untouched; the reason is written for the agent that asked.
    Refused(String),
}

/// Port for applying AI-driven edits to a document via the editing worker.
#[cfg_attr(test, mockall::automock)]
pub trait EditingWorkerService: Send + Sync + 'static {
    /// Run a deterministic spreadsheet operation with a scoped document token.
    #[cfg(feature = "ai_tools")]
    fn spreadsheet(
        &self,
        document_id: &str,
        document_token: &DocumentPermissionToken,
        request: &crate::domain::spreadsheet::SpreadsheetRequest,
    ) -> impl Future<Output = anyhow::Result<crate::domain::spreadsheet::SpreadsheetResponse>> + Send;

    /// Wrap the `occurrence`th (1-based) appearance of `text` in `document_id`
    /// in comment mark `mark_id`, merged into the live collaborative document.
    #[cfg(feature = "ai_tools")]
    fn add_comment_mark(
        &self,
        document_id: &str,
        document_token: &DocumentPermissionToken,
        mark_id: uuid::Uuid,
        text: &str,
        occurrence: Option<u32>,
    ) -> impl Future<Output = anyhow::Result<CommentMarkPlacement>> + Send;

    /// Take comment mark `mark_id` out of `document_id`, keeping its text.
    #[cfg(feature = "ai_tools")]
    fn remove_comment_mark(
        &self,
        document_id: &str,
        document_token: &DocumentPermissionToken,
        mark_id: uuid::Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Apply AI-driven edits to `document_id` using a pre-minted `document_token`.
    fn edit(
        &self,
        document_id: &str,
        document_token: &DocumentPermissionToken,
        instructions: &str,
        mode: EditMode,
    ) -> impl Future<Output = anyhow::Result<EditResult>> + Send;

    /// Delete all AI edit trace records for `document_id`. Called during
    /// document deletion so traces (which hold full document content) don't
    /// outlive the document.
    fn delete_traces(&self, document_id: &str) -> impl Future<Output = anyhow::Result<()>> + Send;
}
