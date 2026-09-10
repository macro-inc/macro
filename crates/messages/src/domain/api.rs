//! One capability-checked message boundary for every caller and parent.

use super::{models::*, ports::*, service::*};
use entity_access::domain::models::EntityAccessReceipt;
use uuid::Uuid;

/// Conversation reads under a verified parent capability.
#[cfg_attr(feature = "test-utils", mockall::automock)]
#[async_trait::async_trait]
pub trait MessageReader: Send + Sync + 'static {
    /// Read an individual message under its parent's view permission.
    async fn get(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
    ) -> Result<Message, MessageError>;
    /// Read the root, state, and ordered replies of a discussion.
    async fn get_thread(
        &self,
        access: EntityAccessReceipt<MessageView>,
        root: Uuid,
    ) -> Result<MessageThread, MessageError>;
    /// Read a page of discussions on an authorized parent.
    async fn timeline(
        &self,
        access: EntityAccessReceipt<MessageView>,
        query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError>;

    /// Read live history preceding a prompt, scoped by its parent.
    async fn preceding(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
        limit: u16,
    ) -> Result<Vec<Message>, MessageError>;
    /// Read an old link under current parent access.
    async fn resolve_legacy(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: i64,
        is_thread: bool,
    ) -> Result<Message, MessageError>;
    /// Discover accessible source threads mentioning the authorized document.
    async fn referenced_threads(
        &self,
        access: EntityAccessReceipt<MessageView>,
        cursor: Option<MessageCursor>,
        limit: u16,
    ) -> Result<ReferencedThreadPage, MessageError>;
}

/// Conversation mutations under a verified actor and parent capability.
#[cfg_attr(feature = "test-utils", mockall::automock)]
#[async_trait::async_trait]
pub trait MessageCommands: Send + Sync + 'static {
    /// Post as the principal carried by the verified capability.
    async fn post(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        input: PostMessage,
    ) -> Result<Message, MessageError>;
    /// Apply partial body, mention, and attachment changes under the common policy.
    async fn patch(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        input: MessagePatch,
    ) -> Result<Message, MessageError>;
    /// Tombstone a message under the common authorship and moderation policy.
    async fn delete(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        nonce: Option<String>,
    ) -> Result<Message, MessageError>;
    /// Change the authenticated actor's reaction.
    async fn react(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        emoji: String,
        add: bool,
        nonce: Option<String>,
    ) -> Result<Message, MessageError>;
    /// Publish ephemeral typing to the authorized conversation.
    async fn typing(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root: Option<Uuid>,
        active: bool,
        nonce: Option<String>,
    ) -> Result<(), MessageError>;
    /// Update document discussion state or detach removed Markdown text.
    async fn patch_thread(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root_id: Uuid,
        patch: ThreadPatch,
    ) -> Result<ThreadState, MessageError>;
    /// Delete a discussion under the common moderation policy.
    async fn delete_thread(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root_id: Uuid,
        nonce: Option<String>,
    ) -> Result<ThreadState, MessageError>;
}

/// Combined application boundary for adapters that need both reads and commands.
pub trait MessageServiceApi: MessageReader + MessageCommands {}

impl<T: MessageReader + MessageCommands> MessageServiceApi for T {}

