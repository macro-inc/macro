//! Current capabilities and local delivery for built-in message agents.
use crate::domain::ports::ConversationAccess;
use async_trait::async_trait;
use entity_access::domain::{
    models::{BotAccessScope, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    events::MessagePostedMetadata,
    models::MessageParent,
    ports::{MessageChange, MessageEvent, MessageEventPublisher},
    service::MessageWrite,
};
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
    async fn user_write(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>, rootcause::Report> {
        Ok(self
            .0
            .generate_entity_access_receipt(user, None, &parent.entity_id(), entity_type(parent))
            .await?)
    }
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

/// Observe the same committed message stream used by external and hosted agents.
#[derive(Clone)]
pub struct LocalBotPublisher {
    triggers: tokio::sync::mpsc::UnboundedSender<MessagePostedMetadata>,
}

impl LocalBotPublisher {
    /// Attach the built-in responder to common message delivery.
    pub fn new(triggers: tokio::sync::mpsc::UnboundedSender<MessagePostedMetadata>) -> Self {
        Self { triggers }
    }
}

impl MessageEventPublisher for LocalBotPublisher {
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        if let MessageChange::Posted {
            message, mentions, ..
        } = &event.change
            && message.sender_id.as_user().is_some()
        {
            self.triggers
                .send(MessagePostedMetadata::from_message(
                    message,
                    mentions.clone(),
                ))
                .map_err(|error| rootcause::report!(error).into())
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod test;
