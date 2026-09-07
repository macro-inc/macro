use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::models::{PostMessageNotificationPolicy, PostMessageRequest};
use crate::domain::ports::ChannelService;
use crate::inbound::toolset::ChannelToolContext;
use entity_access::domain::ports::EntityAccessService;

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[schemars(
    title = "SendChannelMessage",
    description = "Send or reply to a channel on behalf of the user. Only use this when explicitly asked to send a message"
)]
pub struct SendChannelMessage {
    /// macro markdown
    #[schemars(
        description = "Message content in macro markdown format. This uses the same syntax as markdown documents"
    )]
    pub content: String,
    /// the channel to send to
    #[schemars(description = "The channel id to send the message to")]
    pub channel_id: Uuid,
    /// an optional thread being replied too
    #[schemars(description = "An optional thread id to reply too")]
    pub thread_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SendChannelMessageResponse {
    pub channel_id: Uuid,
    pub message_id: String,
}

impl ToolAnnotated for SendChannelMessage {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Send channel message");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for SendChannelMessage
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = SendChannelMessageResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let access = service_context
            .entity_access_service
            .generate_bot_entity_access_receipt::<messages::domain::service::MessageWrite>(
                service_context.actor,
                entity_access::domain::models::BotAccessScope::user(
                    request_context.user_id.clone(),
                ),
                &self.channel_id.to_string(),
                entity_access::domain::models::EntityType::Channel,
            )
            .await
            .map_err(super::channel_access_error)?;
        let triggered_by = Some(request_context.user_id.as_ref().to_string());

        let req = PostMessageRequest {
            content: self.content.clone(),
            mentions: vec![],
            attachments: vec![],
            nonce: None,
            notification_policy: PostMessageNotificationPolicy::Default,
            thread_id: self.thread_id,
            triggered_by,
        };

        service_context
            .messages
            .post_message(access, req)
            .await
            .map_err(tool_err("failed to send message"))
            .map(|response| SendChannelMessageResponse {
                channel_id: self.channel_id,
                message_id: response.id,
            })
    }
}

fn tool_err(
    description: &'static str,
) -> impl FnOnce(crate::domain::ports::ChannelMutationErr) -> ToolCallError {
    move |err| ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::Error::new(err),
    }
}
