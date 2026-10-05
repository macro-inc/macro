//! Illustrator document (`.ai`) workflows for AI tools: describing a
//! document as text.
//!
//! The Illustrator engine runs in-process; the stored file is read through
//! [`IllustratorFiles`]. Tools read documents but do not write them.

use anyhow::Context;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use std::sync::Arc;

/// Largest stored document the tools open (reading holds it in memory).
pub const MAX_ILLUSTRATOR_BYTES: usize = 300 * 1024 * 1024;

/// Roughly the longest description returned.
const MAX_CHARS: usize = 60_000;

/// Reads the stored file of an Illustrator document.
#[async_trait::async_trait]
pub trait IllustratorFiles: Send + Sync + 'static {
    /// The latest stored bytes of the document.
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>>;
}

/// Used where no file store is wired: every call fails with a clear message.
pub struct NoIllustratorFiles;

#[async_trait::async_trait]
impl IllustratorFiles for NoIllustratorFiles {
    async fn read(&self, _document_id: &str) -> anyhow::Result<Vec<u8>> {
        anyhow::bail!("Illustrator documents cannot be opened from this host")
    }
}

/// Errors the caller can act on (as opposed to infrastructure failures).
#[derive(Debug, thiserror::Error)]
pub enum IllustratorError {
    /// The file is not a readable Illustrator document: not PDF-based (as
    /// files from Illustrator 8 and earlier are not), encrypted, or damaged.
    #[error("the document is not a readable Illustrator (.ai) file: {0}")]
    Unreadable(String),
    /// The file is larger than the tools open.
    #[error("the document is too large to read here ({0} MB)")]
    TooLarge(usize),
}

/// Reads Illustrator documents after the caller obtained an access receipt.
pub struct IllustratorService {
    files: Arc<dyn IllustratorFiles>,
}

impl IllustratorService {
    /// Compose the service over a file store.
    pub fn new(files: Arc<dyn IllustratorFiles>) -> Self {
        Self { files }
    }

    /// Describes the document as text: the artboards, the layer tree from
    /// top to bottom, and the text of text objects.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> anyhow::Result<String> {
        let bytes = self
            .files
            .read(&receipt.entity().entity_id)
            .await
            .context("reading the Illustrator file")?;
        if bytes.len() > MAX_ILLUSTRATOR_BYTES {
            return Err(IllustratorError::TooLarge(bytes.len() / (1024 * 1024)).into());
        }
        // Reading the artwork is CPU work.
        tokio::task::spawn_blocking(move || describe(&bytes))
            .await
            .context("describing the Illustrator document")?
    }
}

/// Opens `bytes` and describes the document for a model to read.
fn describe(bytes: &[u8]) -> anyhow::Result<String> {
    let opened =
        ai_engine::build::open(bytes).map_err(|e| IllustratorError::Unreadable(e.to_string()))?;
    Ok(ai_engine::describe::outline(&opened.document, MAX_CHARS))
}

#[cfg(test)]
mod test;
