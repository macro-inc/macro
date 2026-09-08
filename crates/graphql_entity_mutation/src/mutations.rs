use std::{collections::HashSet, marker::PhantomData, sync::Arc};

use async_graphql::{
    Context, Enum, ErrorExtensions, ID, InputObject, MaybeUndefined, Object, SimpleObject, Union,
};
use entity_mutation::{
    DuplicateEntityRequest, EntityMutationActor, EntityMutationEffect, EntityMutationErrorCode,
    EntityMutationService, EntityMutationSuccess, MoveEntityRequest, MutateEntitiesResult,
    RenameEntityRequest, UpdateEntitySharePolicyRequest,
};
use graphql_common::GraphqlEntityType;
use graphql_permission::GraphqlEntityAccessLevel;
use graphql_soup::{SoupEntityEdges, SoupPatch};
use model_entity::Entity;
use models_permissions::share_permission::{
    LinkShare, UpdateSharePermissionRequestV2,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};

#[cfg(test)]
mod test;

/// Maximum number of independent entities accepted by a standard batch mutation.
const MAX_ENTITY_MUTATION_BATCH: usize = 100;

/// Build a GraphQL input error with the stable client-visible error code.
fn invalid_request(message: impl Into<String>) -> async_graphql::Error {
    async_graphql::Error::new(message.into()).extend_with(|_, extensions| {
        extensions.set("code", "INVALID_INPUT");
    })
}

/// Validate a standard mutation batch for size and duplicate entity references.
fn validate_batch(
    operation: &str,
    refs: impl IntoIterator<Item = (GraphqlEntityType, String)>,
) -> async_graphql::Result<()> {
    validate_batch_with_limit(operation, refs, MAX_ENTITY_MUTATION_BATCH)
}

/// Validate a mutation batch using a capability-specific size limit.
fn validate_batch_with_limit(
    operation: &str,
    refs: impl IntoIterator<Item = (GraphqlEntityType, String)>,
    max_entities: usize,
) -> async_graphql::Result<()> {
    let refs = refs.into_iter().collect::<Vec<_>>();
    if refs.len() > max_entities {
        return Err(invalid_request(format!(
            "{operation} accepts at most {max_entities} entities"
        )));
    }

    let mut seen = HashSet::with_capacity(refs.len());
    if let Some((entity_type, entity_id)) = refs.into_iter().find(|key| !seen.insert(key.clone())) {
        let entity_type = entity_type.into_model();
        return Err(invalid_request(format!(
            "{operation} contains duplicate entity {entity_type}:{entity_id}"
        )));
    }
    Ok(())
}

/// Convert a GraphQL entity reference into its duplicate-detection key.
fn entity_input_key(entity: &EntityRefInput) -> (GraphqlEntityType, String) {
    (entity.entity_type, entity.id.0.clone())
}

/// Root GraphQL mutation object for capability-oriented entity mutations.
pub struct EntityMutationRoot<S, E> {
    /// Associates the GraphQL adapter with its domain service and Soup edges.
    _service: PhantomData<fn() -> (S, E)>,
}

impl<S, E> EntityMutationRoot<S, E> {
    /// Construct the entity mutation root.
    pub fn new() -> Self {
        Self {
            _service: PhantomData,
        }
    }
}

impl<S, E> Default for EntityMutationRoot<S, E> {
    fn default() -> Self {
        Self::new()
    }
}

/// Canonical entity reference accepted by unified mutations.
#[derive(Clone, InputObject)]
pub struct EntityRefInput {
    /// Entity kind.
    #[graphql(name = "type")]
    pub entity_type: GraphqlEntityType,
    /// Entity identifier in that kind's canonical namespace.
    pub id: ID,
}

impl EntityRefInput {
    /// Convert this GraphQL reference into the canonical entity model.
    pub fn into_model(self) -> Entity<'static> {
        self.entity_type.into_model().with_entity_string(self.id.0)
    }
}

/// One entity rename in a batch.
#[derive(InputObject)]
pub struct RenameEntityInput {
    /// Entity to rename.
    pub entity: EntityRefInput,
    /// New user-visible display name.
    pub display_name: String,
}

