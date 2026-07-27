//! Default [`MessageService`] implementation.

#[cfg(test)]
mod test;

use agent::types::ChatMessageContent;
use attachment::{Attachable, AttachmentService, FormattedParts};
use macro_event_broker::{MacroEventBroker, NoopMacroEventBroker};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::{AttachmentType, NewChatMessage};
use model_entity::{Entity, EntityType};
use non_empty::NonEmpty;

use crate::domain::events::{ChatMacroEvent, ChatMessageSentMetadata};
use crate::domain::models::{ChatErr, ResolvedMessageContent, Result};
use crate::domain::ports::{MessageRepo, MessageService};

/// Concrete [`MessageService`] backed by a [`MessageRepo`] and [`AttachmentService`].
pub struct MessageServiceImpl<R, A, B = NoopMacroEventBroker>
where
    B: MacroEventBroker,
{
    repo: R,
    attachment_service: A,
    event_broker: B,
}

impl<R: MessageRepo, A: AttachmentService> MessageServiceImpl<R, A> {
    /// Create a new [`MessageServiceImpl`].
    pub fn new(repo: R, attachment_service: A) -> Self {
        Self {
            repo,
            attachment_service,
            event_broker: NoopMacroEventBroker,
        }
    }
}

impl<R: MessageRepo, A: AttachmentService, B: MacroEventBroker> MessageServiceImpl<R, A, B> {
    /// Replaces the event broker while preserving the other dependencies.
    pub fn with_event_broker<B2: MacroEventBroker>(
        self,
        event_broker: B2,
    ) -> MessageServiceImpl<R, A, B2> {
        MessageServiceImpl {
            repo: self.repo,
            attachment_service: self.attachment_service,
            event_broker,
        }
    }

    fn publish_chat_event(&self, event: &ChatMacroEvent) {
        drop(self.event_broker.send_event(event).inspect_err(|error| {
            tracing::error!(error = ?error, "failed to schedule chat event");
        }));
    }

    async fn resolve_attachments(
        &self,
        user_id: &MacroUserIdStr<'_>,
        attachments: &[Entity<'_>],
    ) -> Result<Option<FormattedParts>> {
        if attachments.is_empty() {
            return Ok(None);
        }

        let entity_refs: Vec<&Entity<'_>> = attachments.iter().collect();
        let non_empty = NonEmpty::new(entity_refs.as_slice()).expect("checked non-empty above");

        let resolved = self
            .attachment_service
            .resolve_attachments(user_id.clone(), non_empty)
            .await;

        Ok(Some(resolved.into_formatted_parts()))
    }
}

impl<R: MessageRepo, A: AttachmentService, B: MacroEventBroker> MessageService
    for MessageServiceImpl<R, A, B>
{
    #[tracing::instrument(err, skip(self, message))]
    async fn create(
        &self,
        user_id: &MacroUserIdStr<'_>,
        chat_id: &str,
        message: NewChatMessage,
    ) -> Result<ResolvedMessageContent> {
        let entities: Vec<Entity<'static>> = message
            .attachments
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|a| {
                attachment_type_to_entity_type(&a.attachment_type)
                    .with_entity_string(a.attachment_id.clone())
            })
            .collect();

        let resolved = self.resolve_attachments(user_id, &entities).await?;

        let role = message.role;
        let model = message.model.clone();
        let attachment_count = message.attachments.as_deref().map(<[_]>::len).unwrap_or(0);

        let message_id = self.repo.create(chat_id, message).await?;

        if let Some(ref parts) = resolved {
            self.repo
                .store_resolved_message(&message_id, parts.clone())
                .await?;
        }

        self.publish_chat_event(&ChatMacroEvent::message_sent(ChatMessageSentMetadata {
            chat_id: chat_id.to_owned(),
            message_id: message_id.clone(),
            role: role.into(),
            model,
            actor_user_id: Some(user_id.clone().into_owned()),
            attachment_count,
        }));

        Ok(ResolvedMessageContent {
            message_id,
            parts: resolved,
        })
    }

    #[tracing::instrument(err, skip(self, message))]
    async fn store(&self, chat_id: &str, message: NewChatMessage) -> Result<String> {
        let role = message.role;
        let model = message.model.clone();
        let attachment_count = message.attachments.as_deref().map(<[_]>::len).unwrap_or(0);

        let message_id = self.repo.create(chat_id, message).await?;

        self.publish_chat_event(&ChatMacroEvent::message_sent(ChatMessageSentMetadata {
            chat_id: chat_id.to_owned(),
            message_id: message_id.clone(),
            role: role.into(),
            model,
            actor_user_id: None,
            attachment_count,
        }));

        Ok(message_id)
    }

    #[tracing::instrument(err, skip(self, content))]
    async fn update(
        &self,
        user_id: &MacroUserIdStr<'_>,
        chat_id: &str,
        message_id: &str,
        content: &ChatMessageContent,
    ) -> Result<()> {
        let messages = self.repo.get_messages(chat_id).await?;
        let msg = messages
            .iter()
            .find(|m| m.id == message_id)
            .ok_or(ChatErr::NotFound)?;

        let resolved = self.resolve_attachments(user_id, &msg.attachments).await?;

        self.repo
            .update_message_content(chat_id, message_id, content)
            .await?;

        if let Some(parts) = resolved {
            self.repo.store_resolved_message(message_id, parts).await?;
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete(&self, message_id: &str) -> Result<()> {
        self.repo.delete(message_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_resolved_message(&self, message_id: &str) -> Result<ResolvedMessageContent> {
        let parts = self.repo.get_resolved_message(message_id).await?;
        Ok(ResolvedMessageContent {
            message_id: message_id.to_owned(),
            parts: Some(parts),
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_resolved_message_chain(
        &self,
        chat_id: &str,
    ) -> Result<Vec<ResolvedMessageContent>> {
        let messages = self.repo.get_messages(chat_id).await?;
        let mut chain = Vec::new();
        for msg in &messages {
            if msg.role != agent::types::Role::User || msg.attachments.is_empty() {
                continue;
            }
            match self.repo.get_resolved_message(&msg.id).await {
                Ok(parts) => chain.push(ResolvedMessageContent {
                    message_id: msg.id.clone(),
                    parts: Some(parts),
                }),
                Err(ChatErr::NotFound) => {}
                Err(e) => return Err(e),
            }
        }
        Ok(chain)
    }
}

fn attachment_type_to_entity_type(at: &AttachmentType) -> EntityType {
    match at {
        AttachmentType::Document => EntityType::Document,
        AttachmentType::Image => EntityType::StaticFile,
        AttachmentType::Channel => EntityType::Channel,
        AttachmentType::Email => EntityType::EmailThread,
        AttachmentType::Project => EntityType::Project,
    }
}
