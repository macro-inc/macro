//! Receipt minting and error mapping shared by the entity lifecycle tools.

use ai_toolset::{RequestContext, ToolCallError};
use entity_access::domain::models::{AccessError, EntityAccessReceipt, RequiredPermission};
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::{EntityMutationEffect, EntityMutationErrorCode};
use model_entity::{Entity, EntityType};

/// Mint the requesting user's receipt for an entity.
///
/// Lifecycle mutations (trash, duplicate, rename, sharing) run as the user,
/// like their REST and GraphQL paths: several domains read the authenticated
/// user off the receipt to record who deleted or now owns the entity.
pub(super) async fn user_receipt<T, ESvc>(
    entity_access_service: &ESvc,
    request_context: &RequestContext,
    entity: &Entity<'static>,
) -> Result<EntityAccessReceipt<T>, ToolCallError>
where
    T: RequiredPermission,
    ESvc: EntityAccessService,
{
    entity_access_service
        .generate_entity_access_receipt::<T>(
            &request_context.user_id,
            None,
            &entity.entity_id,
            entity.entity_type,
        )
        .await
        .map_err(|error| access_failed(entity.entity_type, error))
}

fn access_failed(entity_type: EntityType, error: AccessError) -> ToolCallError {
    let description = match error {
        AccessError::NotFound(_) => format!("{entity_type} not found"),
        AccessError::BadRequest(_) => format!("invalid {entity_type} id"),
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            format!("you do not have the access this action requires on the {entity_type}")
        }
        AccessError::Unavailable(_) | AccessError::Internal(_) => {
            format!("failed to verify access to the {entity_type}")
        }
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

/// Map a domain mutation failure onto an actionable tool error. `forbidden`
/// states the access the action needs for each entity kind.
pub(super) fn mutation_failed(
    action: &'static str,
    forbidden: &'static str,
) -> impl FnOnce(EntityMutationErrorCode) -> ToolCallError {
    move |code| {
        let description = match code {
            EntityMutationErrorCode::Forbidden(_) => forbidden.to_string(),
            EntityMutationErrorCode::NotFound(_) => "the item was not found".to_string(),
            EntityMutationErrorCode::Conflict(_) => {
                format!("cannot {action} the item in its current state (it may already be deleted)")
            }
            EntityMutationErrorCode::InvalidInput(_) => {
                format!("invalid request to {action} the item")
            }
            EntityMutationErrorCode::UnsupportedOperation(_) => {
                format!("cannot {action} this kind of item")
            }
            EntityMutationErrorCode::Internal(_) => format!("failed to {action} the item"),
        };
        ToolCallError {
            description,
            internal_error: anyhow::anyhow!("{action} entity failed: {code:?}"),
        }
    }
}

/// The first entity a mutation reports as updated, for mutations whose first
/// effect is the entity they produced.
pub(super) fn first_updated(effects: &[EntityMutationEffect]) -> Option<&Entity<'static>> {
    effects.iter().find_map(|effect| match effect {
        EntityMutationEffect::Updated(entity) => Some(entity),
        EntityMutationEffect::Deleted(_) => None,
    })
}
