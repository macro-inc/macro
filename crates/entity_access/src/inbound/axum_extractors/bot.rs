//! Shared bot authentication mapping for entity-access extractors.

#[cfg(test)]
mod test;

use macro_authorization::{BotAuthentication, BotScope};

use super::{ExtractorError, RequiredPermission};
use crate::domain::{
    models::{BotAccessScope, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};

pub(super) fn map_bot_access_scope(
    authentication: &BotAuthentication,
) -> Result<BotAccessScope, ExtractorError> {
    match authentication.bot_scope {
        BotScope::User => {
            let acting_user = authentication.acting_user.as_ref().ok_or(
                ExtractorError::UnauthorizedWithMessage("bot user scope requires an acting user"),
            )?;

            Ok(BotAccessScope::User {
                user_id: acting_user.macro_user_id.clone(),
                user_org_id: acting_user.user_context.organization_id.map(i64::from),
            })
        }
        BotScope::Team => authentication
            .team_id
            .map(|team_id| BotAccessScope::Team { team_id })
            .ok_or(ExtractorError::Unauthorized),
    }
}

pub(super) async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
    service: &impl EntityAccessService,
    authentication: &BotAuthentication,
    entity_id: &str,
    entity_type: EntityType,
) -> Result<EntityAccessReceipt<T>, ExtractorError> {
    let scope = map_bot_access_scope(authentication)?;

    service
        .generate_bot_entity_access_receipt::<T>(
            authentication.bot_id,
            scope,
            entity_id,
            entity_type,
        )
        .await
        .map_err(ExtractorError::from)
}
