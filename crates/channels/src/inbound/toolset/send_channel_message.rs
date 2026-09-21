use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::ports::ChannelService;
use crate::inbound::toolset::ChannelToolContext;
use entity_access::domain::ports::EntityAccessService;
use messages::domain::{
    models::{MessageAttribution, PostMessage, PostMessageNotificationPolicy},
    ports::MessageError,
};

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
        service_context
            .require_channel_member(&request_context, self.channel_id)
            .await?;

        // AI sends as the tool actor bot; the capability carries the requesting
        // user so the message records who triggered it and the client can render
        // a "from <user>" pill.
        let access = service_context
            .require_channel_message_write(&request_context, self.channel_id)
            .await?;

        service_context
            .messages
            .post(
                access,
                PostMessage {
                    attribution: MessageAttribution::ActingUser,
                    notification_policy: PostMessageNotificationPolicy::Default,
                    content: self.content.clone(),
                    thread_id: self.thread_id,
                    anchor: None,
                    mentions: vec![],
                    attachments: vec![],
                    nonce: None,
                },
            )
            .await
            .map_err(tool_err("failed to send message"))
            .map(|message| SendChannelMessageResponse {
                channel_id: self.channel_id,
                message_id: message.id.to_string(),
            })
    }
}

fn tool_err(description: &'static str) -> impl FnOnce(MessageError) -> ToolCallError {
    move |err| ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::Error::new(err),
    }
}
