//! Toolset inbound adapter for chats.

mod read_chat;

#[cfg(test)]
mod test;

use crate::domain::ports::ChatService;
use ai_toolset::AsyncToolCollection;
use entity_access::domain::ports::EntityAccessService;
use read_chat::ReadChat;
use std::sync::Arc;
use uuid::Uuid;

/// Service context for chat AI tools.
pub struct ChatToolContext<CSvc, ESvc>
where
    CSvc: ChatService,
    ESvc: EntityAccessService,
{
    /// The chat service — used to read chat data with access checks.
    pub service: Arc<CSvc>,
    /// The entity access service — used to generate access receipts.
    pub entity_access_service: Arc<ESvc>,
    /// Entity id of the chat this request belongs to, when the request is an
    /// interactive chat session. `None` for every other feature, in which
    /// case reads are never blocked as "the current chat".
    pub self_chat_id: Option<Uuid>,
}

impl<CSvc, ESvc> Clone for ChatToolContext<CSvc, ESvc>
where
    CSvc: ChatService,
    ESvc: EntityAccessService,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            self_chat_id: self.self_chat_id,
        }
    }
}

impl<CSvc, ESvc> ChatToolContext<CSvc, ESvc>
where
    CSvc: ChatService,
    ESvc: EntityAccessService,
{
    /// Create a new chat tool context.
    pub fn new(service: CSvc, entity_access_service: ESvc) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
            self_chat_id: None,
        }
    }
}

/// Create a chat toolset.
pub fn chat_toolset<CSvc, ESvc>() -> AsyncToolCollection<ChatToolContext<CSvc, ESvc>>
where
    CSvc: ChatService,
    ESvc: EntityAccessService,
{
    AsyncToolCollection::new().add_tool::<ReadChat, ChatToolContext<CSvc, ESvc>>()
}
