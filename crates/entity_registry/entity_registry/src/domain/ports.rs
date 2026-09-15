//! Read-side ports.

use model_owner::Owner;
use shared_entity_registry::{EntityRegistryResult, RegisteredEntityType};
use uuid::Uuid;

use super::models::{EntityRecord, EntityTypeCount};

/// Persistence port for the registry.
pub trait EntityRegistryRepository: Clone + Send + Sync + 'static {
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
    fn list_owned_by(
        &self,
        owner: &Owner,
        entity_type: Option<RegisteredEntityType>,
    ) -> impl Future<Output = EntityRegistryResult<Vec<EntityRecord>>> + Send;

    /// Live and deleted row counts for one kind.
    fn count_by_type(
        &self,
        entity_type: RegisteredEntityType,
    ) -> impl Future<Output = EntityRegistryResult<EntityTypeCount>> + Send;
}

/// Inbound service port: registry reads used by drivers.
pub trait EntityRegistryService: Clone + Send + Sync + 'static {
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
    fn list_owned_by(
        &self,
        owner: &Owner,
        entity_type: Option<RegisteredEntityType>,
    ) -> impl Future<Output = EntityRegistryResult<Vec<EntityRecord>>> + Send;

    /// Live and deleted row counts for one kind.
    fn count_by_type(
        &self,
        entity_type: RegisteredEntityType,
    ) -> impl Future<Output = EntityRegistryResult<EntityTypeCount>> + Send;
}