impl RenameEntityInput {
    /// Convert this GraphQL input into a domain rename request.
    pub fn into_model(self) -> RenameEntityRequest {
        RenameEntityRequest {
            entity: self.entity.into_model(),
            display_name: self.display_name,
        }
    }
}

/// One entity move in a batch.
#[derive(InputObject)]
pub struct MoveEntityInput {
    /// Entity to move.
    pub entity: EntityRefInput,
    /// Destination project id. Omit or pass null to move to the root.
    pub project_id: Option<ID>,
}

impl MoveEntityInput {
    /// Convert this GraphQL input into a domain move request.
    pub fn into_model(self) -> MoveEntityRequest {
        MoveEntityRequest {
            entity: self.entity.into_model(),
            project_id: self.project_id.map(|id| id.0),
        }
    }
}

/// One entity duplication in a batch.
#[derive(InputObject)]
pub struct DuplicateEntityInput {
    /// Source entity to duplicate.
    pub entity: EntityRefInput,
    /// Optional display name for the new entity.
    pub display_name: Option<String>,
}

impl DuplicateEntityInput {
    /// Convert this GraphQL input into a domain duplication request.
    pub fn into_model(self) -> DuplicateEntityRequest {
        DuplicateEntityRequest {
            entity: self.entity.into_model(),
            display_name: self.display_name,
        }
    }
}

/// Operation applied to one channel share-policy entry.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
pub enum GraphqlSharePolicyOperation {
    /// Add an entry.
    Add,
    /// Remove an entry.
    Remove,
    /// Replace an existing entry.
    Replace,
}

impl GraphqlSharePolicyOperation {
    /// Convert this GraphQL operation into the permissions-domain model.
    pub fn into_model(self) -> UpdateOperation {
        match self {
            Self::Add => UpdateOperation::Add,
            Self::Remove => UpdateOperation::Remove,
            Self::Replace => UpdateOperation::Replace,
        }
    }
}

/// Channel-specific entry inside the otherwise common share-policy model.
#[derive(InputObject)]
pub struct ChannelSharePolicyInput {
    /// Requested change.
    pub operation: GraphqlSharePolicyOperation,
    /// Channel receiving or losing access.
    pub channel_id: ID,
    /// Access level for add/replace operations.
    pub access_level: Option<GraphqlEntityAccessLevel>,
}

impl ChannelSharePolicyInput {
    /// Convert this GraphQL input into a channel share-permission update.
    pub fn into_model(self) -> UpdateChannelSharePermission {
        UpdateChannelSharePermission {
            operation: self.operation.into_model(),
            channel_id: self.channel_id.0,
            access_level: self.access_level.map(GraphqlEntityAccessLevel::into_model),
        }
    }
}

/// Audience allowed to access an entity through its share link.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
pub enum GraphqlLinkShare {
    /// Anyone with the link can access the entity.
    Public,
    /// Members of the owner's team with the link can access the entity.
    Team,
}

impl GraphqlLinkShare {
    /// Convert this GraphQL audience into the permissions-domain model.
    pub fn into_model(self) -> LinkShare {
        match self {
            Self::Public => LinkShare::Public,
            Self::Team => LinkShare::Team,
        }
    }
}

/// Shared link/channel share-policy update.
#[derive(InputObject)]
pub struct EntitySharePolicyInput {
    /// Link-sharing audience. Omit to leave unchanged or pass null to disable link sharing.
    pub link_share: MaybeUndefined<GraphqlLinkShare>,
    /// Link access level. Omit to leave unchanged or pass null to reset it to the default level
    /// when a link share exists.
    pub link_share_access_level: MaybeUndefined<GraphqlEntityAccessLevel>,
    /// Channel access entries to add, remove, or replace.
    pub channel_share_permissions: Option<Vec<ChannelSharePolicyInput>>,
}

