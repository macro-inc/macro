use super::{ChannelToolContext, message_mutation_error};
use crate::domain::ports::ChannelService;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Response from [`DeleteChannelMessage`].
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteChannelMessageResponse {
    /// Channel containing the message.
    pub channel_id: Uuid,
    /// Deleted message.
    pub message_id: Uuid,
    /// Human-readable result summary.
    pub summary: String,
}

/// Delete a channel message.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteChannelMessage",
    description = "Delete a channel message or thread reply. The channel keeps a 'message deleted' placeholder; this cannot be undone. Users can delete their own messages and messages sent by bots; channel admins and owners can delete any message. Find message ids with ReadChannelMessages or ReadChannelThread. Use only when the user explicitly asks to delete a message."
)]
pub struct DeleteChannelMessage {
    /// Channel containing the message.
    #[schemars(description = "Channel id containing the message.")]
    pub channel_id: Uuid,
    /// Message to delete.
    #[schemars(description = "Id of the message to delete.")]
    pub message_id: Uuid,
}

impl ToolAnnotated for DeleteChannelMessage {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Delete channel message").with_idempotent();
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for DeleteChannelMessage
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = DeleteChannelMessageResponse;

    #[tracing::instrument(
        skip_all,
        fields(user_id=?request_context.user_id, channel_id=%self.channel_id, message_id=%self.message_id),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let access = service_context
            .require_message_author_write(&request_context, self.channel_id, self.message_id)
            .await?;
        service_context
            .messages
            .delete(access, self.message_id, None)
            .await
            .map_err(message_mutation_error("delete this message"))?;

        Ok(DeleteChannelMessageResponse {
            channel_id: self.channel_id,
            message_id: self.message_id,
            summary: "Deleted the message.".to_string(),
        })
    }
}
