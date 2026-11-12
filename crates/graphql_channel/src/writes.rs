//! Channel message writes for a person's own session, replayable by the
//! device's durable mutation queue.
use async_graphql::{Context, ID, InputObject, Object};
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use graphql_common::require_authenticated_user;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MessageCommands,
    models::{Message, NewAttachment, PostMessage, SimpleMention},
    ports::{AttachmentChange, MessagePatch},
    service::{MessageView, MessageWrite},
};
use std::{future::Future, pin::Pin};
use uuid::Uuid;

use crate::{
    ChannelGraphqlContext, GraphqlChannelMessage, bad_input, message_error, parse_read_id,
};

/// Who a GraphQL request writes channel messages as, set by the mounting
/// adapter from the verified credential.
#[derive(Clone, Copy, Debug)]
pub struct ChannelWriteActor {
    /// The caller's organization, as REST passes it to entity access.
    pub organization_id: Option<i64>,
    /// Whether a person is acting through their own session. API tokens and
    /// agents acting for a person carry attribution only REST can sign.
    pub human_session: bool,
}

/// Receipt future used by the request-scoped write authorizer.
type WriteAccessFuture<'a> = Pin<
    Box<dyn Future<Output = Result<EntityAccessReceipt<MessageWrite>, AccessError>> + Send + 'a>,
>;

/// Object-safe channel write authorization, using REST's capability.
pub(crate) trait ChannelWriteAccess: Send + Sync {
    /// Mint the write receipt for the authenticated person and channel.
    fn authorize_write(
        &self,
        user: MacroUserIdStr<'static>,
        organization_id: Option<i64>,
        channel_id: Uuid,
    ) -> WriteAccessFuture<'_>;
}

impl<A: EntityAccessService> ChannelWriteAccess for A {
    fn authorize_write(
        &self,
        user: MacroUserIdStr<'static>,
        organization_id: Option<i64>,
        channel_id: Uuid,
    ) -> WriteAccessFuture<'_> {
        Box::pin(async move {
            self.generate_entity_access_receipt::<MessageWrite>(
                &user,
                organization_id,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
        })
    }
}

/// An entity mentioned in a message body.
#[derive(InputObject)]
pub struct ChannelMentionInput {
    /// Mentioned entity type.
    pub entity_type: String,
    /// Mentioned entity identifier.
    pub entity_id: String,
}

/// An entity attached to a message.
#[derive(InputObject)]
pub struct ChannelAttachmentInput {
    /// Attached entity type.
    pub entity_type: String,
    /// Attached entity identifier.
    pub entity_id: String,
    /// Optional media width.
    pub width: Option<i32>,
    /// Optional media height.
    pub height: Option<i32>,
}

impl From<ChannelMentionInput> for SimpleMention {
    fn from(value: ChannelMentionInput) -> Self {
        Self {
            entity_type: value.entity_type,
            entity_id: value.entity_id,
        }
    }
}

impl From<ChannelAttachmentInput> for NewAttachment {
    fn from(value: ChannelAttachmentInput) -> Self {
        Self {
            entity_type: value.entity_type,
            entity_id: value.entity_id,
            width: value.width,
            height: value.height,
        }
    }
}

/// A new channel message or thread reply.
#[derive(InputObject)]
pub struct SendChannelMessageInput {
    /// Channel to post to.
    pub channel_id: ID,
    /// Client-minted UUIDv7; the message's final identity. Sending the same
    /// id again returns the stored message.
    pub id: ID,
    /// Message body in Macro Markdown.
    pub content: String,
    /// Root message to reply to; absent for a root.
    pub thread_id: Option<ID>,
    /// Mentions tracked by the editor.
    #[graphql(default)]
    pub mentions: Vec<ChannelMentionInput>,
    /// Initial attachments.
    #[graphql(default)]
    pub attachments: Vec<ChannelAttachmentInput>,
    /// Echoed on the realtime event so the sender can recognize its own write.
    pub nonce: Option<String>,
}