impl EntitySharePolicyInput {
    /// Convert this GraphQL input into a shared permission update.
    pub fn into_model(self) -> UpdateSharePermissionRequestV2 {
        UpdateSharePermissionRequestV2 {
            link_share: self
                .link_share
                .map_value(GraphqlLinkShare::into_model)
                .into(),
            link_share_access_level: self
                .link_share_access_level
                .map_value(GraphqlEntityAccessLevel::into_model)
                .into(),
            channel_share_permissions: self.channel_share_permissions.map(|entries| {
                entries
                    .into_iter()
                    .map(ChannelSharePolicyInput::into_model)
                    .collect()
            }),
        }
    }
}

/// One share-policy update in a batch.
#[derive(InputObject)]
pub struct UpdateEntitySharePolicyInput {
    /// Entity whose share policy should change.
    pub entity: EntityRefInput,
    /// New link/channel policy values.
    pub policy: EntitySharePolicyInput,
}

impl UpdateEntitySharePolicyInput {
    /// Convert this GraphQL input into a domain share-policy request.
    pub fn into_model(self) -> UpdateEntitySharePolicyRequest {
        UpdateEntitySharePolicyRequest {
            entity: self.entity.into_model(),
            policy: self.policy.into_model(),
        }
    }
}

/// Validate conditional fields required by link and channel share updates.
fn validate_share_policy_inputs(
    inputs: &[UpdateEntitySharePolicyInput],
) -> async_graphql::Result<()> {
    for input in inputs {
        if input.policy.link_share.is_value() && !input.policy.link_share_access_level.is_value() {
            return Err(invalid_request(
                "linkShareAccessLevel is required when link sharing is enabled",
            ));
        }
        if let Some(entries) = &input.policy.channel_share_permissions {
            for entry in entries {
                if matches!(
                    entry.operation,
                    GraphqlSharePolicyOperation::Add | GraphqlSharePolicyOperation::Replace
                ) && entry.access_level.is_none()
                {
                    return Err(invalid_request(
                        "accessLevel is required for ADD and REPLACE channel share operations",
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Stable machine-readable mutation error code.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
pub enum GraphqlEntityMutationErrorCode {
    /// Operation is unavailable for the requested entity kind.
    UnsupportedOperation,
    /// Input violates a domain constraint.
    InvalidInput,
    /// Actor lacks the required capability.
    Forbidden,
    /// Entity was not found.
    NotFound,
    /// Mutation conflicts with current state.
    Conflict,
    /// Internal failure.
    Internal,
}

impl GraphqlEntityMutationErrorCode {
    /// Construct a GraphQL error code from the entity-mutation domain model.
    pub fn new(value: EntityMutationErrorCode) -> Self {
        match value {
            EntityMutationErrorCode::UnsupportedOperation(_) => Self::UnsupportedOperation,
            EntityMutationErrorCode::InvalidInput(_) => Self::InvalidInput,
            EntityMutationErrorCode::Forbidden(_) => Self::Forbidden,
            EntityMutationErrorCode::NotFound(_) => Self::NotFound,
            EntityMutationErrorCode::Conflict(_) => Self::Conflict,
            EntityMutationErrorCode::Internal(_) => Self::Internal,
        }
    }
}

/// User-safe per-entity mutation error.
#[derive(SimpleObject)]
pub struct GraphqlEntityMutationError {
    /// Machine-readable error category.
    pub code: GraphqlEntityMutationErrorCode,
    /// User-safe explanation.
    pub message: String,
}

/// Successful result for one requested entity mutation.
pub struct GraphqlMutationSuccess<E> {
    /// Ordered domain effects rendered through the shared Soup patch contract.
    effects: Vec<EntityMutationEffect>,
    /// Associates the result with the composed Soup edge object.
    edges: PhantomData<E>,
}

/// Successful result for one requested entity mutation.
#[Object]
impl<E: SoupEntityEdges> GraphqlMutationSuccess<E> {
    /// Ordered normalized-cache effects produced by the mutation.
    async fn effects(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<SoupPatch<E>>> {
        let user_id = mutation_actor(ctx)?.user_id;
        self.effects
            .iter()
            .map(|effect| match effect {
                EntityMutationEffect::Updated(entity) => {
                    Ok(SoupPatch::updated(user_id.clone(), entity.clone()))
                }
                EntityMutationEffect::Deleted(entity) => SoupPatch::deleted(entity.clone()),
            })
            .collect()
    }
}

/// User-safe failure for one requested entity mutation.
pub struct GraphqlMutationError(
    /// Stable domain error category for the failed mutation.
    EntityMutationErrorCode,
);

/// User-safe failure for one requested entity mutation.
#[Object]
impl GraphqlMutationError {
    /// Stable machine-readable error category.
    async fn error_code(&self) -> GraphqlEntityMutationErrorCode {
        GraphqlEntityMutationErrorCode::new(self.0)
    }

    /// User-safe explanation of the failure.
    async fn message(&self) -> &'static str {
        match self.0 {
            EntityMutationErrorCode::UnsupportedOperation(_) => {
                "Operation is not supported for this entity"
            }
            EntityMutationErrorCode::InvalidInput(_) => "invalid entity mutation input",
            EntityMutationErrorCode::Forbidden(_) => "insufficient permission for entity mutation",
            EntityMutationErrorCode::NotFound(_) => "entity could not be found",
            EntityMutationErrorCode::Conflict(_) => {
                "entity mutation conflicts with current entity state"
            }
            EntityMutationErrorCode::Internal(_) => "An internal error occurred",
        }
    }
}

/// Result for one requested entity in a batch.
#[derive(Union)]
pub enum GraphqlEntityMutationResult<E: SoupEntityEdges> {
    /// The request succeeded.
    Success(GraphqlMutationSuccess<E>),
    /// The request failed.
    Error(GraphqlMutationError),
}

impl<E: SoupEntityEdges> GraphqlEntityMutationResult<E> {
    /// Construct a successful result that refreshes one entity's Soup record.
    pub fn from_updated_entity(entity: Entity<'static>) -> Self {
        Self::Success(GraphqlMutationSuccess {
            effects: vec![EntityMutationEffect::updated(entity)],
            edges: PhantomData,
        })
    }

    /// Construct a failed result from a domain-classified error.
    pub fn from_error_code(error: EntityMutationErrorCode) -> Self {
        Self::Error(GraphqlMutationError(error))
    }

    /// Convert a borrowed domain mutation outcome into its GraphQL union variant.
    fn new(x: Result<&EntityMutationSuccess, &EntityMutationErrorCode>) -> Self {
        match x {
            Ok(result) => Self::Success(GraphqlMutationSuccess {
                effects: result.effects.clone(),
                edges: PhantomData,
            }),
            Err(error) => Self::Error(GraphqlMutationError(*error)),
        }
    }
}

/// Batch mutation payload. Results preserve input order and allow partial
/// success across independently stored entity kinds.
pub struct EntityMutationPayload<E> {
    /// Per-input mutation outcomes.
    results: Vec<MutateEntitiesResult>,
    /// Associates the payload with the composed Soup edge object.
    edges: PhantomData<E>,
}

impl<E> EntityMutationPayload<E> {
    /// Construct a batch payload from ordered domain mutation outcomes.
    fn new(results: Vec<MutateEntitiesResult>) -> Self {
        EntityMutationPayload {
            results,
            edges: PhantomData,
        }
    }
}

/// Results for a batch mutation, preserving the input order.
#[Object]
impl<E: SoupEntityEdges> EntityMutationPayload<E> {
    /// Per-input mutation outcomes.
    async fn results(&self) -> Vec<GraphqlEntityMutationResult<E>> {
        self.results
            .iter()
            .map(Result::as_ref)
            .map(GraphqlEntityMutationResult::new)
            .collect()
    }
}

/// Extract the domain mutation port installed in the request context.
fn mutation_service<'ctx, S: EntityMutationService>(
    ctx: &'ctx Context<'_>,
) -> async_graphql::Result<&'ctx Arc<S>> {
    ctx.data::<Arc<S>>()
}

/// Extract the authenticated actor installed in the request context.
fn mutation_actor(ctx: &Context<'_>) -> async_graphql::Result<EntityMutationActor> {
    Ok(ctx.data::<EntityMutationActor>()?.clone())
}

#[Object]
impl<S: EntityMutationService, E: SoupEntityEdges> EntityMutationRoot<S, E> {
    /// Rename heterogeneous entities in one request.
    async fn rename_entities(
        &self,
        ctx: &Context<'_>,
        inputs: Vec<RenameEntityInput>,
    ) -> async_graphql::Result<EntityMutationPayload<E>> {
        validate_batch(
            "renameEntities",
            inputs.iter().map(|input| entity_input_key(&input.entity)),
        )?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .rename_entities(
                    mutation_actor(ctx)?,
                    inputs
                        .into_iter()
                        .map(RenameEntityInput::into_model)
                        .collect(),
                )
                .await,
        ))
    }

    /// Move heterogeneous entities to a project or to the root.
    async fn move_entities(
        &self,
        ctx: &Context<'_>,
        inputs: Vec<MoveEntityInput>,
    ) -> async_graphql::Result<EntityMutationPayload<E>> {
        validate_batch(
            "moveEntities",
            inputs.iter().map(|input| entity_input_key(&input.entity)),
        )?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .move_entities(
                    mutation_actor(ctx)?,
                    inputs
                        .into_iter()
                        .map(MoveEntityInput::into_model)
                        .collect(),
                )
                .await,
        ))
    }

    /// Update link and channel share policies across supported entity kinds.
    async fn update_entity_share_policies(
        &self,
        ctx: &Context<'_>,
        inputs: Vec<UpdateEntitySharePolicyInput>,
    ) -> async_graphql::Result<EntityMutationPayload<E>> {
        validate_batch(
            "updateEntitySharePolicies",
            inputs.iter().map(|input| entity_input_key(&input.entity)),
        )?;
        validate_share_policy_inputs(&inputs)?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .update_share_policies(
                    mutation_actor(ctx)?,
                    inputs
                        .into_iter()
                        .map(UpdateEntitySharePolicyInput::into_model)
                        .collect(),
                )
                .await,
        ))
    }

    /// Soft-delete entities with a reversible trash lifecycle.
    async fn trash_entities(
        &self,
        ctx: &Context<'_>,
        entities: Vec<EntityRefInput>,
    ) -> async_graphql::Result<EntityMutationPayload<E>> {
        validate_batch("trashEntities", entities.iter().map(entity_input_key))?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .trash_entities(
                    mutation_actor(ctx)?,
                    entities
                        .into_iter()
                        .map(EntityRefInput::into_model)
                        .collect(),
                )
                .await,
        ))
    }

    /// Restore reversibly deleted entities.
    async fn restore_entities(
        &self,
        ctx: &Context<'_>,
        entities: Vec<EntityRefInput>,
    ) -> async_graphql::Result<EntityMutationPayload<E>> {
        validate_batch("restoreEntities", entities.iter().map(entity_input_key))?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .restore_entities(
                    mutation_actor(ctx)?,
                    entities
                        .into_iter()
                        .map(EntityRefInput::into_model)
                        .collect(),
                )
                .await,
        ))
    }

    /// Irreversibly delete entities.
    async fn delete_entities_permanently(
        &self,
        ctx: &Context<'_>,
        entities: Vec<EntityRefInput>,
    ) -> async_graphql::Result<EntityMutationPayload<E>> {
        validate_batch(
            "deleteEntitiesPermanently",
            entities.iter().map(entity_input_key),
        )?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .delete_entities_permanently(
                    mutation_actor(ctx)?,
                    entities
                        .into_iter()
                        .map(EntityRefInput::into_model)
                        .collect(),
                )
                .await,
        ))
    }

    /// Duplicate supported entities.
    async fn duplicate_entities(
        &self,
        ctx: &Context<'_>,
        inputs: Vec<DuplicateEntityInput>,
    ) -> async_graphql::Result<EntityMutationPayload<E>> {
        validate_batch(
            "duplicateEntities",
            inputs.iter().map(|input| entity_input_key(&input.entity)),
        )?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .duplicate_entities(
                    mutation_actor(ctx)?,
                    inputs
                        .into_iter()
                        .map(DuplicateEntityInput::into_model)
                        .collect(),
                )
                .await,
        ))
    }
}
