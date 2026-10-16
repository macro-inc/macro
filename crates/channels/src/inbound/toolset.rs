//! AI tools for reading channel messages and mutating channel membership.

mod create_channel;
mod create_channel_media_upload;
mod delete_channel_message;
mod edit_channel_message;
mod manage_channel_participants;
mod open_direct_message;
mod react_to_channel_message;
mod read_channel_message_context;
mod read_channel_messages;
mod read_channel_thread;
mod rename_channel;
mod send_channel_message;
mod share_with_channel;
mod types;

#[cfg(test)]
mod test;

use crate::{
    domain::{models::Sender, ports::ChannelMutationErr, ports::ChannelService},
    inbound::toolset::{
        create_channel::CreateChannel, delete_channel_message::DeleteChannelMessage,
        edit_channel_message::EditChannelMessage,
        manage_channel_participants::ManageChannelParticipants,
        open_direct_message::OpenDirectMessage, react_to_channel_message::ReactToChannelMessage,
        rename_channel::RenameChannel, send_channel_message::SendChannelMessage,
        share_with_channel::ShareWithChannel,
    },
};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError};
use bot_id::BotId;
use entity_access::domain::{
    models::{
        AccessError, BotAccessScope, EntityAccessReceipt, EntityType, MemberParticipantRole,
        RequiredPermission,
    },
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MessageServiceApi,
    ports::MessageError,
    service::{MessageView, MessageWrite},
};
use std::sync::Arc;
use uuid::Uuid;

pub use create_channel_media_upload::{
    ChannelMediaUploadToolContext, CreateChannelMediaUpload, CreateChannelMediaUploadResponse,
};
pub use read_channel_message_context::{
    ReadChannelMessageContext, ReadChannelMessageContextResponse,
};
pub use read_channel_messages::{ReadChannelMessages, ReadChannelMessagesResponse};
pub use read_channel_thread::{ReadChannelThread, ReadChannelThreadResponse};
pub use types::{ChannelAttachmentKind, ChannelMessageAttachmentInput};

/// Service context for channel AI tools.
pub struct ChannelToolContext<Svc, AccessSvc>
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    /// Shared message application: channel timelines, threads, and posts.
    pub messages: Arc<dyn MessageServiceApi>,
    /// Channel service used for channel metadata and membership mutations.
    pub service: Arc<Svc>,
    /// Entity access service used to ensure the caller is a channel member.
    pub entity_access_service: Arc<AccessSvc>,
    /// The bot these tools act as, on behalf of the requesting user. Defaults
    /// to Macro AI; hosts running a specific agent set it with [`Self::with_actor`].
    pub actor: BotId,
}

impl<Svc, AccessSvc> Clone for ChannelToolContext<Svc, AccessSvc>
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    fn clone(&self) -> Self {
        Self {
            messages: self.messages.clone(),
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            actor: self.actor,
        }
    }
}

