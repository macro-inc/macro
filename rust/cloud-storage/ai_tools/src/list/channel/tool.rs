use crate::tool_context::{RequestContext, ToolServiceContext};
use ai_toolset::{AsyncTool, ToolCallError, ToolResult};
use async_trait::async_trait;
use model::comms::ChannelType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A channel item returned by the list channels tool
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelListItem {
    /// The channel's unique identifier
    pub id: Uuid,
    /// The channel's display name (may be None for direct messages)
    pub name: Option<String>,
    /// The type of channel (public, private, organization, or direct_message)
    pub channel_type: ChannelType,
}

/// Response from listing channels
#[derive(Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListChannelsResponse {
    /// The list of channels the user has access to
    pub channels: Vec<ChannelListItem>,
    /// Total number of channels returned
    pub total: usize,
}

/// List channels tool - lists all channels the user has access to
#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "List all chat channels the user has access to. Returns channel names, IDs, and types. Use this tool to discover available channels for reading messages or participating in conversations.",
    title = "ListChannels"
)]
pub struct ListChannels {
    #[serde(default)]
    _unused: (),
}

#[async_trait]
impl AsyncTool<ToolServiceContext, RequestContext> for ListChannels {
    type Output = ListChannelsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        context: ToolServiceContext,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("List channels");

        let channels = context
            .scribe
            .channel
            .list_channels(&request_context.jwt_token)
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to list channels: {}", e),
                internal_error: e,
            })?;

        let channel_items: Vec<ChannelListItem> = channels
            .into_iter()
            .map(|c| ChannelListItem {
                id: c.id.0,
                name: c.name,
                channel_type: c.channel_type,
            })
            .collect();

        let total = channel_items.len();

        Ok(ListChannelsResponse {
            channels: channel_items,
            total,
        })
    }
}
