use std::future::Future;

use model_entity::Entity;

use crate::{
    DuplicateEntityRequest, EntityMutationActor, EntityMutationOutcome, MoveEntityRequest,
    RenameEntityRequest, UpdateEntitySharePolicyRequest,
};

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
    ) -> impl Future<Output = Vec<EntityMutationOutcome>> + Send;

    /// Move entities into a project, or to the root when `project_id` is absent.
    fn move_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<MoveEntityRequest>,
    ) -> impl Future<Output = Vec<EntityMutationOutcome>> + Send;

    /// Update public and channel share policies.
    fn update_share_policies(
        &self,
        actor: EntityMutationActor,
        requests: Vec<UpdateEntitySharePolicyRequest>,
    ) -> impl Future<Output = Vec<EntityMutationOutcome>> + Send;

    /// Soft-delete entities that support a reversible trash lifecycle.
    fn trash_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Vec<EntityMutationOutcome>> + Send;

    /// Restore reversibly deleted entities.
    fn restore_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Vec<EntityMutationOutcome>> + Send;

    /// Irreversibly delete entities.
    fn delete_entities_permanently(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Vec<EntityMutationOutcome>> + Send;

    /// Duplicate entities that support copy semantics.
    fn duplicate_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<DuplicateEntityRequest>,
    ) -> impl Future<Output = Vec<EntityMutationOutcome>> + Send;

    /// Add or remove an entity from the actor's favorites.
    fn set_favorite(
        &self,
        actor: EntityMutationActor,
        entity: Entity<'static>,
        favorite: bool,
    ) -> impl Future<Output = EntityMutationOutcome> + Send;
}

/// Schema-only implementation used when no mutation services are wired.
#[derive(Clone, Copy, Debug, Default)]
pub struct UnavailableEntityMutationService;

/// Build unsupported outcomes for a batch handled by the schema-only service.
fn unsupported_many(
    operation: &str,
    entities: impl IntoIterator<Item = Entity<'static>>,
) -> Vec<EntityMutationOutcome> {
    entities
        .into_iter()
        .map(|entity| EntityMutationOutcome::unsupported(entity, operation))
        .collect()
}

impl EntityMutationService for UnavailableEntityMutationService {
    async fn rename_entities(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<RenameEntityRequest>,
    ) -> Vec<EntityMutationOutcome> {
        unsupported_many("rename", requests.into_iter().map(|request| request.entity))
    }

    async fn move_entities(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<MoveEntityRequest>,
    ) -> Vec<EntityMutationOutcome> {
        unsupported_many("move", requests.into_iter().map(|request| request.entity))
    }

    async fn update_share_policies(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<UpdateEntitySharePolicyRequest>,
    ) -> Vec<EntityMutationOutcome> {
        unsupported_many(
            "share policy updates",
            requests.into_iter().map(|request| request.entity),
        )
    }

    async fn trash_entities(
        &self,
        _actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<EntityMutationOutcome> {
        unsupported_many("trash", entities)
    }

    async fn restore_entities(
        &self,
        _actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<EntityMutationOutcome> {
        unsupported_many("restore", entities)
    }

    async fn delete_entities_permanently(
        &self,
        _actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<EntityMutationOutcome> {
        unsupported_many("permanent deletion", entities)
    }

    async fn duplicate_entities(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<DuplicateEntityRequest>,
    ) -> Vec<EntityMutationOutcome> {
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
    ) -> EntityMutationOutcome {
        EntityMutationOutcome::unsupported(entity, "favorites")
    }
}
