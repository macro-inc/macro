//! Current parent capabilities for built-in agent replies.
use crate::domain::ports::ConversationAccess;
use async_trait::async_trait;
use entity_access::domain::{
    models::{BotAccessScope, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{models::MessageParent, service::MessageWrite};
use std::sync::Arc;

/// Mint current parent capabilities through the standard access service.
pub struct EntityAccessConversation<A>(pub Arc<A>);

fn entity_type(parent: &MessageParent) -> EntityType {
    match parent {
        MessageParent::Channel(_) => EntityType::Channel,
        MessageParent::Document(_) => EntityType::Document,
    }
}

#[async_trait]
impl<A: EntityAccessService> ConversationAccess for EntityAccessConversation<A> {
    async fn bot_write(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>, rootcause::Report> {
        Ok(self
            .0
            .generate_bot_entity_access_receipt(
                bot_id::MACRO_AI_BOT_ID,
                BotAccessScope::user(user.clone()),
                &parent.entity_id(),
                entity_type(parent),
            )
            .await?)
    }
}
