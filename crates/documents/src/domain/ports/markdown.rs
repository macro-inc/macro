//! Port definitions for markdown document initialization.

use std::future::Future;

use crate::domain::models::DocumentError;
use crate::domain::notion_markdown::NotionMarkdown;

/// A new document's Loro snapshot and its content as Macro markdown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownSnapshot {
    /// The Loro snapshot.
    pub snapshot: Vec<u8>,
    /// The same content as Macro markdown.
    pub markdown: String,
}

/// Initializes markdown document content in the collaborative editor backend.
pub trait MarkdownInitializationPort: Send + Sync {
    /// Initialize an already-created markdown document and return the canonical snapshot.
    fn initialize_existing_markdown(
        &self,
        document_id: &str,
        markdown: &str,
    ) -> impl Future<Output = Result<Vec<u8>, DocumentError>> + Send;

    /// Initialize an already-created markdown document from a Notion page
    /// and return its snapshot with the Macro markdown it holds.
    fn initialize_existing_notion(
        &self,
        document_id: &str,
        notion: &NotionMarkdown,
    ) -> impl Future<Output = Result<MarkdownSnapshot, DocumentError>> + Send;
}

/// Utilities from the lexical service
#[cfg_attr(test, mockall::automock)]
pub trait LexicalSnapshotPort: Send + Sync + 'static {
    /// Convert markdown to loro via lexical using lexical service
    fn markdown_to_loro_snapshot(
        &self,
        markdown: &str,
    ) -> impl Future<Output = anyhow::Result<Vec<u8>>> + Send;

    /// Convert a Notion page to loro via lexical using lexical service
    fn notion_to_loro_snapshot(
        &self,
        notion: &NotionMarkdown,
    ) -> impl Future<Output = anyhow::Result<MarkdownSnapshot>> + Send;
}

/// Utilities for the worker/do
#[cfg_attr(test, mockall::automock)]
pub trait SyncInitializeSnapshotPort: Send + Sync + 'static {
    /// "Boot" a durable object from a loro snapshot via the worker/do
    fn initialize_from_snapshot(
        &self,
        document_id: &str,
        snapshot: &[u8],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
