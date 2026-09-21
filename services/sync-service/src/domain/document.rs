//! Content-agnostic document snapshots and atomic CRDT updates.
//!
//! This module has no HTTP or storage dependencies. The durable-object adapter
//! supplies verified JWT claims and persists accepted updates through its oplog.
use std::borrow::Cow;

use loro::{ExportMode, LoroDoc, VersionVector};

pub const MAX_BINARY_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_REVISION_BYTES: usize = 64 * 1024;
const MAX_UPDATE_OPERATIONS: u64 = 100_000;

#[derive(Debug, thiserror::Error)]
pub enum DocumentError {
    #[error("The document token does not grant access to this document.")]
    Unauthorized,
    #[error("Editing this document requires edit access.")]
    Forbidden,
    #[error("The document changed. Read a fresh snapshot before editing.")]
    Conflict,
    #[error("The document request exceeds the size limit.")]
    TooLarge,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("The document update could not be persisted.")]
    Persistence,
    #[error(
        "The document was saved, but its update notifications could not be completed. Read the document before retrying."
    )]
    Notification,
}

/// Capability minted only after the adapter verifies a document permission JWT.
pub struct DocumentAccess {
    writable: bool,
}

impl DocumentAccess {
    pub fn authorize(
        requested_document: &str,
        token_document: &str,
        writable: bool,
    ) -> Result<Self, DocumentError> {
        if requested_document != token_document {
            return Err(DocumentError::Unauthorized);
        }
        Ok(Self { writable })
    }

    pub fn require_edit(&self) -> Result<(), DocumentError> {
        if !self.writable {
            return Err(DocumentError::Forbidden);
        }
        Ok(())
    }
}

pub struct PreparedUpdate {
    /// Only new, validated operations, ready for the existing persistence path.
    pub update: Vec<u8>,
    pub revision: Vec<u8>,
    pub applied: bool,
}

/// Signed-token attribution stored alongside the existing operation log.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DocumentAttribution {
    pub actor: String,
    pub on_behalf_of: Option<String>,
}

impl DocumentAttribution {
    pub fn from_signed_claims(
        actor: String,
        on_behalf_of: Option<String>,
    ) -> Result<Self, DocumentError> {
        if actor.len() > 256 || on_behalf_of.as_ref().is_some_and(|user| user.len() > 1024) {
            return Err(DocumentError::Invalid("Invalid signed attribution."));
        }
        Ok(Self {
            actor,
            on_behalf_of,
        })
    }
}

/// Persistence port: applying the update must happen before the first await.
pub trait DocumentUpdatePort {
    fn document(&self) -> &LoroDoc;
    async fn apply_and_persist(&self, update: &[u8]) -> Result<(), DocumentError>;
}

/// Side effects after a durable write; the use case owns their order and whether
/// a newly applied edit needs document publication. Implementations own only the
/// notification transport and scheduling mechanisms.
pub trait DocumentUpdateEffects {
    fn broadcast(&self, update: &[u8]) -> Result<(), DocumentError>;
    fn publish_changed_document(&self) -> Result<(), DocumentError>;
    async fn keep_alive(&self) -> Result<(), DocumentError>;
}

pub async fn update(
    access: &DocumentAccess,
    port: &impl DocumentUpdatePort,
    effects: &impl DocumentUpdateEffects,
    expected_revision: &[u8],
    update: &[u8],
) -> Result<PreparedUpdate, DocumentError> {
    let prepared = prepare_update(access, port.document(), expected_revision, update)?;
    // Persist retries too: a prior request may have applied in memory but lost
    // its storage write or response. Duplicate Loro imports are idempotent.
    port.apply_and_persist(&prepared.update).await?;
    effects.broadcast(&prepared.update)?;
    if prepared.applied {
        effects.publish_changed_document()?;
    }
    effects.keep_alive().await?;
    Ok(prepared)
}

pub fn snapshot(
    _access: &DocumentAccess,
    doc: &LoroDoc,
) -> Result<(Vec<u8>, Vec<u8>), DocumentError> {
    let snapshot = doc
        .export(ExportMode::Snapshot)
        .map_err(|_| DocumentError::Invalid("The document snapshot could not be exported."))?;
    if snapshot.len() > MAX_BINARY_BYTES {
        return Err(DocumentError::TooLarge);
    }
    let revision = doc.oplog_vv().encode();
    if revision.len() > MAX_REVISION_BYTES {
        return Err(DocumentError::TooLarge);
    }
    Ok((snapshot, revision))
}

/// Synchronous preflight. The caller must apply the returned delta before its
/// next await, so websocket writes cannot interleave with this version check.
pub fn prepare_update(
    access: &DocumentAccess,
    doc: &LoroDoc,
    expected_revision: &[u8],
    update: &[u8],
) -> Result<PreparedUpdate, DocumentError> {
    access.require_edit()?;
    if update.len() > MAX_BINARY_BYTES || expected_revision.len() > MAX_REVISION_BYTES {
        return Err(DocumentError::TooLarge);
    }
    let expected = VersionVector::decode(expected_revision)
        .map_err(|_| DocumentError::Invalid("Invalid document revision."))?;
    let meta = LoroDoc::decode_import_blob_meta(update, true)
        .map_err(|_| DocumentError::Invalid("Invalid Loro update."))?;
    if meta.mode.is_snapshot() {
        return Err(DocumentError::Invalid(
            "Send a Loro update, not a snapshot.",
        ));
    }
    let operations: u64 = meta
        .partial_end_vv
        .iter()
        .map(|(peer, end)| {
            end.checked_sub(meta.partial_start_vv.get(peer).copied().unwrap_or(0))
                .and_then(|count| u64::try_from(count).ok())
                .unwrap_or(u64::MAX)
        })
        .try_fold(0_u64, |total, count| total.checked_add(count))
        .ok_or(DocumentError::TooLarge)?;
    if operations > MAX_UPDATE_OPERATIONS || meta.change_num > 10_000 {
        return Err(DocumentError::TooLarge);
    }
    let current = doc.oplog_vv();
    let preview = doc.fork();
    let imported = preview
        .import(update)
        .map_err(|_| DocumentError::Invalid("Invalid Loro update."))?;
    if imported.pending.is_some() || preview.state_vv() != preview.oplog_vv() {
        return Err(DocumentError::Invalid(
            "The update has missing dependencies.",
        ));
    }
    let revision = preview.oplog_vv();
    // Recognizing an already applied delta makes a lost HTTP response safely
    // retryable, even if other users have edited after the first application.
    if revision == current {
        return Ok(PreparedUpdate {
            update: update.to_vec(),
            revision: current.encode(),
            applied: false,
        });
    }
    if current != expected {
        return Err(DocumentError::Conflict);
    }
    let update = preview
        .export(ExportMode::Updates {
            from: Cow::Borrowed(&current),
        })
        .map_err(|_| DocumentError::Invalid("The validated update could not be exported."))?;
    if update.len() > MAX_BINARY_BYTES {
        return Err(DocumentError::TooLarge);
    }
    Ok(PreparedUpdate {
        update,
        revision: revision.encode(),
        applied: true,
    })
}

#[cfg(test)]
mod test;
