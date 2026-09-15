//! What the registry records and what its operations report.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use model_entity::EntityType;
use model_owner::Owner;
use rootcause::Report;
use uuid::Uuid;

/// The entity kinds the `entity` table accepts: its CHECK constraint as a type.
///
/// An enum rather than a newtype over [`EntityType`] so callers can match
/// exhaustively; adding a sixth registered kind is a compile error at every
/// site that branches on it. The string spelling is *derived* from
/// [`EntityType`] (see [`RegisteredEntityType::as_str`]), so this type owns
/// only the allow-list, which is exactly what the CHECK owns.
///
/// Widening is free (`EntityType::from(kind)`); narrowing is the single
/// fallible step (`RegisteredEntityType::try_from(ty)`), and it happens at
/// the caller that holds a wide type, never inside a write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RegisteredEntityType {
    /// `project`
    Project,
    /// `document`
    Document,
    /// `chat`
    Chat,
    /// `agent_session`
    AgentSession,
    /// `scheduled_action`
    ScheduledAction,
}

impl RegisteredEntityType {
    /// Every registered kind, in CHECK order. Tests insert one row per
    /// element so allow-list/CHECK drift fails a test, not a production write.
    pub const ALL: [Self; 5] = [
        Self::Project,
        Self::Document,
        Self::Chat,
        Self::AgentSession,
        Self::ScheduledAction,
    ];

    /// The stored spelling, taken from [`EntityType`]'s strum `snake_case`
    /// form so there is one source of truth for the string.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        EntityType::from(self).into()
    }
}

impl From<RegisteredEntityType> for EntityType {
    fn from(kind: RegisteredEntityType) -> Self {
        match kind {
            RegisteredEntityType::Project => Self::Project,
            RegisteredEntityType::Document => Self::Document,
            RegisteredEntityType::Chat => Self::Chat,
            RegisteredEntityType::AgentSession => Self::AgentSession,
            RegisteredEntityType::ScheduledAction => Self::ScheduledAction,
        }
    }
}

/// An [`EntityType`] the registry does not record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("{0} is not a registered entity type")]
pub struct UnregisteredEntityType(pub EntityType);

impl TryFrom<EntityType> for RegisteredEntityType {
    type Error = UnregisteredEntityType;

    fn try_from(value: EntityType) -> Result<Self, Self::Error> {
        match value {
            EntityType::Project => Ok(Self::Project),
            EntityType::Document => Ok(Self::Document),
            EntityType::Chat => Ok(Self::Chat),
            EntityType::AgentSession => Ok(Self::AgentSession),
            EntityType::ScheduledAction => Ok(Self::ScheduledAction),
            other => Err(UnregisteredEntityType(other)),
        }
    }
}

impl std::fmt::Display for RegisteredEntityType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One row of the registry: who owns the resource `id`, and its lifecycle stamps.
///
/// Cannot describe a row the table cannot hold: the kind is
/// [`RegisteredEntityType`] and the owner is a parsed [`Owner`], so the
/// `entity_type` and `owner_id` CHECKs are already true of any value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityRecord {
    /// The resource's id. Not a foreign key; resource tables are not referenced.
    pub id: Uuid,
    /// The kind of resource.
    pub entity_type: RegisteredEntityType,
    /// The recorded owner. Effective access lives in `entity_access`, not here.
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

/// Input to `insert_entity`.
///
/// Nothing here needs validating at construction: [`Uuid`], the kind enum and
/// [`Owner`] already carry every invariant the table checks.
///
/// `None` timestamps take the database clock. Inside one transaction that
/// is the same instant the caller's own `DEFAULT now()` columns received,
/// so a create path passes nothing and the two rows agree. A backfill
/// passes the resource row's stamps via [`NewEntityRecord::with_timestamps`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEntityRecord {
    /// The resource's id.
    pub id: Uuid,
    /// The kind of resource.
    pub entity_type: RegisteredEntityType,
    /// Who owns it.
    pub owner: Owner,
    /// `None` = database `now()`.
    pub created_at: Option<DateTime<Utc>>,
    /// `None` = database `now()`.
    pub updated_at: Option<DateTime<Utc>>,
}

impl NewEntityRecord {
    /// A record stamped by the database clock. The create-path constructor.
    #[must_use]
    pub fn new(id: Uuid, entity_type: RegisteredEntityType, owner: Owner) -> Self {
        Self {
            id,
            entity_type,
            owner,
            created_at: None,
            updated_at: None,
        }
    }

    /// Narrow a wide [`EntityType`] at the caller that holds it.
    ///
    /// The write path takes [`RegisteredEntityType`] only; this is the
    /// convenience for adapters that still carry the 19-variant type.
    pub fn try_new(
        id: Uuid,
        entity_type: EntityType,
        owner: Owner,
    ) -> Result<Self, UnregisteredEntityType> {
        Ok(Self::new(
            id,
            RegisteredEntityType::try_from(entity_type)?,
            owner,
        ))
    }

    /// Carry the resource row's own stamps. The backfill constructor.
    #[must_use]
    pub fn with_timestamps(self, created_at: DateTime<Utc>, updated_at: DateTime<Utc>) -> Self {
        Self {
            created_at: Some(created_at),
            updated_at: Some(updated_at),
            ..self
        }
    }
}

/// What `insert_entity` did. Makes `ON CONFLICT (id) DO NOTHING` visible
/// in the signature.
///
/// `AlreadyRegistered` means a row with this id existed; it does **not**
/// mean that row matches the input. The registry does not compare, because
/// an id reused with a different owner or kind is a caller bug, and a
/// second `SELECT` on every create is the wrong place to pay for it.
/// Reconciliation (T2.8) is where such rows surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsertOutcome {
    /// A new row was written.
    Inserted,
    /// A row with this id already existed; nothing was written.
    AlreadyRegistered,
}

/// What an id-targeted write did.
///
/// `NotFound` is an outcome, not an error: during dual-write rollout a
/// resource created before the registry existed has no row until backfill,
/// and its soft delete must not roll back because of that. Callers that
/// want strictness check the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    /// Exactly one row matched and was written.
    Applied,
    /// No row with that id exists.
    NotFound,
}

/// Row counts for one kind, split by liveness.
///
/// Both come from one index scan (`entity_type_idx` is not partial) via
/// `count(*) FILTER (...)`, so offering both costs nothing and lets
/// reconciliation take the total while dashboards take `live`.
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

/// Failure kinds of the registry. The report carries the cause and the row id.
///
/// There is no "unsupported type" variant: [`RegisteredEntityType`] makes
/// that unrepresentable at the write, so the only failures are the store
/// failing or a stored row failing to parse back into domain types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum EntityRegistryError {
    /// A stored row could not be decoded into an [`EntityRecord`]: its
    /// `entity_type` or `owner_id` is outside what the table's CHECKs allow,
    /// which should be impossible. The attached id says which row.
    #[error("entity row is corrupt")]
    CorruptRow,
    /// The database failed. The attached cause is the driver error.
    #[error("entity registry persistence failed")]
    Infrastructure,
}

/// Typed report returned by every registry operation, read or write.
pub type EntityRegistryResult<T> = Result<T, Report<EntityRegistryError>>;
