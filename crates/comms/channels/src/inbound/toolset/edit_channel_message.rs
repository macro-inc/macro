use super::{ChannelToolContext, message_mutation_error};
use crate::domain::ports::ChannelService;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use messages::domain::ports::MessagePatch;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Response from [`EditChannelMessage`].
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditChannelMessageResponse {
    /// Channel containing the message.
    pub channel_id: Uuid,
    /// Edited message.
    pub message_id: Uuid,
    /// Human-readable result summary.
    pub summary: String,
}

/// Replace the content of an existing channel message.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "EditChannelMessage",
    description = "Replace the content of an existing channel message or thread reply. Only the message's author can edit it, so this edits messages the user sent and messages this assistant sent for them; channel admins and owners may also edit others' messages. Find message ids with ReadChannelMessages or ReadChannelThread. Use only when the user asks to edit or correct a message."
)]
pub struct EditChannelMessage {
    /// Channel containing the message.
    #[schemars(description = "Channel id containing the message.")]
    pub channel_id: Uuid,
    /// Message to edit.
    #[schemars(description = "Id of the message to edit.")]
    pub message_id: Uuid,
    /// Replacement body.
    #[schemars(
        description = "The full replacement message content in macro markdown format. This replaces the whole message, not a fragment of it."
    )]
    pub content: String,
}

impl ToolAnnotated for EditChannelMessage {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Edit channel message").with_idempotent();
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for EditChannelMessage
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = EditChannelMessageResponse;

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
        if self.content.trim().is_empty() {
            return Err(ToolCallError {
                description:
                    "message content must not be empty; use DeleteChannelMessage to remove a message"
                        .to_string(),
                internal_error: anyhow::anyhow!("empty channel message edit"),
            });
        }
        let access = service_context
            .require_message_author_write(&request_context, self.channel_id, self.message_id)
            .await?;
        service_context
            .messages
            .patch(
                access,
                self.message_id,
                MessagePatch {
                    content: Some(self.content.clone()),
                    ..MessagePatch::default()
                },
            )
            .await
            .map_err(message_mutation_error("edit this message"))?;

        Ok(EditChannelMessageResponse {
            channel_id: self.channel_id,
            message_id: self.message_id,
            summary: "Edited the message.".to_string(),
        })
    }
}
