//! Content-agnostic document snapshots and atomic CRDT updates.
//!
//! This module has no HTTP or storage dependencies. The durable-object adapter
//! supplies verified JWT claims and persists accepted updates through its oplog.
use std::sync::MutexGuard;

use automerge::{Automerge, ReadDoc};

use super::crdt::{decode_changes, decode_revision, encode_revision};

pub const MAX_BINARY_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_REVISION_BYTES: usize = 64 * 1024;

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
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
pub struct DocumentAttribution {
    pub actor: String,
    pub on_behalf_of: Option<String>,
}

impl DocumentAttribution {
    /// Resolve only verified session claims. Human edits are direct actions;
    /// an explicit agent actor retains the user it is acting on behalf of.
    pub fn from_session_claims(
        actor: Option<String>,
        user_id: Option<String>,
    ) -> Result<Option<Self>, DocumentError> {
        match (actor, user_id) {
            (Some(actor), user_id) => Self::from_signed_claims(actor, user_id).map(Some),
            (None, Some(user_id)) => {
                // Human identities retain the user-claim bound; long valid
                // email addresses can exceed the explicit agent-actor bound.
                if user_id.len() > 1024 {
                    return Err(DocumentError::Invalid("Invalid signed attribution."));
                }
                Ok(Some(Self {
                    actor: user_id,
                    on_behalf_of: None,
                }))
            }
            (None, None) => Ok(None),
        }
    }

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
    fn document(&self) -> MutexGuard<'_, Automerge>;
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
    let prepared = prepare_update(access, &port.document(), expected_revision, update)?;
    // Persist retries too: a prior request may have applied in memory but lost
    // its storage write or response. Duplicate Automerge changes are idempotent.
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
    doc: &Automerge,
) -> Result<(Vec<u8>, Vec<u8>), DocumentError> {
    let snapshot = doc.save();
    if snapshot.len() > MAX_BINARY_BYTES {
        return Err(DocumentError::TooLarge);
    }
    let revision = encode_revision(&doc.get_heads());
    if revision.len() > MAX_REVISION_BYTES {
        return Err(DocumentError::TooLarge);
    }
    Ok((snapshot, revision))
}

/// Synchronous preflight. The caller must apply the returned delta before its
/// next await, so websocket writes cannot interleave with this version check.
pub fn prepare_update(
    access: &DocumentAccess,
    doc: &Automerge,
    expected_revision: &[u8],
    update: &[u8],
) -> Result<PreparedUpdate, DocumentError> {
    access.require_edit()?;
    if update.len() > MAX_BINARY_BYTES || expected_revision.len() > MAX_REVISION_BYTES {
        return Err(DocumentError::TooLarge);
    }
    let expected = decode_revision(expected_revision)?;
    let changes = decode_changes(update)?;
    let current = doc.get_heads();
    let mut preview = doc.clone();
    preview
        .apply_changes(changes)
        .map_err(|_| DocumentError::Invalid("Invalid Automerge update."))?;
    if !preview.get_missing_deps(&[]).is_empty() {
        return Err(DocumentError::Invalid(
            "The update has missing dependencies.",
        ));
    }
    let revision = preview.get_heads();
    // A lost response can be retried even after another client has edited.
    if revision == current {
        return Ok(PreparedUpdate {
            update: update.to_vec(),
            revision: encode_revision(&current),
            applied: false,
        });
    }
    if current != expected {
        return Err(DocumentError::Conflict);
    }
    let update = preview.save_after(&current);
    if update.len() > MAX_BINARY_BYTES {
        return Err(DocumentError::TooLarge);
    }
    Ok(PreparedUpdate {
        update,
        revision: encode_revision(&revision),
        applied: true,
    })
}

#[cfg(test)]
mod test;
