//! Figma design (`.fig`) workflows for AI tools: describing a design as
//! text.
//!
//! The `.fig` engine runs in-process; the stored file is read through
//! [`DesignFiles`]. Designs are edited live by the people who have them
//! open (the stored file is only the base the shared session starts from),
//! so tools read designs but do not write them.

mod describe;

pub use describe::describe;

use anyhow::Context;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use std::sync::Arc;

/// Largest stored design the tools open (decoding holds it in memory).
pub const MAX_DESIGN_BYTES: usize = 300 * 1024 * 1024;

/// Reads the stored file of a design document.
#[async_trait::async_trait]
pub trait DesignFiles: Send + Sync + 'static {
    /// The latest stored bytes of the document.
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>>;
}

/// Used where no file store is wired: every call fails with a clear message.
pub struct NoDesignFiles;

#[async_trait::async_trait]
impl DesignFiles for NoDesignFiles {
    async fn read(&self, _document_id: &str) -> anyhow::Result<Vec<u8>> {
        anyhow::bail!("designs cannot be opened from this host")
    }
}

/// Errors the caller can act on (as opposed to infrastructure failures).
#[derive(Debug, thiserror::Error)]
pub enum DesignError {
    /// The file is not a readable design.
    #[error("the document is not a readable Figma (.fig) file: {0}")]
    Unreadable(String),
    /// The file is larger than the tools open.
    #[error("the design is too large to read here ({0} MB)")]
    TooLarge(usize),
}

/// Reads designs after the caller obtained an access receipt.
pub struct DesignService {
    files: Arc<dyn DesignFiles>,
}

impl DesignService {
    /// Compose the service over a file store.
    pub fn new(files: Arc<dyn DesignFiles>) -> Self {
        Self { files }
    }

    /// Describes the design (or the given 1-based pages) as text.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        pages: Option<&[usize]>,
    ) -> anyhow::Result<String> {
        let bytes = self
            .files
            .read(&receipt.entity().entity_id)
            .await
            .context("reading the design file")?;
        if bytes.len() > MAX_DESIGN_BYTES {
            return Err(DesignError::TooLarge(bytes.len() / (1024 * 1024)).into());
        }
        let pages = pages.map(<[usize]>::to_vec);
        // Decoding and expanding a large design is CPU work.
        tokio::task::spawn_blocking(move || {
            let doc = fig_engine::Document::open(&bytes)
                .map_err(|e| DesignError::Unreadable(e.to_string()))?;
            Ok(describe(&doc, pages))
        })
        .await
        .context("describing the design")?
    }
}

#[cfg(test)]
mod test;
