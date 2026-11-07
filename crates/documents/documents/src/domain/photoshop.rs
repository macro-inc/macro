//! Photoshop document (`.psd`, `.psb`) workflows for AI tools: describing a
//! document as text.
//!
//! The Photoshop engine runs in-process; the stored file is read through
//! [`PhotoshopFiles`]. Tools read documents but do not write them.

use anyhow::Context;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use psd_engine::PsdError;
use psd_engine::document::{self, OpenOptions};
use std::fmt::Write as _;
use std::sync::Arc;

/// Largest stored document the tools open (decoding holds it in memory).
pub const MAX_PHOTOSHOP_BYTES: usize = 300 * 1024 * 1024;

/// Bytes of decoded pixels (layers, masks, and the merged image as RGBA) a
/// document may take: opening a document decodes every layer.
pub const PHOTOSHOP_PIXEL_BUDGET: u64 = 512 * 1024 * 1024;

/// Roughly the longest description returned.
const MAX_CHARS: usize = 60_000;

/// Reads the stored file of a Photoshop document.
#[async_trait::async_trait]
pub trait PhotoshopFiles: Send + Sync + 'static {
    /// The latest stored bytes of the document.
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>>;
}

/// Used where no file store is wired: every call fails with a clear message.
pub struct NoPhotoshopFiles;

#[async_trait::async_trait]
impl PhotoshopFiles for NoPhotoshopFiles {
    async fn read(&self, _document_id: &str) -> anyhow::Result<Vec<u8>> {
        anyhow::bail!("Photoshop documents cannot be opened from this host")
    }
}

/// Errors the caller can act on (as opposed to infrastructure failures).
#[derive(Debug, thiserror::Error)]
pub enum PhotoshopError {
    /// The file is not a readable Photoshop document.
    #[error("the document is not a readable Photoshop (.psd or .psb) file: {0}")]
    Unreadable(String),
    /// The file is larger than the tools open.
    #[error("the document is too large to read here ({0} MB)")]
    TooLarge(usize),
    /// The document's layers decode to more pixels than the tools hold.
    #[error("the document is too large to read here ({0} MB of pixels)")]
    TooManyPixels(u64),
}

/// Reads Photoshop documents after the caller obtained an access receipt.
pub struct PhotoshopService {
    files: Arc<dyn PhotoshopFiles>,
}

impl PhotoshopService {
    /// Compose the service over a file store.
    pub fn new(files: Arc<dyn PhotoshopFiles>) -> Self {
        Self { files }
    }

    /// Describes the document as text: the canvas, the layer tree from top
    /// to bottom, and the text of text layers.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> anyhow::Result<String> {
        let bytes = self
            .files
            .read(&receipt.entity().entity_id)
            .await
            .context("reading the Photoshop file")?;
        if bytes.len() > MAX_PHOTOSHOP_BYTES {
            return Err(PhotoshopError::TooLarge(bytes.len() / (1024 * 1024)).into());
        }
        // Decoding the layers is CPU work.
        tokio::task::spawn_blocking(move || describe(&bytes))
            .await
            .context("describing the Photoshop document")?
    }
}

/// Opens `bytes` and describes the document for a model to read.
fn describe(bytes: &[u8]) -> anyhow::Result<String> {
    let opened = document::open(
        bytes,
        OpenOptions {
            pixel_budget: PHOTOSHOP_PIXEL_BUDGET,
        },
    )
    .map_err(|e| match e {
        PsdError::TooLarge(megabytes) => PhotoshopError::TooManyPixels(megabytes),
        e => PhotoshopError::Unreadable(e.to_string()),
    })?;
    let mut out = psd_engine::describe::outline(&opened.document, MAX_CHARS);
    let undecoded = opened.warnings.len();
    if undecoded > 0 {
        let _ = writeln!(
            out,
            "\n({undecoded} part{} of the file could not be decoded, so some layers may be described incompletely.)",
            if undecoded == 1 { "" } else { "s" }
        );
    }
    Ok(out)
}

#[cfg(test)]
mod test;