/// A change to an existing channel message.
#[derive(InputObject)]
pub struct EditChannelMessageInput {
    /// Channel containing the message.
    pub channel_id: ID,
    /// Message to edit.
    pub id: ID,
    /// Replacement body; absent keeps the current one.
    pub content: Option<String>,
    /// Replacement mentions; absent keeps the current ones.
    pub mentions: Option<Vec<ChannelMentionInput>>,
    /// Stored attachment ids to remove.
    #[graphql(default)]
    pub remove_attachment_ids: Vec<ID>,
    /// Attachments to append.
    #[graphql(default)]
    pub add_attachments: Vec<ChannelAttachmentInput>,
    /// Echoed on the realtime event.
    pub nonce: Option<String>,
}

/// A channel message to delete.
#[derive(InputObject)]
pub struct DeleteChannelMessageInput {
    /// Channel containing the message.
    pub channel_id: ID,
    /// Message to delete. Deleting it again returns the tombstone.
    pub id: ID,
    /// Echoed on the realtime event.
    pub nonce: Option<String>,
}

/// The caller's reaction to set or clear on a channel message.
#[derive(InputObject)]
pub struct ReactToChannelMessageInput {
    /// Channel containing the message.
    pub channel_id: ID,
    /// Message to react to.
    pub id: ID,
    /// Emoji.
    pub emoji: String,
    /// Add when true, remove when false. Repeating either changes nothing.
    pub add: bool,
    /// Echoed on the realtime event.
    pub nonce: Option<String>,
}

/// Channel message mutations. Each returns the message as the reads do, a
/// root with its thread summary.
#[derive(Clone, Copy, Debug, Default)]
pub struct ChannelMessageMutationRoot;

/// The message service and write receipt for one authorized mutation.
struct AuthorizedWrite<'a> {
    /// The request's channel context, for reading the result back.
    context: &'a ChannelGraphqlContext,
    /// The REST message service.
    commands: &'a dyn MessageCommands,
    /// Capability for the caller on the channel.
    access: EntityAccessReceipt<MessageWrite>,
    /// The same capability, for reading a written root's thread summary.
    view: EntityAccessReceipt<MessageView>,
    /// The channel written to.
    channel_id: Uuid,
}

impl AuthorizedWrite<'_> {
    /// Map the committed message as the reads return it.
    async fn written(
        context: &ChannelGraphqlContext,
        view: EntityAccessReceipt<MessageView>,
        channel_id: Uuid,
        message: Message,
    ) -> async_graphql::Result<GraphqlChannelMessage> {
        context.written(view, message, channel_id).await
    }
}

/// Authorize the request's person to write messages in a channel.
async fn authorize<'a>(
    ctx: &'a Context<'_>,
    channel_id: ID,
) -> async_graphql::Result<AuthorizedWrite<'a>> {
    let user = require_authenticated_user(ctx)?;
    let channel_id = parse_read_id(channel_id, "channelId")?;
    tracing::Span::current().record("channel_id", tracing::field::display(channel_id));
    let actor = ctx
        .data_opt::<ChannelWriteActor>()
        .copied()
        .filter(|actor| actor.human_session)
        .ok_or_else(|| {
            use async_graphql::ErrorExtensions;
            async_graphql::Error::new("channel message mutations require a personal session")
                .extend_with(|_, e| e.set("code", "FORBIDDEN"))
        })?;
    let context = ctx.data::<ChannelGraphqlContext>()?;
    let (commands, access) = context
        .authorize_write(user, actor.organization_id, channel_id)
        .await?;
    let view = access
        .clone()
        .try_into_requirement::<MessageView>()
        .map_err(|_| {
            use async_graphql::ErrorExtensions;
            async_graphql::Error::new("forbidden").extend_with(|_, e| e.set("code", "FORBIDDEN"))
        })?;
    Ok(AuthorizedWrite {
        context,
        view,
        commands,
        access,
        channel_id,
    })
}

