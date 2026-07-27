use std::{borrow::Cow, collections::HashSet, marker::PhantomData, sync::Arc};

use async_graphql::{Context, Enum, ErrorExtensions, ID, InputObject, Object, SimpleObject, Union};
use cowlike::CowLike;
use entity_mutation::{
    DuplicateEntityRequest, EntityMutationActor, EntityMutationErrorCode, EntityMutationService,
    EntityMutationSuccess, MoveEntityRequest, MutateEntitiesResult, RenameEntityRequest,
    UpdateEntitySharePolicyRequest,
};
use graphql_common::{GraphqlEntity, GraphqlEntityType};
use graphql_permission::GraphqlEntityAccessLevel;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::{
    UpdateSharePermissionRequestV2,
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
        let entity_type = EntityType::from(entity_type);
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
pub struct EntityMutationRoot<S> {
    /// Associates the GraphQL adapter with its domain service.
    _service: PhantomData<fn() -> S>,
}

impl<S> EntityMutationRoot<S> {
    /// Construct the entity mutation root.
    pub fn new() -> Self {
        Self {
            _service: PhantomData,
        }
    }
}

impl<S> Default for EntityMutationRoot<S> {
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

impl From<EntityRefInput> for Entity<'static> {
    fn from(value: EntityRefInput) -> Self {
        EntityType::from(value.entity_type).with_entity_string(value.id.0)
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

impl From<RenameEntityInput> for RenameEntityRequest {
    fn from(value: RenameEntityInput) -> Self {
        Self {
            entity: value.entity.into(),
            display_name: value.display_name,
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

impl From<MoveEntityInput> for MoveEntityRequest {
    fn from(value: MoveEntityInput) -> Self {
        Self {
            entity: value.entity.into(),
            project_id: value.project_id.map(|id| id.0),
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

impl From<DuplicateEntityInput> for DuplicateEntityRequest {
    fn from(value: DuplicateEntityInput) -> Self {
        Self {
            entity: value.entity.into(),
            display_name: value.display_name,
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

impl From<GraphqlSharePolicyOperation> for UpdateOperation {
    fn from(value: GraphqlSharePolicyOperation) -> Self {
        match value {
            GraphqlSharePolicyOperation::Add => Self::Add,
            GraphqlSharePolicyOperation::Remove => Self::Remove,
            GraphqlSharePolicyOperation::Replace => Self::Replace,
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

impl From<ChannelSharePolicyInput> for UpdateChannelSharePermission {
    fn from(value: ChannelSharePolicyInput) -> Self {
        Self {
            operation: value.operation.into(),
            channel_id: value.channel_id.0,
            access_level: value.access_level.map(Into::into),
        }
    }
}

/// Shared public/channel share-policy update.
#[derive(InputObject)]
pub struct EntitySharePolicyInput {
    /// Whether public access should be enabled.
    pub is_public: Option<bool>,
    /// Public access level when public access is enabled.
    pub public_access_level: Option<GraphqlEntityAccessLevel>,
    /// Channel access entries to add, remove, or replace.
    pub channel_share_permissions: Option<Vec<ChannelSharePolicyInput>>,
}

impl From<EntitySharePolicyInput> for UpdateSharePermissionRequestV2 {
    fn from(value: EntitySharePolicyInput) -> Self {
        Self {
            is_public: value.is_public,
            public_access_level: value.public_access_level.map(Into::into),
            channel_share_permissions: value
                .channel_share_permissions
                .map(|entries| entries.into_iter().map(Into::into).collect()),
        }
    }
}

/// One share-policy update in a batch.
#[derive(InputObject)]
pub struct UpdateEntitySharePolicyInput {
    /// Entity whose share policy should change.
    pub entity: EntityRefInput,
    /// New public/channel policy values.
    pub policy: EntitySharePolicyInput,
}

impl From<UpdateEntitySharePolicyInput> for UpdateEntitySharePolicyRequest {
    fn from(value: UpdateEntitySharePolicyInput) -> Self {
        Self {
            entity: value.entity.into(),
            policy: value.policy.into(),
        }
    }
}

/// Validate conditional fields required by public and channel share updates.
fn validate_share_policy_inputs(
    inputs: &[UpdateEntitySharePolicyInput],
) -> async_graphql::Result<()> {
    for input in inputs {
        if input.policy.is_public == Some(true) && input.policy.public_access_level.is_none() {
            return Err(invalid_request(
                "publicAccessLevel is required when public access is enabled",
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

impl From<EntityMutationErrorCode> for GraphqlEntityMutationErrorCode {
    fn from(value: EntityMutationErrorCode) -> Self {
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

/// Embedded canonical entity reference returned by mutation payloads.
///
/// `entityId` is deliberately not named `id`: this object references another
/// entity and must not itself become a normalized cache record.
#[derive(Clone, SimpleObject)]
pub struct GraphqlEntityMutationRef {
    /// Entity kind.
    #[graphql(name = "type")]
    pub entity_type: GraphqlEntityType,
    /// Canonical entity id.
    pub entity_id: ID,
}

impl From<Entity<'static>> for GraphqlEntityMutationRef {
    fn from(value: Entity<'static>) -> Self {
        let entity_type = GraphqlEntityType::from(value.entity_type);
        Self {
            entity_type,
            entity_id: ID(value.entity_id.into_owned()),
        }
    }
}

struct GraphqlMutationSuccess<'a>(Cow<'a, [Entity<'a>]>);

#[Object]
impl<'a> GraphqlMutationSuccess<'a> {
    async fn affected_entities(&self) -> Vec<GraphqlEntity<'_>> {
        self.0
            .iter()
            .map(CowLike::copied)
            .map(GraphqlEntity)
            .collect()
    }
}

struct GraphqlMutationError(EntityMutationErrorCode);

#[Object]
impl GraphqlMutationError {
    async fn error_code(&self) -> GraphqlEntityMutationErrorCode {
        self.0.into()
    }

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
pub enum GraphqlEntityMutationResult<'a> {
    /// the request succeeded
    ///
    Success(GraphqlMutationSuccess<'a>),
    /// the request failed
    Error(GraphqlMutationError),
}

impl<'a> GraphqlEntityMutationResult<'a> {
    fn new(x: Result<&'a EntityMutationSuccess<'a>, &'a EntityMutationErrorCode>) -> Self {
        match x {
            Ok(r) => GraphqlEntityMutationResult::Success(GraphqlMutationSuccess(Cow::Borrowed(
                &r.affected_entities,
            ))),
            Err(e) => GraphqlEntityMutationResult::Error(GraphqlMutationError(*e)),
        }
    }
}

impl GraphqlEntityMutationResult<'static> {
    fn new_static(x: Result<EntityMutationSuccess<'static>, EntityMutationErrorCode>) -> Self {
        match x {
            Ok(r) => GraphqlEntityMutationResult::Success(GraphqlMutationSuccess(Cow::Owned(
                r.affected_entities,
            ))),
            Err(e) => GraphqlEntityMutationResult::Error(GraphqlMutationError(e)),
        }
    }
}

/// Batch mutation payload. Results preserve input order and allow partial
/// success across independently stored entity kinds.
pub struct EntityMutationPayload {
    /// Per-input mutation outcomes.
    results: Vec<MutateEntitiesResult<'static>>,
}

impl EntityMutationPayload {
    fn new(results: Vec<MutateEntitiesResult<'static>>) -> Self {
        EntityMutationPayload { results }
    }
}

#[Object]
impl EntityMutationPayload {
    async fn results<'a>(&'a self) -> Vec<GraphqlEntityMutationResult<'a>> {
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
impl<S: EntityMutationService> EntityMutationRoot<S> {
    /// Rename heterogeneous entities in one request.
    async fn rename_entities(
        &self,
        ctx: &Context<'_>,
        inputs: Vec<RenameEntityInput>,
    ) -> async_graphql::Result<EntityMutationPayload> {
        validate_batch(
            "renameEntities",
            inputs.iter().map(|input| entity_input_key(&input.entity)),
        )?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .rename_entities(
                    mutation_actor(ctx)?,
                    inputs.into_iter().map(Into::into).collect(),
                )
                .await,
        ))
    }

    /// Move heterogeneous entities to a project or to the root.
    async fn move_entities(
        &self,
        ctx: &Context<'_>,
        inputs: Vec<MoveEntityInput>,
    ) -> async_graphql::Result<EntityMutationPayload> {
        validate_batch(
            "moveEntities",
            inputs.iter().map(|input| entity_input_key(&input.entity)),
        )?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .move_entities(
                    mutation_actor(ctx)?,
                    inputs.into_iter().map(Into::into).collect(),
                )
                .await,
        ))
    }

    /// Update public and channel share policies across supported entity kinds.
    async fn update_entity_share_policies(
        &self,
        ctx: &Context<'_>,
        inputs: Vec<UpdateEntitySharePolicyInput>,
    ) -> async_graphql::Result<EntityMutationPayload> {
        validate_batch(
            "updateEntitySharePolicies",
            inputs.iter().map(|input| entity_input_key(&input.entity)),
        )?;
        validate_share_policy_inputs(&inputs)?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .update_share_policies(
                    mutation_actor(ctx)?,
                    inputs.into_iter().map(Into::into).collect(),
                )
                .await,
        ))
    }

    /// Soft-delete entities with a reversible trash lifecycle.
    async fn trash_entities(
        &self,
        ctx: &Context<'_>,
        entities: Vec<EntityRefInput>,
    ) -> async_graphql::Result<EntityMutationPayload> {
        validate_batch("trashEntities", entities.iter().map(entity_input_key))?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .trash_entities(
                    mutation_actor(ctx)?,
                    entities.into_iter().map(Into::into).collect(),
                )
                .await,
        ))
    }

    /// Restore reversibly deleted entities.
    async fn restore_entities(
        &self,
        ctx: &Context<'_>,
        entities: Vec<EntityRefInput>,
    ) -> async_graphql::Result<EntityMutationPayload> {
        validate_batch("restoreEntities", entities.iter().map(entity_input_key))?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .restore_entities(
                    mutation_actor(ctx)?,
                    entities.into_iter().map(Into::into).collect(),
                )
                .await,
        ))
    }

    /// Irreversibly delete entities.
    async fn delete_entities_permanently(
        &self,
        ctx: &Context<'_>,
        entities: Vec<EntityRefInput>,
    ) -> async_graphql::Result<EntityMutationPayload> {
        validate_batch(
            "deleteEntitiesPermanently",
            entities.iter().map(entity_input_key),
        )?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .delete_entities_permanently(
                    mutation_actor(ctx)?,
                    entities.into_iter().map(Into::into).collect(),
                )
                .await,
        ))
    }

    /// Duplicate supported entities.
    async fn duplicate_entities(
        &self,
        ctx: &Context<'_>,
        inputs: Vec<DuplicateEntityInput>,
    ) -> async_graphql::Result<EntityMutationPayload> {
        validate_batch(
            "duplicateEntities",
            inputs.iter().map(|input| entity_input_key(&input.entity)),
        )?;
        Ok(EntityMutationPayload::new(
            mutation_service::<S>(ctx)?
                .duplicate_entities(
                    mutation_actor(ctx)?,
                    inputs.into_iter().map(Into::into).collect(),
                )
                .await,
        ))
    }

    /// Add or remove an entity from the actor's favorites.
    async fn set_entity_favorite(
        &self,
        ctx: &Context<'_>,
        entity: EntityRefInput,
        favorite: bool,
    ) -> async_graphql::Result<GraphqlEntityMutationResult<'static>> {
        let res = mutation_service::<S>(ctx)?
            .set_favorite(mutation_actor(ctx)?, entity.into(), favorite)
            .await;

        Ok(GraphqlEntityMutationResult::new_static(res))
    }
}
