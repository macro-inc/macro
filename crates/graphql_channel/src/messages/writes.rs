//! The channel message writes the GraphQL mutations resolve through.

use std::{future::Future, pin::Pin, sync::Arc};

use entity_access::{
    domain::{
        models::{AccessError, EntityAccessReceipt, EntityType},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::{
        message_sender_entity_access_receipt, principal_entity_access_receipt,
    },
};
use macro_authorization::MacroAuthorization;
use messages::{
    domain::{
        models::{Message, PostMessage},
        ports::{MessageError, MessageEventPublisher, MessagePatch, MessageRepository, Sequenced},
        service::{MessageService, MessageWrite},
    },
    inbound::axum_router::sender_attribution,
};
use uuid::Uuid;

/// A boxed write, so the port stays object-safe.
pub(crate) type WriteFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, MessageError>> + Send + 'a>>;

/// Object-safe view of the message writes, so request data does not carry
/// the service's type parameters. Each write authorizes `caller` for the
/// channel as the REST message routes do, and returns the message the write
/// itself returned, never read again, with the sequence number the write
/// took, none when it wrote nothing.
pub(crate) trait ChannelMessageWrites: Send + Sync {
    /// Post a message once per client-minted id.
    fn post(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        input: PostMessage,
    ) -> WriteFuture<'_, Sequenced<Message>>;

    /// Edit a message.
    fn edit(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        message_id: Uuid,
        patch: MessagePatch,
    ) -> WriteFuture<'_, Sequenced<Message>>;

    /// Delete a message; deleting a deleted message returns its tombstone.
    fn delete(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        message_id: Uuid,
        nonce: Option<String>,
    ) -> WriteFuture<'_, Sequenced<Message>>;

    /// Add or remove the caller's reaction.
    fn react(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        message_id: Uuid,
        reaction: Reaction,
    ) -> WriteFuture<'_, Sequenced<Message>>;
}

/// A reaction change, as the REST reaction route takes it.
#[derive(Debug, Clone)]
pub(crate) struct Reaction {
    /// The emoji.
    pub(crate) emoji: String,
    /// Add when true, remove when false.
    pub(crate) add: bool,
    /// Client nonce echoed to realtime listeners.
    pub(crate) nonce: Option<String>,
}

/// Writes over the real services.
pub(crate) struct ServiceWrites<R, E, A> {
    /// The message domain service.
    pub(crate) service: Arc<MessageService<R, E>>,
    /// Mints the write receipt each write requires.
    pub(crate) access: Arc<A>,
}

impl<R, E, A> ServiceWrites<R, E, A>
where
    R: MessageRepository,
    E: MessageEventPublisher,
    A: EntityAccessService,
{
    /// The caller's write receipt for the channel, minted as the REST
    /// message routes mint it: a new post keeps a code-mode agent's
    /// attribution, every other write acts as the caller.
    async fn receipt(
        &self,
        caller: &MacroAuthorization,
        channel_id: Uuid,
        as_sender: bool,
    ) -> Result<EntityAccessReceipt<MessageWrite>, MessageError> {
        let channel_id = channel_id.to_string();
        let receipt = if as_sender {
            message_sender_entity_access_receipt::<MessageWrite>(
                self.access.as_ref(),
                caller,
                &channel_id,
                EntityType::Channel,
            )
            .await
        } else {
            principal_entity_access_receipt::<MessageWrite>(
                self.access.as_ref(),
                caller,
                &channel_id,
                EntityType::Channel,
            )
            .await
        };
        receipt.map_err(|error| match error {
            AccessError::Unavailable(error) | AccessError::Internal(error) => {
                MessageError::Repository(error)
            }
            _ => MessageError::Forbidden,
        })
    }
}

impl<R, E, A> ChannelMessageWrites for ServiceWrites<R, E, A>
where
    R: MessageRepository + 'static,
    E: MessageEventPublisher + 'static,
    A: EntityAccessService + 'static,
{
    fn post(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        mut input: PostMessage,
    ) -> WriteFuture<'_, Sequenced<Message>> {
        Box::pin(async move {
            let access = self.receipt(&caller, channel_id, true).await?;
            input.attribution = sender_attribution(&caller);
            self.service.post_once(access, input).await
        })
    }

    fn edit(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        message_id: Uuid,
        patch: MessagePatch,
    ) -> WriteFuture<'_, Sequenced<Message>> {
        Box::pin(async move {
            let access = self.receipt(&caller, channel_id, false).await?;
            self.service
                .patch_sequenced(access, message_id, patch)
                .await
        })
    }

    fn delete(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        message_id: Uuid,
        nonce: Option<String>,
    ) -> WriteFuture<'_, Sequenced<Message>> {
        Box::pin(async move {
            let access = self.receipt(&caller, channel_id, false).await?;
            self.service.delete_once(access, message_id, nonce).await
        })
    }

    fn react(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        message_id: Uuid,
        reaction: Reaction,
    ) -> WriteFuture<'_, Sequenced<Message>> {
        Box::pin(async move {
            let access = self.receipt(&caller, channel_id, false).await?;
            self.service
                .react_sequenced(
                    access,
                    message_id,
                    reaction.emoji,
                    reaction.add,
                    reaction.nonce,
                )
                .await
        })
    }
}
