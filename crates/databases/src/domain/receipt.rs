//! The one way a database receipt is minted for a viewer: for the acting
//! agent on the user's behalf, or for the user.

use entity_access::domain::models::{
    AccessError, BotAccessScope, EntityAccessReceipt, EntityType, RequiredPermission,
};
use entity_access::domain::ports::EntityAccessService;

use super::models::{DatabaseId, Viewer};

/// A receipt proving `viewer` holds at least `Level` on `database_id`.
pub async fn database_receipt<Level, Access>(
    entity_access: &Access,
    viewer: &Viewer,
    database_id: DatabaseId,
) -> Result<EntityAccessReceipt<Level>, AccessError>
where
    Level: RequiredPermission,
    Access: EntityAccessService,
{
    let database_id = database_id.to_string();
    match viewer.acting_bot {
        Some(bot) => {
            entity_access
                .generate_bot_entity_access_receipt::<Level>(
                    bot,
                    BotAccessScope::user(viewer.user_id.clone()),
                    &database_id,
                    EntityType::Database,
                )
                .await
        }
        None => {
            entity_access
                .generate_entity_access_receipt::<Level>(
                    &viewer.user_id,
                    None,
                    &database_id,
                    EntityType::Database,
                )
                .await
        }
    }
}
