//! Domain models for collab surfaces.

use chrono::{DateTime, Utc};
use model_entity::{Entity, EntityType};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lifecycle state of a collab surface.
///
/// `Pending` means the row exists but the sync-service session may not: the
/// row is inserted before the durable object is initialized and flipped to
/// `Ready` once the initial snapshot is stored. A persisted `Pending` row is
/// an ensure that died or failed mid-init; the next ensure for the same id
/// retries initialization (the initializer tolerates an already-initialized
/// session), so `Pending` is self-healing rather than terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum SurfaceState {
    /// Row inserted, sync-service session not yet initialized.
    Pending,
    /// Sync-service session initialized; the surface is connectable.
    Ready,
}

impl SurfaceState {
    /// The value stored in the `state` column.
    pub fn db_value(&self) -> &'static str {
        match self {
            SurfaceState::Pending => "pending",
            SurfaceState::Ready => "ready",
        }
    }

    /// Parse a `state` column value.
    pub fn from_db_value(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(SurfaceState::Pending),
            "ready" => Some(SurfaceState::Ready),
            _ => None,
        }
    }
}

/// A collab surface: a stable id bound to a parent entity, backed by a Loro
/// session in sync-service. Content lives in the CRDT, not here.
#[derive(Debug, Clone)]
pub struct CollabSurface {
    /// The surface id — also the sync-service session (durable object) key.
    pub id: Uuid,
    /// The parent entity access derives from.
    pub parent: Entity<'static>,
    /// Lifecycle state.
    pub state: SurfaceState,
    /// When the row was created.
    pub created_at: DateTime<Utc>,
    /// When the row was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A ready surface's full Loro state, read through sync-service.
#[derive(Clone, PartialEq, Eq)]
pub struct SurfaceSnapshot {
    /// A full Loro snapshot export, including pending persisted operations.
    pub snapshot: Vec<u8>,
    /// The encoded Loro version vector the snapshot is at; pass it back as an
    /// update's expected revision.
    pub revision: Vec<u8>,
}

/// Lengths only: surface content stays out of logs.
impl std::fmt::Debug for SurfaceSnapshot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SurfaceSnapshot")
            .field("snapshot_len", &self.snapshot.len())
            .field("revision_len", &self.revision.len())
            .finish()
    }
}

/// The outcome of an update to a surface's Loro state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SurfaceUpdate {
    /// The state now includes the update, at `revision`. A retried update the
    /// state already holds reports this too, with the current revision.
    Applied {
        /// The encoded Loro version vector after the update.
        revision: Vec<u8>,
    },
    /// The state moved past the expected revision; nothing was applied. Read
    /// a fresh snapshot and rebuild the update.
    Conflict,
}

/// Who creates and retires the surfaces under a parent entity type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurfaceOwnership {
    /// Any caller with access to the parent, through the public API.
    Callers,
    /// The parent's own domain, through [`OwnedSurfaceService`]. The public
    /// API mints tokens for these surfaces but never ensures or deletes them.
    ///
    /// [`OwnedSurfaceService`]: crate::domain::ports::OwnedSurfaceService
    ParentDomain,
}

/// The surface policy for a parent entity type; `None` when surfaces cannot
/// attach to it.
///
/// `ChannelMessage` is deliberately absent: it has no access resolution in
/// `entity_access`, so a message-scoped surface attaches to its channel
/// instead (the `Call → Channel` precedent). The rest are excluded until they
/// have a surface story.
pub fn surface_ownership(parent: EntityType) -> Option<SurfaceOwnership> {
    match parent {
        EntityType::Document
        | EntityType::Channel
        | EntityType::Project
        | EntityType::Chat
        | EntityType::EmailThread
        | EntityType::Call => Some(SurfaceOwnership::Callers),
        EntityType::Initiative | EntityType::Form => Some(SurfaceOwnership::ParentDomain),
        _ => None,
    }
}

/// Errors returned by the collab-surface service.
#[derive(Debug, thiserror::Error)]
pub enum CollabSurfaceError {
    /// No such surface (or it has been deleted).
    #[error("collab surface not found")]
    NotFound,
    /// The parent entity named at creation does not exist.
    #[error("parent entity not found")]
    ParentNotFound,
    /// The surface id was soft-deleted. Distinct from
    /// [`CollabSurfaceError::NotFound`] so an ensure with a recycled id fails
    /// loudly instead of looking like a race to retry.
    #[error("this surface id was deleted and cannot be reused")]
    Gone,
    /// The surface id is taken in the sync-service document namespace that
    /// surfaces share: it names a document, or (for a new surface) already has
    /// a session. A new surface only ever creates its own session.
    #[error("this surface id is already in use")]
    IdReserved,
    /// The surface exists but its sync-service session is not initialized yet,
    /// so it cannot be connected to.
    #[error("collab surface is not ready")]
    NotReady,
    /// The request was invalid.
    #[error("{0}")]
    BadRequest(String),
    /// The caller may not act on this surface's parent entity. Maps to `403`;
    /// authentication failures (`401`) are produced by the authorization
    /// extractor before a handler runs.
    #[error("you do not have access to this surface")]
    AccessDenied,
    /// Any other internal error.
    #[error("internal collab surface error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for CollabSurfaceError {
    fn from(report: rootcause::Report) -> Self {
        CollabSurfaceError::Internal(report)
    }
}
