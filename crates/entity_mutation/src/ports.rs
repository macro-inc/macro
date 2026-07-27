use std::future::Future;

use model_entity::Entity;
use rootcause::report;

use crate::{
    DuplicateEntityRequest, EntityMutationActor, EntityMutationErrorCode, MoveEntityRequest,
    RenameEntityRequest, UpdateEntitySharePolicyRequest, models::EntityMutationSuccess,
};

/// type alias for the result of a singular entity mutation, the success case can hold multiple affected entities
pub type MutateEntitiesResult<'a> = Result<EntityMutationSuccess<'a>, EntityMutationErrorCode>;

/// Domain port used by API adapters to mutate heterogeneous entities.
///
/// Methods are batch-oriented because the UI performs these actions across
/// selections. Each input always produces one ordered outcome, so cross-service
/// partial success is explicit and no false transaction boundary is implied.
pub trait EntityMutationService: Send + Sync + 'static {
    /// Rename entities using the canonical `display_name` concept.
    fn rename_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<RenameEntityRequest>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult<'static>>> + Send;

    /// Move entities into a project, or to the root when `project_id` is absent.
    fn move_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<MoveEntityRequest>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult<'static>>> + Send;

    /// Update public and channel share policies.
    fn update_share_policies(
        &self,
        actor: EntityMutationActor,
        requests: Vec<UpdateEntitySharePolicyRequest>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult<'static>>> + Send;

    /// Soft-delete entities that support a reversible trash lifecycle.
    fn trash_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult<'static>>> + Send;

    /// Restore reversibly deleted entities.
    fn restore_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult<'static>>> + Send;

    /// Irreversibly delete entities.
    fn delete_entities_permanently(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult<'static>>> + Send;

    /// Duplicate entities that support copy semantics.
    fn duplicate_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<DuplicateEntityRequest>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult<'static>>> + Send;

    /// Add or remove an entity from the actor's favorites.
    fn set_favorite(
        &self,
        actor: EntityMutationActor,
        entity: Entity<'static>,
        favorite: bool,
    ) -> impl Future<Output = MutateEntitiesResult<'static>> + Send;
}

/// Schema-only implementation used when no mutation services are wired.
#[derive(Clone, Copy, Debug, Default)]
pub struct UnavailableEntityMutationService;

/// Build unsupported outcomes for a batch handled by the schema-only service.
fn unsupported_many(
    operation: &'static str,
    entities: impl IntoIterator<Item = Entity<'static>>,
) -> Vec<MutateEntitiesResult<'static>> {
    entities
        .into_iter()
        .map(|entity| EntityMutationErrorCode::unsupported(report!(entity).attach(operation)))
        .map(Result::Err)
        .collect()
}

impl EntityMutationService for UnavailableEntityMutationService {
    async fn rename_entities(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<RenameEntityRequest>,
    ) -> Vec<MutateEntitiesResult<'static>> {
        unsupported_many("rename", requests.into_iter().map(|request| request.entity))
    }

    async fn move_entities(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<MoveEntityRequest>,
    ) -> Vec<MutateEntitiesResult<'static>> {
        unsupported_many("move", requests.into_iter().map(|request| request.entity))
    }

    async fn update_share_policies(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<UpdateEntitySharePolicyRequest>,
    ) -> Vec<MutateEntitiesResult<'static>> {
        unsupported_many(
            "share policy updates",
            requests.into_iter().map(|request| request.entity),
        )
    }

    async fn trash_entities(
        &self,
        _actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<MutateEntitiesResult<'static>> {
        unsupported_many("trash", entities)
    }

    async fn restore_entities(
        &self,
        _actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<MutateEntitiesResult<'static>> {
        unsupported_many("restore", entities)
    }

    async fn delete_entities_permanently(
        &self,
        _actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<MutateEntitiesResult<'static>> {
        unsupported_many("permanent deletion", entities)
    }

    async fn duplicate_entities(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<DuplicateEntityRequest>,
    ) -> Vec<MutateEntitiesResult<'static>> {
        unsupported_many(
            "duplication",
            requests.into_iter().map(|request| request.entity),
        )
    }

    async fn set_favorite(
        &self,
        _actor: EntityMutationActor,
        entity: Entity<'static>,
        _favorite: bool,
    ) -> MutateEntitiesResult<'static> {
        Err(EntityMutationErrorCode::unsupported(
            report!(entity).attach("favorites"),
        ))
    }
}
