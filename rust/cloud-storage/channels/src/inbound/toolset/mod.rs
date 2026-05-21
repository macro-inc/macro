//! AI tools for reading channel messages and threads.

mod read_channel_message_context;
mod read_channel_messages;
mod read_channel_thread;
mod types;

#[cfg(test)]
mod test;

use crate::domain::ports::ChannelMessagesService;
use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError};
use entity_access::domain::{
    models::{AccessError, AccessLevel, EntityType},
    ports::EntityAccessService,
};
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
    Svc: ChannelMessagesService,
    AccessSvc: EntityAccessService,
{
    /// Channel message service used to read timelines, resolve messages, and fetch threads.
    pub service: Arc<Svc>,
    /// Entity access service used to ensure the caller is a channel member.
    pub entity_access_service: Arc<AccessSvc>,
}

impl<Svc, AccessSvc> Clone for ChannelToolContext<Svc, AccessSvc>
where
    Svc: ChannelMessagesService,
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
    Svc: ChannelMessagesService,
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
}

fn channel_access_error(err: AccessError) -> ToolCallError {
    let description = match err {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            "user is not a member of the requested channel"
        }
        AccessError::NotFound(_) => "channel not found",
        AccessError::BadRequest(_) => "invalid channel id",
        AccessError::DatabaseError(_) | AccessError::Internal => {
            "failed to verify channel membership"
        }
    };

    ToolCallError {
        description: description.to_string(),
        internal_error: err.into(),
    }
}

/// Create the channel AI toolset.
pub fn channel_toolset<Svc, AccessSvc>() -> AsyncToolCollection<ChannelToolContext<Svc, AccessSvc>>
where
    Svc: ChannelMessagesService,
    AccessSvc: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ReadChannelMessages, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<ReadChannelMessageContext, ChannelToolContext<Svc, AccessSvc>>()
        .add_tool::<ReadChannelThread, ChannelToolContext<Svc, AccessSvc>>()
}