#[Object]
impl ChannelMessageMutationRoot {
    /// Post a message or thread reply once under the caller's channel access.
    #[tracing::instrument(
        name = "channel.send_message",
        skip_all,
        err(Debug),
        fields(channel_id = tracing::field::Empty, message_id = tracing::field::Empty)
    )]
    async fn send_channel_message(
        &self,
        ctx: &Context<'_>,
        input: SendChannelMessageInput,
    ) -> async_graphql::Result<GraphqlChannelMessage> {
        let write = authorize(ctx, input.channel_id).await?;
        let id = parse_read_id(input.id, "id")?;
        tracing::Span::current().record("message_id", tracing::field::display(id));
        let thread_id = input
            .thread_id
            .map(|id| parse_read_id(id, "threadId"))
            .transpose()?;
        let message = write
            .commands
            .post_once(
                write.access,
                PostMessage {
                    attribution: Default::default(),
                    notification_policy: Default::default(),
                    id: Some(id),
                    content: input.content,
                    thread_id,
                    anchor: None,
                    mentions: input.mentions.into_iter().map(Into::into).collect(),
                    attachments: input.attachments.into_iter().map(Into::into).collect(),
                    nonce: input.nonce,
                },
            )
            .await
            .map_err(message_error)?;
        AuthorizedWrite::written(write.context, write.view, write.channel_id, message).await
    }

    /// Edit a message the caller wrote or may moderate.
    #[tracing::instrument(
        name = "channel.edit_message",
        skip_all,
        err(Debug),
        fields(channel_id = tracing::field::Empty, message_id = tracing::field::Empty)
    )]
    async fn edit_channel_message(
        &self,
        ctx: &Context<'_>,
        input: EditChannelMessageInput,
    ) -> async_graphql::Result<GraphqlChannelMessage> {
        let write = authorize(ctx, input.channel_id).await?;
        let id = parse_read_id(input.id, "id")?;
        tracing::Span::current().record("message_id", tracing::field::display(id));
        let remove = input
            .remove_attachment_ids
            .into_iter()
            .map(|id| parse_read_id(id, "removeAttachmentIds"))
            .collect::<async_graphql::Result<Vec<_>>>()?;
        let attachments = if remove.is_empty() && input.add_attachments.is_empty() {
            AttachmentChange::Preserve
        } else {
            AttachmentChange::Delta {
                remove,
                add: input.add_attachments.into_iter().map(Into::into).collect(),
            }
        };
        if input.content.is_none()
            && input.mentions.is_none()
            && matches!(attachments, AttachmentChange::Preserve)
        {
            return Err(bad_input("an edit needs a change"));
        }
        let message = write
            .commands
            .patch(
                write.access,
                id,
                MessagePatch {
                    content: input.content,
                    mentions: input
                        .mentions
                        .map(|mentions| mentions.into_iter().map(Into::into).collect()),
                    attachments,
                    nonce: input.nonce,
                    notification_policy: Default::default(),
                },
            )
            .await
            .map_err(message_error)?;
        AuthorizedWrite::written(write.context, write.view, write.channel_id, message).await
    }

    /// Delete a message, leaving the tombstone the timeline renders.
    #[tracing::instrument(
        name = "channel.delete_message",
        skip_all,
        err(Debug),
        fields(channel_id = tracing::field::Empty, message_id = tracing::field::Empty)
    )]
    async fn delete_channel_message(
        &self,
        ctx: &Context<'_>,
        input: DeleteChannelMessageInput,
    ) -> async_graphql::Result<GraphqlChannelMessage> {
        let write = authorize(ctx, input.channel_id).await?;
        let id = parse_read_id(input.id, "id")?;
        tracing::Span::current().record("message_id", tracing::field::display(id));
        let message = write
            .commands
            .delete_once(write.access, id, input.nonce)
            .await
            .map_err(message_error)?;
        AuthorizedWrite::written(write.context, write.view, write.channel_id, message).await
    }

    /// Set or clear the caller's reaction.
    #[tracing::instrument(
        name = "channel.react_to_message",
        skip_all,
        err(Debug),
        fields(channel_id = tracing::field::Empty, message_id = tracing::field::Empty)
    )]
    async fn react_to_channel_message(
        &self,
        ctx: &Context<'_>,
        input: ReactToChannelMessageInput,
    ) -> async_graphql::Result<GraphqlChannelMessage> {
        let write = authorize(ctx, input.channel_id).await?;
        let id = parse_read_id(input.id, "id")?;
        tracing::Span::current().record("message_id", tracing::field::display(id));
        let message = write
            .commands
            .react(write.access, id, input.emoji, input.add, input.nonce)
            .await
            .map_err(message_error)?;
        AuthorizedWrite::written(write.context, write.view, write.channel_id, message).await
    }
}
