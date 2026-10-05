//! Presentation (`.pptx`) workflows for AI tools: describing a deck as text
//! and applying edit operations as a new version of the document.
//!
//! The PPTX engine runs in-process; the stored file is read and written
//! through [`PresentationFiles`].

mod describe;

pub use describe::describe;

use anyhow::Context;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use pptx_engine::font::FontDb;
use pptx_engine::{EditOp, Presentation};
use schemars::JsonSchema;
use serde::Serialize;
use std::sync::Arc;

/// Most operations one edit may apply.
pub const MAX_OPERATIONS: usize = 100;

/// Reads and writes the stored file of a presentation document.
#[async_trait::async_trait]
pub trait PresentationFiles: Send + Sync + 'static {
    /// The latest stored bytes of the document.
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>>;
    /// Stores `bytes` as the document's newest version.
    async fn write(&self, document_id: &str, bytes: Vec<u8>) -> anyhow::Result<()>;
}

/// Used where no file store is wired: every call fails with a clear message.
pub struct NoPresentationFiles;

#[async_trait::async_trait]
impl PresentationFiles for NoPresentationFiles {
    async fn read(&self, _document_id: &str) -> anyhow::Result<Vec<u8>> {
        anyhow::bail!("presentations cannot be opened from this host")
    }

    async fn write(&self, _document_id: &str, _bytes: Vec<u8>) -> anyhow::Result<()> {
        anyhow::bail!("presentations cannot be edited from this host")
    }
}

/// A slide or shape an edit created.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedItem {
    /// Slide id.
    pub slide: u32,
    /// Shape id, for created shapes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<u32>,
    /// Section id, for created sections.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
}

/// What an edit did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PresentationEditOutcome {
    /// The edited document (clients reload open editors of it).
    pub document_id: String,
    /// Slides and shapes the operations created, in order.
    pub created: Vec<CreatedItem>,
    /// Whether slides were added, removed, or reordered, or the slide size
    /// or sections changed.
    pub structure_changed: bool,
    /// The changed slides as they now read (after a structure change, the
    /// deck summary and sections too).
    pub changed_slides: String,
}

/// Errors the caller can act on (as opposed to infrastructure failures).
#[derive(Debug, thiserror::Error)]
pub enum PresentationError {
    /// The file is not a readable presentation.
    #[error("the document is not a readable PowerPoint file: {0}")]
    Unreadable(String),
    /// An operation was rejected; nothing was saved.
    #[error("{0} (no changes were saved)")]
    Rejected(String),
    /// Too many or too few operations.
    #[error("send between 1 and {MAX_OPERATIONS} operations")]
    BatchSize,
}

/// Reads and edits presentations after the caller obtained an access receipt.
pub struct PresentationService {
    files: Arc<dyn PresentationFiles>,
}

impl PresentationService {
    /// Compose the service over a file store.
    pub fn new(files: Arc<dyn PresentationFiles>) -> Self {
        Self { files }
    }

    /// Describes the deck (or the given 1-based slides) as text.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        slides: Option<&[usize]>,
    ) -> anyhow::Result<String> {
        let bytes = self
            .files
            .read(&receipt.entity().entity_id)
            .await
            .context("reading the presentation file")?;
        let slides = slides.map(<[usize]>::to_vec);
        // Parsing and describing a large deck is CPU work.
        tokio::task::spawn_blocking(move || describe(&mut open(bytes)?, slides.as_deref()))
            .await
            .context("describing the presentation")?
    }

    /// Applies `ops` atomically and saves the result as a new version.
    pub async fn edit(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        ops: &[EditOp],
    ) -> anyhow::Result<PresentationEditOutcome> {
        if ops.is_empty() || ops.len() > MAX_OPERATIONS {
            return Err(PresentationError::BatchSize.into());
        }
        let document_id = receipt.entity().entity_id.clone();
        let bytes = self
            .files
            .read(&document_id)
            .await
            .context("reading the presentation file")?;
        let ops = ops.to_vec();
        let id = document_id.clone();
        let (saved, outcome) = tokio::task::spawn_blocking(move || apply(id, bytes, &ops))
            .await
            .context("editing the presentation")??;
        // The write runs to completion even if this request is dropped, so a
        // version is never recorded without its file.
        let files = self.files.clone();
        tokio::spawn(async move { files.write(&document_id, saved).await })
            .await
            .context("saving the presentation")?
            .context("saving the presentation")?;
        Ok(outcome)
    }

    /// Applies `ops` (possibly none) to a copy of the deck and returns the
    /// copy's bytes; the original is left as it is. The outcome names
    /// `document_id`, the document the caller stores the copy as.
    pub async fn edited_copy(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        ops: &[EditOp],
    ) -> anyhow::Result<(Vec<u8>, PresentationEditOutcome)> {
        if ops.len() > MAX_OPERATIONS {
            return Err(PresentationError::BatchSize.into());
        }
        let bytes = self
            .files
            .read(&receipt.entity().entity_id)
            .await
            .context("reading the presentation file")?;
        if ops.is_empty() {
            // A plain copy: keep the original bytes exactly.
            open(bytes.clone())?;
            return Ok((
                bytes,
                PresentationEditOutcome {
                    document_id: String::new(),
                    created: Vec::new(),
                    structure_changed: false,
                    changed_slides: String::new(),
                },
            ));
        }
        let ops = ops.to_vec();
        tokio::task::spawn_blocking(move || apply(String::new(), bytes, &ops))
            .await
            .context("editing the presentation")?
    }
}

fn open(bytes: Vec<u8>) -> anyhow::Result<Presentation> {
    Presentation::open(bytes).map_err(|e| PresentationError::Unreadable(e.to_string()).into())
}

/// Applies a batch to a deck; returns the new file and what changed.
fn apply(
    document_id: String,
    bytes: Vec<u8>,
    ops: &[EditOp],
) -> anyhow::Result<(Vec<u8>, PresentationEditOutcome)> {
    let mut pres = open(bytes)?;
    let result = pres
        .apply(ops, embedded_fonts())
        .map_err(|e| PresentationError::Rejected(e.to_string()))?;
    let saved = pres.save().context("serializing the presentation")?;
    let numbers: Vec<usize> = result
        .changed_slides
        .iter()
        .filter_map(|id| {
            pres.slides()
                .iter()
                .position(|s| s.id == *id)
                .map(|i| i + 1)
        })
        .collect();
    // A structure change (deleted slides, sections, slide size) shows in the
    // deck summary even when no remaining slide changed.
    let changed_slides = if numbers.is_empty() && !result.structure_changed {
        String::new()
    } else {
        describe(&mut pres, Some(&numbers))?
    };
    let outcome = PresentationEditOutcome {
        document_id,
        created: result
            .created
            .iter()
            .map(|c| CreatedItem {
                slide: c.slide,
                shape: c.shape,
                section: c.section.clone(),
            })
            .collect(),
        structure_changed: result.structure_changed,
        changed_slides,
    };
    Ok((saved, outcome))
}

/// The engine's bundled, metric-compatible fonts (for text fitting).
fn embedded_fonts() -> &'static FontDb {
    FontDb::global()
}

#[cfg(test)]
mod test;
