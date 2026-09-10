use std::future::Future;

use model_entity::Entity;
use rootcause::report;

use crate::{
    DuplicateEntityRequest, EntityMutationActor, EntityMutationErrorCode, MoveEntityRequest,
    RenameEntityRequest, UpdateEntitySharePolicyRequest, models::EntityMutationSuccess,
};

/// Result of one entity mutation, including ordered cache-visible effects.
pub type MutateEntitiesResult = Result<EntityMutationSuccess, EntityMutationErrorCode>;

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
    ) -> impl Future<Output = Vec<MutateEntitiesResult>> + Send;

    /// Move entities into a project, or to the root when `project_id` is absent.
    fn move_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<MoveEntityRequest>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult>> + Send;

    /// Update public and channel share policies.
    fn update_share_policies(
        &self,
        actor: EntityMutationActor,
        requests: Vec<UpdateEntitySharePolicyRequest>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult>> + Send;

    /// Soft-delete entities that support a reversible trash lifecycle.
    fn trash_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult>> + Send;

    /// Restore reversibly deleted entities.
    fn restore_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult>> + Send;

    /// Irreversibly delete entities.
    fn delete_entities_permanently(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult>> + Send;

    /// Duplicate entities that support copy semantics.
    fn duplicate_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<DuplicateEntityRequest>,
    ) -> impl Future<Output = Vec<MutateEntitiesResult>> + Send;
}

/// Schema-only implementation used when no mutation services are wired.
#[derive(Clone, Copy, Debug, Default)]
pub struct UnavailableEntityMutationService;

/// Build unsupported outcomes for a batch handled by the schema-only service.
fn unsupported_many(
    operation: &'static str,
    entities: impl IntoIterator<Item = Entity<'static>>,
) -> Vec<MutateEntitiesResult> {
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
    ) -> Vec<MutateEntitiesResult> {
        unsupported_many("rename", requests.into_iter().map(|request| request.entity))
    }

    async fn move_entities(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<MoveEntityRequest>,
    ) -> Vec<MutateEntitiesResult> {
        unsupported_many("move", requests.into_iter().map(|request| request.entity))
    }

    async fn update_share_policies(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<UpdateEntitySharePolicyRequest>,
    ) -> Vec<MutateEntitiesResult> {
        unsupported_many(
            "share policy updates",
            requests.into_iter().map(|request| request.entity),
        )
    }

    async fn trash_entities(
        &self,
        _actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<MutateEntitiesResult> {
        unsupported_many("trash", entities)
    }

    async fn restore_entities(
        &self,
        _actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<MutateEntitiesResult> {
        unsupported_many("restore", entities)
    }

    async fn delete_entities_permanently(
        &self,
        _actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<MutateEntitiesResult> {
        unsupported_many("permanent deletion", entities)
    }

    async fn duplicate_entities(
        &self,
        _actor: EntityMutationActor,
        requests: Vec<DuplicateEntityRequest>,
    ) -> Vec<MutateEntitiesResult> {
        unsupported_many(
            "duplication",
            requests.into_iter().map(|request| request.entity),
        )
    }
}
