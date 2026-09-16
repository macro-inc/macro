//! Foreign entity service implementation.

#[cfg(test)]
mod tests;

use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use uuid::Uuid;

use super::models::{
    CreateForeignEntity, ForeignEntity, ForeignEntityError, ForeignEntityLookupCaller,
    PatchForeignEntity, SourceId, validate_foreign_entity_lookup,
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
    async fn get_foreign_entity(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        let entity = receipt.entity();
        if entity.entity_type != EntityType::ForeignEntity {
            return Err(ForeignEntityError::BadRequest(format!(
                "expected ForeignEntity receipt, got {:?}",
                entity.entity_type
            )));
        }

        let id = Uuid::parse_str(&entity.entity_id).map_err(|_| {
            ForeignEntityError::BadRequest(
                "foreign entity receipt id must be a valid UUID".to_string(),
            )
        })?;

        self.get_foreign_entity_by_id(id).await
    }

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
        requesting_user: Option<String>,
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
            .get_foreign_entities_for_user(requesting_user, source_ids, limit, query)
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

/// Fetch the foreign entity a caller may view for an external identifier.
///
/// External identifiers are not unique: several documents can store a mapping
/// for the same pull request. Candidates the caller cannot view are skipped and
/// the first visible record wins. A caller with no visible candidate gets the
/// same not-found error as a lookup for an identifier that was never synced, so
/// the lookup never reveals mappings stored for documents the caller cannot see.
///
/// Visibility uses the same check as the by-id route: view access on the
/// foreign entity record itself, with internal service callers unconditionally
/// allowed.
pub async fn get_visible_foreign_entity_by_source<Service, Access>(
    service: &Service,
    entity_access: &Access,
    caller: &ForeignEntityLookupCaller,
    foreign_entity_source: &str,
    foreign_entity_id: &str,
) -> Result<ForeignEntity, ForeignEntityError>
where
    Service: ForeignEntityService,
    Access: EntityAccessService,
{
    let candidates = service
        .get_foreign_entities_by_foreign_entity_id(foreign_entity_id, Some(foreign_entity_source))
        .await?;

    for candidate in candidates {
        if caller_may_view(entity_access, caller, &candidate).await? {
            return Ok(candidate);
        }
    }

    Err(ForeignEntityError::NotFoundForSource {
        foreign_entity_source: foreign_entity_source.to_string(),
        foreign_entity_id: foreign_entity_id.to_string(),
    })
}

async fn caller_may_view<Access>(
    entity_access: &Access,
    caller: &ForeignEntityLookupCaller,
    candidate: &ForeignEntity,
) -> Result<bool, ForeignEntityError>
where
    Access: EntityAccessService,
{
    let user = match caller {
        ForeignEntityLookupCaller::Internal => return Ok(true),
        ForeignEntityLookupCaller::User(user) => user,
    };

    let permission = entity_access
        .get_entity_permission(
            Some(user),
            &candidate.id.to_string(),
            EntityType::ForeignEntity,
            None,
        )
        .await;

    match permission {
        Ok(permission) => Ok(permission.satisfies::<ViewAccessLevel>()),
        Err(
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_),
        ) => Ok(false),
        Err(error) => Err(ForeignEntityError::Internal(anyhow::anyhow!(
            "foreign entity access check failed: {error}"
        ))),
    }
}
