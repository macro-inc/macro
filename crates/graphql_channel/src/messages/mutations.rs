//! GraphQL writes of channel messages: post, edit, delete and react, with
//! the REST routes' rules and events, safe for a client to send again.

use async_graphql::{Context, ID, InputObject, Object, OneofObject, SimpleObject};
use messages::domain::{
    models::{NewAttachment, PostMessage, SimpleMention},
    ports::{AttachmentChange, MessagePatch, Sequenced},
};

use super::{
    ChannelMessagesGraphqlContext, GraphqlChannelMessage, coded, input_id, message_error,
    writes::{Reaction, WrittenMessage},
};

/// An entity a message mentions.
#[derive(InputObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelMentionInput")]
pub struct GraphqlChannelMentionInput {
    /// Kind of the mentioned entity.
    pub entity_type: String,
    /// Identifier of the mentioned entity.
    pub entity_id: String,
}

impl From<GraphqlChannelMentionInput> for SimpleMention {
    fn from(mention: GraphqlChannelMentionInput) -> Self {
        Self {
            entity_type: mention.entity_type,
            entity_id: mention.entity_id,
        }
    }
}

/// An entity to attach to a message.
#[derive(InputObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelAttachmentInput")]
pub struct GraphqlChannelAttachmentInput {
    /// Kind of the attached entity.
    pub entity_type: String,
    /// Identifier of the attached entity.
    pub entity_id: String,
    /// Pixel width, for media.
    pub width: Option<i32>,
    /// Pixel height, for media.
    pub height: Option<i32>,
}

impl From<GraphqlChannelAttachmentInput> for NewAttachment {
    fn from(attachment: GraphqlChannelAttachmentInput) -> Self {
        Self {
            entity_type: attachment.entity_type,
            entity_id: attachment.entity_id,
            width: attachment.width,
            height: attachment.height,
        }
    }
}

/// Attachments to remove from a message and attachments to add to it.
#[derive(InputObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelAttachmentDeltaInput")]
pub struct GraphqlChannelAttachmentDeltaInput {
    /// `attachmentId`s of the attachments to remove.
    pub remove: Vec<ID>,
    /// Attachments to append.
    pub add: Vec<GraphqlChannelAttachmentInput>,
}

/// How an edit changes a message's attachments.
#[derive(OneofObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelAttachmentChangeInput")]
pub enum GraphqlChannelAttachmentChangeInput {
    /// Replace every attachment with these.
    Replace(Vec<GraphqlChannelAttachmentInput>),
    /// Remove some attachments and append others.
    Delta(GraphqlChannelAttachmentDeltaInput),
}

impl GraphqlChannelAttachmentChangeInput {
    /// The domain change this input spells.
    fn into_change(self) -> async_graphql::Result<AttachmentChange> {
        Ok(match self {
            Self::Replace(attachments) => {
                AttachmentChange::Replace(attachments.into_iter().map(Into::into).collect())
            }
            Self::Delta(delta) => AttachmentChange::Delta {
                remove: delta
                    .remove
                    .into_iter()
                    .map(|id| input_id(id, "attachments.delta.remove"))
                    .collect::<async_graphql::Result<_>>()?,
                add: delta.add.into_iter().map(Into::into).collect(),
            },
        })
    }
}

/// A message to post in a channel: a root, or a reply to one.
#[derive(InputObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelPostMessageInput")]
pub struct GraphqlChannelPostMessageInput {
    /// The channel to post in.
    pub channel_id: ID,
    /// Client-minted UUIDv7 for the message, stamped within a day of the
    /// server clock. Posting an id the caller already posted in this channel
    /// and thread returns that message with a null `seq`; another holder's id
    /// is a `CONFLICT`. The server mints one when absent, and then a resent
    /// post posts again.
    pub id: Option<ID>,
    /// Macro Markdown body.
    pub content: String,
    /// The root to reply to; absent posts a root.
    pub thread_id: Option<ID>,
    /// Mentions tracked by the editor.
    #[graphql(default)]
    pub mentions: Vec<GraphqlChannelMentionInput>,
    /// Attachments.
    #[graphql(default)]
    pub attachments: Vec<GraphqlChannelAttachmentInput>,
    /// Client nonce echoed to realtime listeners.
    pub nonce: Option<String>,
}

