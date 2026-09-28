//! Registry service implementation.

#[cfg(test)]
mod test;

use model_owner::Owner;
use shared_entity_registry::{EntityRegistryResult, RegisteredEntityType};
use uuid::Uuid;

use super::models::{EntityRecord, EntityTypeCount};
use super::ports::{EntityRegistryRepository, EntityRegistryService};

/// Concrete registry service backed by an [`EntityRegistryRepository`].
#[derive(Clone)]
pub struct EntityRegistryServiceImpl<R> {
    repo: R,
}

impl<R> EntityRegistryServiceImpl<R>
where
    R: EntityRegistryRepository,
{
    /// A service over `repo`.
    #[must_use]
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> EntityRegistryService for EntityRegistryServiceImpl<R>
where
    R: EntityRegistryRepository,
{
    #[tracing::instrument(skip(self), err)]
    async fn get(&self, id: Uuid) -> EntityRegistryResult<Option<EntityRecord>> {
        self.repo.get(id).await
    }

    #[tracing::instrument(skip(self, ids), fields(count = ids.len()), err)]
    async fn get_many(&self, ids: &[Uuid]) -> EntityRegistryResult<Vec<EntityRecord>> {
        self.repo.get_many(ids).await
    }

    #[tracing::instrument(skip(self, owner), fields(owner.kind = ?owner.owner_type()), err)]
    async fn list_owned_by(
        &self,
        owner: &Owner,
        entity_type: Option<RegisteredEntityType>,
    ) -> EntityRegistryResult<Vec<EntityRecord>> {
        self.repo.list_owned_by(owner, entity_type).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn count_by_type(
        &self,
        entity_type: RegisteredEntityType,
    ) -> EntityRegistryResult<EntityTypeCount> {
        self.repo.count_by_type(entity_type).await
    }
}
