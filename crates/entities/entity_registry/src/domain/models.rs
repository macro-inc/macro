//! Read-side registry records.

use chrono::{DateTime, Utc};
use model_owner::Owner;
use shared_entity_registry::RegisteredEntityType;
use uuid::Uuid;

/// One row of the registry: who owns the resource `id`, and its lifecycle stamps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityRecord {
    /// The resource's id.
    pub id: Uuid,
    /// The kind of resource.
    pub entity_type: RegisteredEntityType,
    /// The recorded owner.
    pub owner: Owner,
    /// When the row was registered (or the resource's own `createdAt` if backfilled).
    pub created_at: DateTime<Utc>,
    /// Mirror of the resource's `updatedAt`; written by `touch_updated`.
    pub updated_at: DateTime<Utc>,
    /// Set while the resource is soft-deleted; `None` for a live resource.
    pub deleted_at: Option<DateTime<Utc>>,
}

impl EntityRecord {
    /// `true` when `deleted_at` is unset.
    #[must_use]
    pub fn is_live(&self) -> bool {
        self.deleted_at.is_none()
    }
}

/// Row counts for one kind, split by liveness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EntityTypeCount {
    /// Rows with `deleted_at IS NULL`.
    pub live: u64,
    /// Rows with `deleted_at IS NOT NULL`.
    pub deleted: u64,
}

impl EntityTypeCount {
    /// `live + deleted`: every registered row of the kind.
    #[must_use]
    pub fn total(self) -> u64 {
        self.live + self.deleted
    }
}
