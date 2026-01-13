use crate::tool_context::{RequestContext, ToolServiceContext};
use ai::tool::{AsyncTool, ToolCallError, ToolResult};
use async_trait::async_trait;
use comms_service_client::channels::ApiChannelType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Channel type for the AI tool response (implements JsonSchema)
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChannelTypeResponse {
    /// A public channel anyone in the org can join
    Public,
    /// An organization-wide channel
    Organization,
    /// A private channel with invited members only
    Private,
    /// A direct message between users
    DirectMessage,
}

impl From<ApiChannelType> for ChannelTypeResponse {
    fn from(ct: ApiChannelType) -> Self {
        match ct {
            ApiChannelType::Public => ChannelTypeResponse::Public,
            ApiChannelType::Organization => ChannelTypeResponse::Organization,
            ApiChannelType::Private => ChannelTypeResponse::Private,
            ApiChannelType::DirectMessage => ChannelTypeResponse::DirectMessage,
        }
    }
}

/// A channel item returned by the list channels tool
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelListItem {
    /// The channel's unique identifier
    pub id: Uuid,
    /// The channel's display name (may be None for direct messages)
    pub name: Option<String>,
    /// The type of channel (public, private, organization, or direct_message)
    pub channel_type: ChannelTypeResponse,
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
                id: c.id,
                name: c.name,
                channel_type: c.channel_type.into(),
            })
            .collect();

        let total = channel_items.len();

        Ok(ListChannelsResponse {
            channels: channel_items,
            total,
        })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use ai::generate_tool_input_schema;
    use ai::tool::types::tool_object::validate_tool_schema;

    #[test]
    fn test_list_channels_schema_validation() {
        let schema = generate_tool_input_schema!(ListChannels);

        let result = validate_tool_schema(&schema);
        assert!(result.is_ok(), "{:?}", result);

        let (name, description) = result.unwrap();
        assert_eq!(
            name, "ListChannels",
            "Tool name should match the schemars title"
        );
        assert!(
            description.contains("List all chat channels"),
            "Description should contain expected text"
        );
    }

    // run `cargo test -p ai_tools list::channel::test::print_input_schema -- --nocapture --include-ignored`
    #[test]
    #[ignore = "prints the input schema"]
    fn print_input_schema() {
        let schema = generate_tool_input_schema!(ListChannels);
        println!("{}", serde_json::to_string_pretty(&schema).unwrap());
    }

    // run `cargo test -p ai_tools list::channel::test::print_output_schema -- --nocapture --include-ignored`
    #[test]
    #[ignore = "prints the output schema"]
    fn print_output_schema() {
        let generator = ai::tool::minimized_output_schema_generator();
        let schema = generator.into_root_schema_for::<ListChannelsResponse>();
        println!("{}", serde_json::to_string_pretty(&schema).unwrap());
    }
}