/// An edit of a channel message. An absent field keeps its current value.
#[derive(InputObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelEditMessageInput")]
pub struct GraphqlChannelEditMessageInput {
    /// The message's channel.
    pub channel_id: ID,
    /// The message to edit.
    pub message_id: ID,
    /// Replacement body.
    pub content: Option<String>,
    /// Replacement mentions.
    pub mentions: Option<Vec<GraphqlChannelMentionInput>>,
    /// How the attachments change.
    pub attachments: Option<GraphqlChannelAttachmentChangeInput>,
    /// Client nonce echoed to realtime listeners.
    pub nonce: Option<String>,
}

/// A channel message to delete.
#[derive(InputObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelDeleteMessageInput")]
pub struct GraphqlChannelDeleteMessageInput {
    /// The message's channel.
    pub channel_id: ID,
    /// The message to delete. A message already deleted returns its
    /// tombstone with a null `seq`.
    pub message_id: ID,
    /// Client nonce echoed to realtime listeners.
    pub nonce: Option<String>,
}

/// The caller's reaction to add to or remove from a channel message.
#[derive(InputObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelReactInput")]
pub struct GraphqlChannelReactInput {
    /// The message's channel.
    pub channel_id: ID,
    /// The message to react to.
    pub message_id: ID,
    /// The emoji.
    pub emoji: String,
    /// Add when true, remove when false. A reaction already as asked returns
    /// the message with a null `seq`.
    pub add: bool,
    /// Client nonce echoed to realtime listeners.
    pub nonce: Option<String>,
}

/// A channel message write: the message after it, and the sequence number
/// it took in the channel's change log.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelMessageWrite")]
pub struct GraphqlChannelMessageWrite {
    /// The written message as the channel's reads show it: a root as a
    /// timeline page does, with its thread, a reply as a thread page does.
    /// A deleted root the timeline no longer shows comes without its thread.
    pub message: GraphqlChannelMessage,
    /// The channel change sequence number the write took; null when this
    /// call wrote nothing, as when it repeated a write that already happened.
    pub seq: Option<i64>,
}

impl From<Sequenced<WrittenMessage>> for GraphqlChannelMessageWrite {
    fn from(written: Sequenced<WrittenMessage>) -> Self {
        Self {
            message: match written.value {
                WrittenMessage::Root { item, call } => GraphqlChannelMessage::root(*item, call),
                WrittenMessage::Bare(message) => GraphqlChannelMessage::reply(*message),
            },
            seq: written.seq,
        }
    }
}

/// Channel message writes for the request's caller.
#[derive(Default)]
pub struct ChannelMessageMutationRoot;

/// The request's channel message context and the caller it acts for.
fn caller_context<'a>(
    ctx: &Context<'a>,
) -> async_graphql::Result<(
    &'a ChannelMessagesGraphqlContext,
    macro_authorization::MacroAuthorization,
)> {
    let context = ctx.data::<ChannelMessagesGraphqlContext>()?;
    let caller = context
        .caller
        .clone()
        .ok_or_else(|| coded("authentication required", "FORBIDDEN"))?;
    Ok((context, caller))
}

