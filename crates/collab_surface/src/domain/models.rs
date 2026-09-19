//! Domain models for collab surfaces.

use chrono::{DateTime, Utc};
use model_entity::Entity;
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