#[async_trait::async_trait]
impl<R: MessageRepository, E: MessageEventPublisher> MessageReader for MessageService<R, E> {
    async fn get(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
    ) -> Result<Message, MessageError> {
        MessageService::get(self, access, id).await
    }
    async fn get_thread(
        &self,
        access: EntityAccessReceipt<MessageView>,
        root: Uuid,
    ) -> Result<MessageThread, MessageError> {
        MessageService::get_thread(self, access, root).await
    }
    async fn timeline(
        &self,
        access: EntityAccessReceipt<MessageView>,
        query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError> {
        MessageService::timeline(self, access, query).await
    }

    async fn preceding(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
        limit: u16,
    ) -> Result<Vec<Message>, MessageError> {
        MessageService::preceding(self, access, id, limit).await
    }
    async fn resolve_legacy(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: i64,
        is_thread: bool,
    ) -> Result<Message, MessageError> {
        MessageService::resolve_legacy(self, access, id, is_thread).await
    }
    async fn referenced_threads(
        &self,
        access: EntityAccessReceipt<MessageView>,
        cursor: Option<MessageCursor>,
        limit: u16,
    ) -> Result<ReferencedThreadPage, MessageError> {
        MessageService::referenced_threads(self, access, cursor, limit).await
    }
}

#[async_trait::async_trait]
impl<R: MessageRepository, E: MessageEventPublisher> MessageCommands for MessageService<R, E> {
    async fn post(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        input: PostMessage,
    ) -> Result<Message, MessageError> {
        MessageService::post(self, access, input).await
    }
    async fn patch(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        input: MessagePatch,
    ) -> Result<Message, MessageError> {
        MessageService::patch(self, access, id, input).await
    }
    async fn delete(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        nonce: Option<String>,
    ) -> Result<Message, MessageError> {
        MessageService::delete(self, access, id, nonce).await
    }
    async fn react(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        emoji: String,
        add: bool,
        nonce: Option<String>,
    ) -> Result<Message, MessageError> {
        MessageService::react(self, access, id, emoji, add, nonce).await
    }
    async fn typing(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root: Option<Uuid>,
        active: bool,
        nonce: Option<String>,
    ) -> Result<(), MessageError> {
        MessageService::typing(self, access, root, active, nonce).await
    }
    async fn patch_thread(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root_id: Uuid,
        patch: ThreadPatch,
    ) -> Result<ThreadState, MessageError> {
        MessageService::patch_thread(self, access, root_id, patch).await
    }
    async fn delete_thread(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root_id: Uuid,
        nonce: Option<String>,
    ) -> Result<ThreadState, MessageError> {
        MessageService::delete_thread(self, access, root_id, nonce).await
    }
}

#[cfg(feature = "test-utils")]
mockall::mock! {
    /// Test double for an adapter that uses both application capabilities.
    pub MessageServiceApi {}
    #[async_trait::async_trait]
    impl MessageReader for MessageServiceApi {
    /// Read an individual message under its parent's view permission.
    async fn get(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
    ) -> Result<Message, MessageError>;
    /// Read the root, state, and ordered replies of a discussion.
    async fn get_thread(
        &self,
        access: EntityAccessReceipt<MessageView>,
        root: Uuid,
    ) -> Result<MessageThread, MessageError>;
    /// Read a page of discussions on an authorized parent.
    async fn timeline(
        &self,
        access: EntityAccessReceipt<MessageView>,
        query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError>;

    /// Read live history preceding a prompt, scoped by its parent.
    async fn preceding(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
        limit: u16,
    ) -> Result<Vec<Message>, MessageError>;
    /// Read an old link under current parent access.
    async fn resolve_legacy(&self, access: EntityAccessReceipt<MessageView>, id: i64, is_thread: bool) -> Result<Message, MessageError>;
    /// Discover accessible source threads mentioning the authorized document.
    async fn referenced_threads(&self, access: EntityAccessReceipt<MessageView>, cursor: Option<MessageCursor>, limit: u16) -> Result<ReferencedThreadPage, MessageError>;
    }
    #[async_trait::async_trait]
    impl MessageCommands for MessageServiceApi {
    /// Post as the principal carried by the verified capability.
    async fn post(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        input: PostMessage,
    ) -> Result<Message, MessageError>;
    /// Apply partial body, mention, and attachment changes under the common policy.
    async fn patch(&self, access: EntityAccessReceipt<MessageWrite>, id: Uuid, input: MessagePatch) -> Result<Message, MessageError>;
    /// Tombstone a message under the common authorship and moderation policy.
    async fn delete(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        nonce: Option<String>,
    ) -> Result<Message, MessageError>;
    /// Change the authenticated actor's reaction.
    async fn react(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        emoji: String,
        add: bool,
        nonce: Option<String>,
    ) -> Result<Message, MessageError>;
    /// Publish ephemeral typing to the authorized conversation.
    async fn typing(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root: Option<Uuid>,
        active: bool,
        nonce: Option<String>,
    ) -> Result<(), MessageError>;    /// Update document discussion state or detach removed Markdown text.
    async fn patch_thread(&self, access: EntityAccessReceipt<MessageWrite>, root_id: Uuid, patch: ThreadPatch) -> Result<ThreadState, MessageError>;
    /// Delete a discussion under the common moderation policy.
    async fn delete_thread(&self, access: EntityAccessReceipt<MessageWrite>, root_id: Uuid, nonce: Option<String>) -> Result<ThreadState, MessageError>;
    }
}
