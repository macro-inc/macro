//! Receipt acquisition through the owning entity-access service.
use crate::domain::authoring::{AuthoringError, Code, ports::AuthoringAccess};
use databases::domain::models::Viewer;
use entity_access::domain::{
    models::{BotAccessScope, Entity, EntityAccessReceipt, RequiredPermission},
    ports::EntityAccessService,
};
use std::sync::Arc;

/// Delegates user and bot-on-behalf checks to the shared authorization boundary.
pub struct EntityAuthoringAccess<Access>(pub Arc<Access>);
impl<A: EntityAccessService> AuthoringAccess for EntityAuthoringAccess<A> {
    async fn receipt<L: RequiredPermission>(
        &self,
        actor: &Viewer,
        entity: Entity,
    ) -> Result<EntityAccessReceipt<L>, AuthoringError> {
        let receipt = match actor.acting_bot {
            Some(bot) => {
                self.0
                    .generate_bot_entity_access_receipt::<L>(
                        bot,
                        BotAccessScope::user(actor.user_id.clone()),
                        &entity.entity_id,
                        entity.entity_type,
                    )
                    .await
            }
            None => {
                self.0
                    .generate_entity_access_receipt::<L>(
                        &actor.user_id,
                        None,
                        &entity.entity_id,
                        entity.entity_type,
                    )
                    .await
            }
        };
        receipt.map_err(|_| {
            AuthoringError::new(
                Code::Forbidden,
                "entity",
                "This actor does not have the required access to the selected form or database.",
            )
        })
    }
}
