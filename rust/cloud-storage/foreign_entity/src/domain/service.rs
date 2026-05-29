//! Foreign entity service implementation.

#[cfg(test)]
mod tests;

use uuid::Uuid;

use super::models::{
    CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
    validate_foreign_entity_lookup,
};
use super::ports::{ForeignEntityListQuery, ForeignEntityRepository, ForeignEntityService};

/// Concrete foreign entity service implementation.
pub struct ForeignEntityServiceImpl<R> {
    repo: R,
}

impl<R> ForeignEntityServiceImpl<R>
where
    R: ForeignEntityRepository,
{
    /// Create a foreign entity service backed by the provided repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> ForeignEntityService for ForeignEntityServiceImpl<R>
where
    R: ForeignEntityRepository,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_foreign_entity_by_id(
        &self,
        id: Uuid,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        self.repo
            .get_foreign_entity_by_id(id)
            .await
            .map_err(|error| ForeignEntityError::Internal(error.into()))?
            .ok_or(ForeignEntityError::NotFound(id))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        validate_foreign_entity_lookup(foreign_entity_id, foreign_entity_source)?;

        self.repo
            .get_foreign_entities_by_foreign_entity_id(foreign_entity_id, foreign_entity_source)
            .await
            .map_err(|error| ForeignEntityError::Internal(error.into()))
    }

    #[tracing::instrument(err, skip(self, source_ids, query))]
    async fn get_foreign_entities_for_user(
        &self,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        if source_ids.is_empty() {
            return Ok(Vec::new());
        }

        for source_id in &source_ids {
            source_id.validate()?;
        }

        self.repo
            .get_foreign_entities_for_user(source_ids, limit, query)
            .await
            .map_err(|error| ForeignEntityError::Internal(error.into()))
    }

    #[tracing::instrument(err, skip(self, create))]
    async fn create_foreign_entity(
        &self,
        create: CreateForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        create.validate()?;

        self.repo
            .create_foreign_entity(macro_uuid::generate_uuid_v7(), create)
            .await
            .map_err(|error| ForeignEntityError::Internal(error.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_foreign_entity(&self, id: Uuid) -> Result<(), ForeignEntityError> {
        let deleted = self
            .repo
            .delete_foreign_entity(id)
            .await
            .map_err(|error| ForeignEntityError::Internal(error.into()))?;

        if deleted {
            Ok(())
        } else {
            Err(ForeignEntityError::NotFound(id))
        }
    }

    #[tracing::instrument(err, skip(self, patch))]
    async fn patch_foreign_entity(
        &self,
        id: Uuid,
        patch: PatchForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        patch.validate()?;

        self.repo
            .patch_foreign_entity(id, patch)
            .await
            .map_err(|error| ForeignEntityError::Internal(error.into()))?
            .ok_or(ForeignEntityError::NotFound(id))
    }
}
