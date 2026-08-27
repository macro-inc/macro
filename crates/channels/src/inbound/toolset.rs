//! AI tools for reading channel messages and mutating channel membership.

mod create_channel;
mod manage_channel_participants;
mod read_channel_message_context;
mod read_channel_messages;
mod read_channel_thread;
mod rename_channel;
mod send_channel_message;
mod types;

#[cfg(test)]
mod test;

use crate::{
    domain::{models::Sender, ports::ChannelMutationErr, ports::ChannelService},
    inbound::toolset::{
        create_channel::CreateChannel, manage_channel_participants::ManageChannelParticipants,
        rename_channel::RenameChannel, send_channel_message::SendChannelMessage,
    },
};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, AdminParticipantRole, EntityAccessReceipt, EntityType,
        MemberParticipantRole, RequiredPermission,
    },
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use uuid::Uuid;

pub use read_channel_message_context::{
    ReadChannelMessageContext, ReadChannelMessageContextResponse,
};
pub use read_channel_messages::{ReadChannelMessages, ReadChannelMessagesResponse};
pub use read_channel_thread::{ReadChannelThread, ReadChannelThreadResponse};

/// Service context for channel AI tools.
pub struct ChannelToolContext<Svc, AccessSvc>
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    /// Channel message service used to read timelines, resolve messages, and fetch threads.
    pub service: Arc<Svc>,
    /// Entity access service used to ensure the caller is a channel member.
    pub entity_access_service: Arc<AccessSvc>,
}

impl<Svc, AccessSvc> Clone for ChannelToolContext<Svc, AccessSvc>
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

impl<Svc, AccessSvc> ChannelToolContext<Svc, AccessSvc>
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    /// Create a new channel tool context.
    pub fn new(service: Svc, entity_access_service: AccessSvc) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
        }
    }

    /// Require that the request user is an active member of the channel before reading it.
    pub async fn require_channel_member(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
    ) -> Result<(), ToolCallError> {
        self.entity_access_service
            .check_access(
                Some(&*request_context.user_id),
                &channel_id.to_string(),
                EntityType::Channel,
                AccessLevel::View,
            )
            .await
            .map(|_| ())
            .map_err(channel_access_error)
    }

    /// Mint the same admin receipt HTTP uses before renaming a channel.
    pub async fn require_channel_admin(
        &self,
        request_context: &RequestContext,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<AdminParticipantRole>, ToolCallError> {
        self.channel_receipt(request_context, channel_id, ChannelReceiptKind::Admin)
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
    Admin,
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
            ChannelReceiptKind::Admin,
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
        ) => "you need channel admin access to rename this channel",
        (
            ChannelReceiptKind::Member,
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
        ) => "you must be a member of the channel to change its participants",
        (_, AccessError::NotFound(_)) => "channel not found",
        (_, AccessError::BadRequest(_)) => "invalid channel id",
        (ChannelReceiptKind::Admin, AccessError::Unavailable(_) | AccessError::Internal(_)) => {
            "failed to verify channel admin access"
        }
        (ChannelReceiptKind::Member, AccessError::Unavailable(_) | AccessError::Internal(_)) => {
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
        .add_tool::<CreateChannel, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<RenameChannel, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<ManageChannelParticipants, ChannelToolContext<Svc, AccessSvc>>()
}
