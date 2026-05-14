//! Port definitions for markdown document initialization.

use std::future::Future;

use crate::domain::models::DocumentError;

/// Initializes markdown document content in the collaborative editor backend.
pub trait MarkdownInitializationPort: Send + Sync {
    /// Initialize an already-created markdown document from markdown text.
    fn initialize_existing_markdown(
        &self,
        document_id: &str,
        markdown: &str,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}
