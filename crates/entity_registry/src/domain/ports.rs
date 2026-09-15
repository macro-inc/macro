//! Read-side port. Writes ride the caller's transaction and live in outbound.

use model_owner::Owner;
use uuid::Uuid;

use super::models::{EntityRecord, EntityRegistryResult, EntityTypeCount, RegisteredEntityType};

/// Read side of the registry, backed by a pool.
///
/// Soft-deleted rows: point lookups (`get`, `get_many`) return them, because
/// a restore path knows only an id and must see what it is restoring.
/// `list_owned_by` returns live rows only, matching the partial index it
/// runs on. `count_by_type` reports both, split.
pub trait EntityRegistryRepository: Send + Sync + 'static {
    /// The row for `id`, deleted or not. `None` if never registered or hard-deleted.
    fn get(
        &self,
        id: Uuid,
    ) -> impl Future<Output = EntityRegistryResult<Option<EntityRecord>>> + Send;

    /// Rows for the ids that exist, deleted or not, in no particular order.
    /// Duplicate ids collapse; missing ids are simply absent. Empty in, empty out.
    fn get_many(
        &self,
        ids: &[Uuid],
    ) -> impl Future<Output = EntityRegistryResult<Vec<EntityRecord>>> + Send;

    /// Live rows owned by `owner`, optionally of one kind, newest-created
    /// first with `id` as the tie-break.
    ///
    /// Shaped by `entity_owner_idx (owner_type, owner_id, entity_type)
    /// WHERE deleted_at IS NULL`: the owner is the prefix, the optional kind
    /// is the trailing column, and soft-deleted rows are outside the index.
    fn list_owned_by(
        &self,
        owner: &Owner,
        entity_type: Option<RegisteredEntityType>,
    ) -> impl Future<Output = EntityRegistryResult<Vec<EntityRecord>>> + Send;

    /// Live and deleted row counts for one kind, from `entity_type_idx`.
    fn count_by_type(
        &self,
        entity_type: RegisteredEntityType,
    ) -> impl Future<Output = EntityRegistryResult<EntityTypeCount>> + Send;
}