impl<Svc, AccessSvc> ChannelToolContext<Svc, AccessSvc>
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    /// Create a new channel tool context.
    pub fn new(
        messages: Arc<dyn MessageServiceApi>,
        service: Svc,
        entity_access_service: AccessSvc,
    ) -> Self {
        Self {
            messages,
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
            actor: bot_id::MACRO_AI_BOT_ID,
        }
    }

    /// Mint the bot's channel write capability on behalf of the requesting user.
    pub async fn require_channel_message_write(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MessageWrite>, ToolCallError> {
        self.entity_access_service
            .generate_bot_entity_access_receipt::<MessageWrite>(
                self.actor,
                BotAccessScope::user(request_context.user_id.clone()),
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(|error| channel_receipt_error(ChannelReceiptKind::Member, error))
    }

    /// Set the bot these tools act as.
    pub fn with_actor(mut self, actor: BotId) -> Self {
        self.actor = actor;
        self
    }

    /// Mint the requesting user's own channel write capability, for actions
    /// the app attributes to the user rather than to the tool actor bot.
    pub async fn require_user_message_write(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MessageWrite>, ToolCallError> {
        self.entity_access_service
            .generate_entity_access_receipt::<MessageWrite>(
                &request_context.user_id,
                None,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(channel_access_error)
    }

    /// Mint the write capability for changing an existing message as its
    /// author: messages the tool actor bot posted are changed as the bot, and
    /// every other message as the user, so the message service applies the
    /// same authorship and moderation rules as in the app.
    pub async fn require_message_author_write(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<EntityAccessReceipt<MessageWrite>, ToolCallError> {
        let view = self
            .require_channel_member(request_context, channel_id)
            .await?;
        let message = self
            .messages
            .get(view, message_id)
            .await
            .map_err(message_mutation_error("read the message"))?;
        if message.sender_id == Sender::new_from_bot(self.actor) {
            self.require_channel_message_write(request_context, channel_id)
                .await
        } else {
            self.require_user_message_write(request_context, channel_id)
                .await
        }
    }

    /// Require that the request user is an active member of the channel before
    /// reading it, minting the read capability the message reads take.
    pub async fn require_channel_member(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MessageView>, ToolCallError> {
        self.entity_access_service
            .generate_entity_access_receipt::<MessageView>(
                &request_context.user_id,
                None,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(channel_access_error)
    }

    /// Mint a member receipt before renaming a channel.
    pub async fn require_channel_rename(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MemberParticipantRole>, ToolCallError> {
        self.channel_receipt(request_context, channel_id, ChannelReceiptKind::Rename)
            .await
    }

    /// Mint the same member receipt HTTP uses before changing participants.
    pub async fn require_channel_member_role(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MemberParticipantRole>, ToolCallError> {
        self.channel_receipt(request_context, channel_id, ChannelReceiptKind::Member)
            .await
    }

    async fn channel_receipt<P: RequiredPermission>(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
        kind: ChannelReceiptKind,
    ) -> Result<EntityAccessReceipt<P>, ToolCallError> {
        self.entity_access_service
            .generate_entity_access_receipt::<P>(
                &request_context.user_id,
                None,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(|error| channel_receipt_error(kind, error))
    }
}

#[derive(Clone, Copy)]
enum ChannelReceiptKind {
    Rename,
    Member,
}

fn channel_access_error(err: AccessError) -> ToolCallError {
    let description = match err {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            "user is not a member of the requested channel"
        }
        AccessError::NotFound(_) => "channel not found",
        AccessError::BadRequest(_) => "invalid channel id",
        AccessError::Unavailable(_) | AccessError::Internal(_) => {
            "failed to verify channel membership"
        }
    };

    ToolCallError {
        description: description.to_string(),
        internal_error: err.into(),
    }
}

fn channel_receipt_error(kind: ChannelReceiptKind, err: AccessError) -> ToolCallError {
    let description = match (kind, &err) {
        (
            ChannelReceiptKind::Rename,
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
        ) => "you must be a member of the channel to rename it",
        (
            ChannelReceiptKind::Member,
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
        ) => "you must be a member of the channel to change its participants",
        (_, AccessError::NotFound(_)) => "channel not found",
        (_, AccessError::BadRequest(_)) => "invalid channel id",
        (_, AccessError::Unavailable(_) | AccessError::Internal(_)) => {
            "failed to verify channel membership"
        }
    };

    ToolCallError {
        description: description.to_string(),
        internal_error: err.into(),
    }
}

fn user_sender<P: RequiredPermission>(
    receipt: &EntityAccessReceipt<P>,
) -> Result<Sender, ToolCallError> {
    receipt
        .get_authenticated_user()
        .cloned()
        .map(Sender::new_from_user)
        .map_err(|error| ToolCallError {
            description: "authenticated user required".to_string(),
            internal_error: error.into(),
        })
}

fn channel_mutation_error(action: &'static str, err: ChannelMutationErr) -> ToolCallError {
    let description = match &err {
        ChannelMutationErr::BadRequest(message)
        | ChannelMutationErr::Unauthorized(message)
        | ChannelMutationErr::Forbidden(message)
        | ChannelMutationErr::NotFound(message) => message.clone(),
        ChannelMutationErr::Repo(_)
        | ChannelMutationErr::Gateway(_)
        | ChannelMutationErr::Notification(_)
        | ChannelMutationErr::Contacts(_) => format!("failed to {action}"),
    };

    ToolCallError {
        description,
        internal_error: err.into(),
    }
}

/// Map a message mutation failure onto an actionable tool error.
fn message_mutation_error(action: &'static str) -> impl FnOnce(MessageError) -> ToolCallError {
    move |err| {
        let description = match &err {
            MessageError::NotFound => "message not found in this channel".to_string(),
            MessageError::Forbidden => format!(
                "not allowed to {action}: only the message's author or a channel admin or owner can change it"
            ),
            MessageError::Invalid(message) => (*message).to_string(),
            MessageError::Conflict | MessageError::Repository(_) => format!("failed to {action}"),
        };
        ToolCallError {
            description,
            internal_error: anyhow::Error::new(err),
        }
    }
}

const MAX_CHANNEL_NAME_CHARS: usize = 255;

fn channel_name(name: &str) -> Result<String, ToolCallError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ToolCallError {
            description: "channel name must not be empty".to_string(),
            internal_error: anyhow::anyhow!("empty channel name"),
        });
    }
    if trimmed.chars().count() > MAX_CHANNEL_NAME_CHARS {
        return Err(ToolCallError {
            description: format!(
                "channel name must be {MAX_CHANNEL_NAME_CHARS} characters or fewer"
            ),
            internal_error: anyhow::anyhow!("channel name exceeds {MAX_CHANNEL_NAME_CHARS} chars"),
        });
    }
    Ok(trimmed.to_string())
}

fn parse_participants(entries: &[String]) -> Result<Vec<MacroUserIdStr<'static>>, ToolCallError> {
    let mut participants = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut invalid = Vec::new();

    for (index, raw) in entries.iter().enumerate() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            invalid.push(format!("participants[{index}] is empty"));
            continue;
        }
        match parse_participant(trimmed) {
            Ok(user_id) => {
                if seen.insert(user_id.as_ref().to_string()) {
                    participants.push(user_id);
                }
            }
            Err(()) => invalid.push(format!(
                "participants[{index}] `{trimmed}` is not a user id (`macro|<email>`) or email"
            )),
        }
    }

    if !invalid.is_empty() {
        return Err(ToolCallError {
            description: invalid.join("; "),
            internal_error: anyhow::anyhow!("invalid channel participant ids"),
        });
    }

    Ok(participants)
}

fn parse_participant(raw: &str) -> Result<MacroUserIdStr<'static>, ()> {
    MacroUserIdStr::try_from(raw.to_string())
        .or_else(|_| MacroUserIdStr::try_from_email(raw))
        .map_err(|_| ())
}

fn participant_id_strings(participants: &[MacroUserIdStr<'static>]) -> Vec<String> {
    participants
        .iter()
        .map(|user_id| user_id.as_ref().to_string())
        .collect()
}

/// Create the channel AI toolset.
pub fn channel_toolset<Svc, AccessSvc>() -> AsyncToolCollection<ChannelToolContext<Svc, AccessSvc>>
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ReadChannelMessages, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<ReadChannelMessageContext, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<ReadChannelThread, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<SendChannelMessage, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<ShareWithChannel, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<CreateChannel, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<RenameChannel, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<ManageChannelParticipants, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<EditChannelMessage, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<DeleteChannelMessage, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<ReactToChannelMessage, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<OpenDirectMessage, ChannelToolContext<Svc, AccessSvc>>()
}
