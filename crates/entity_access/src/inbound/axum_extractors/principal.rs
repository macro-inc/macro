//! Shared capability minting for authenticated entity-message adapters.

use crate::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};
use macro_authorization::MacroAuthorization;

/// Mint a parent capability while preserving bot identity and its verified scope.
/// Identity-less internal services and harness credentials cannot impersonate a message author.
pub async fn principal_entity_access_receipt<T: RequiredPermission>(
    service: &impl EntityAccessService,
    principal: &MacroAuthorization,
    entity_id: &str,
    entity_type: EntityType,
) -> Result<EntityAccessReceipt<T>, AccessError> {
    match principal {
        MacroAuthorization::Bot(authentication) => {
            let scope = super::bot::map_bot_access_scope(authentication)
                .map_err(|_| AccessError::Unauthorized)?;
            service
                .generate_bot_entity_access_receipt::<T>(
                    authentication.bot_id,
                    scope,
                    entity_id,
                    entity_type,
                )
                .await
        }
        MacroAuthorization::User(user) | MacroAuthorization::Internal(Some(user)) => {
            service
                .generate_entity_access_receipt::<T>(
                    &user.macro_user_id,
                    user.user_context.organization_id.map(i64::from),
                    entity_id,
                    entity_type,
                )
                .await
        }
        MacroAuthorization::Internal(None) | MacroAuthorization::Harness(_) => {
            Err(AccessError::Unauthorized)
        }
    }
}