/// Channel message writes for the request's caller.
#[Object]
impl ChannelMessageMutationRoot {
    /// Post a message in a channel, at most once per client-minted `id`.
    #[tracing::instrument(
        skip_all,
        fields(
            channel_id = %input.channel_id.as_str(),
            message_id = input.id.as_ref().map_or("", |id| id.as_str()),
        ),
        err(Debug)
    )]
    async fn post_channel_message(
        &self,
        ctx: &Context<'_>,
        input: GraphqlChannelPostMessageInput,
    ) -> async_graphql::Result<GraphqlChannelMessageWrite> {
        let (context, caller) = caller_context(ctx)?;
        let channel_id = input_id(input.channel_id, "channelId")?;
        let post = PostMessage {
            attribution: Default::default(),
            notification_policy: Default::default(),
            id: input.id.map(|id| input_id(id, "id")).transpose()?,
            content: input.content,
            thread_id: input
                .thread_id
                .map(|id| input_id(id, "threadId"))
                .transpose()?,
            anchor: None,
            mentions: input.mentions.into_iter().map(Into::into).collect(),
            attachments: input.attachments.into_iter().map(Into::into).collect(),
            nonce: input.nonce,
        };
        let written = context
            .writes
            .post(caller, channel_id, post)
            .await
            .map_err(message_error)?;
        Ok(written.into())
    }

    /// Edit a channel message.
    #[tracing::instrument(
        skip_all,
        fields(
            channel_id = %input.channel_id.as_str(),
            message_id = %input.message_id.as_str(),
        ),
        err(Debug)
    )]
    async fn edit_channel_message(
        &self,
        ctx: &Context<'_>,
        input: GraphqlChannelEditMessageInput,
    ) -> async_graphql::Result<GraphqlChannelMessageWrite> {
        let (context, caller) = caller_context(ctx)?;
        let channel_id = input_id(input.channel_id, "channelId")?;
        let message_id = input_id(input.message_id, "messageId")?;
        let patch = MessagePatch {
            content: input.content,
            mentions: input
                .mentions
                .map(|mentions| mentions.into_iter().map(Into::into).collect()),
            attachments: input
                .attachments
                .map(GraphqlChannelAttachmentChangeInput::into_change)
                .transpose()?
                .unwrap_or_default(),
            nonce: input.nonce,
            notification_policy: Default::default(),
        };
        let written = context
            .writes
            .edit(caller, channel_id, message_id, patch)
            .await
            .map_err(message_error)?;
        Ok(written.into())
    }

    /// Delete a channel message, leaving its tombstone.
    #[tracing::instrument(
        skip_all,
        fields(
            channel_id = %input.channel_id.as_str(),
            message_id = %input.message_id.as_str(),
        ),
        err(Debug)
    )]
    async fn delete_channel_message(
        &self,
        ctx: &Context<'_>,
        input: GraphqlChannelDeleteMessageInput,
    ) -> async_graphql::Result<GraphqlChannelMessageWrite> {
        let (context, caller) = caller_context(ctx)?;
        let channel_id = input_id(input.channel_id, "channelId")?;
        let message_id = input_id(input.message_id, "messageId")?;
        let written = context
            .writes
            .delete(caller, channel_id, message_id, input.nonce)
            .await
            .map_err(message_error)?;
        Ok(written.into())
    }

    /// Add or remove the caller's reaction to a channel message.
    #[tracing::instrument(
        skip_all,
        fields(
            channel_id = %input.channel_id.as_str(),
            message_id = %input.message_id.as_str(),
        ),
        err(Debug)
    )]
    async fn react_to_channel_message(
        &self,
        ctx: &Context<'_>,
        input: GraphqlChannelReactInput,
    ) -> async_graphql::Result<GraphqlChannelMessageWrite> {
        let (context, caller) = caller_context(ctx)?;
        let channel_id = input_id(input.channel_id, "channelId")?;
        let message_id = input_id(input.message_id, "messageId")?;
        let reaction = Reaction {
            emoji: input.emoji,
            add: input.add,
            nonce: input.nonce,
        };
        let written = context
            .writes
            .react(caller, channel_id, message_id, reaction)
            .await
            .map_err(message_error)?;
        Ok(written.into())
    }
}
