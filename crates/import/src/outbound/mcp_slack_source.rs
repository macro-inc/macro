//! Live Slack workspace reads through the selected user's MCP connector.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use ai_toolset::{RequestContext, ToolSet};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::{ConnectorSelect, UserMcpTools};
use serde_json::{Value, json};

use crate::domain::models::{
    ImportSource, SlackConversationId, SlackConversationPage, SlackMemberPage, SlackUserPage,
};
use crate::domain::ports::{SlackSourceError, SlackWorkspaceSession, SlackWorkspaceSource};

mod parse;
#[cfg(test)]
mod test;

/// Opens Slack readers without depending on either connector stack's adapters.
pub struct McpSlackSource<S: ConnectorSelect> {
    select: Arc<S>,
}

impl<S: ConnectorSelect> McpSlackSource<S> {
    /// Use the host's connector selector.
    pub fn new(select: Arc<S>) -> Self {
        Self { select }
    }
}

impl<S: ConnectorSelect> SlackWorkspaceSource for McpSlackSource<S> {
    type Session = McpSlackSession;

    async fn open(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Self::Session, SlackSourceError> {
        let tools = self
            .select
            .connector_toolset(user, ImportSource::Slack.connector_ref())
            .await?
            .filter(|tools| !tools.is_empty())
            .ok_or(SlackSourceError::NotConnected)?;
        let schemas = tool_schemas(&tools);
        let channels_tool = resolve_tool(&schemas, Listing::Channels)?;
        let members_tool = resolve_tool(&schemas, Listing::Members).ok();
        let users_tool = resolve_tool(&schemas, Listing::Users).ok();
        Ok(McpSlackSession {
            tools: Arc::new(tools),
            user: user.clone(),
            channels_tool,
            members_tool,
            users_tool,
            schemas,
        })
    }
}

/// Connector tools and schemas loaded once for a gather or import batch.
pub struct McpSlackSession {
    tools: Arc<UserMcpTools>,
    user: MacroUserIdStr<'static>,
    channels_tool: String,
    members_tool: Option<String>,
    users_tool: Option<String>,
    schemas: HashMap<String, Value>,
}

impl SlackWorkspaceSession for McpSlackSession {
    async fn list_conversations(
        &self,
        cursor: Option<&str>,
    ) -> Result<SlackConversationPage, SlackSourceError> {
        let arguments = listing_arguments(&self.schemas[&self.channels_tool], cursor, None, true);
        let result = call_channels(
            self.tools.as_ref(),
            &self.user,
            &self.channels_tool,
            &arguments,
            cursor.is_none(),
        )
        .await?;
        parse::parse_slack_channel_page(result)
    }

    async fn conversation_members(
        &self,
        conversation: &SlackConversationId,
        cursor: Option<&str>,
    ) -> Result<SlackMemberPage, SlackSourceError> {
        let tool = self
            .members_tool
            .as_ref()
            .ok_or(SlackSourceError::ToolsUnavailable("members"))?;
        let schema = &self.schemas[tool];
        if !["channel", "conversation", "channel_id"]
            .iter()
            .any(|key| schema["properties"].get(key).is_some())
        {
            return Err(SlackSourceError::ToolsUnavailable("members"));
        }
        let arguments = listing_arguments(schema, cursor, Some(conversation), false);
        parse::parse_member_page(
            call_tool(self.tools.as_ref(), &self.user, tool, &arguments).await?,
        )
    }

    async fn list_users(&self, cursor: Option<&str>) -> Result<SlackUserPage, SlackSourceError> {
        let tool = self
            .users_tool
            .as_ref()
            .ok_or(SlackSourceError::ToolsUnavailable("users"))?;
        let arguments = listing_arguments(&self.schemas[tool], cursor, None, false);
        parse::parse_user_page(call_tool(self.tools.as_ref(), &self.user, tool, &arguments).await?)
    }
}

fn tool_schemas(tools: &impl ToolSet<()>) -> HashMap<String, Value> {
    ToolSet::<()>::request_schemas(tools)
        .unwrap_or_default()
        .into_iter()
        .map(|schema| (schema.name, schema.schema.to_value()))
        .collect()
}

#[derive(Clone, Copy)]
enum Listing {
    Channels,
    Members,
    Users,
}

fn resolve_tool(
    schemas: &HashMap<String, Value>,
    listing: Listing,
) -> Result<String, SlackSourceError> {
    let (action, capability) = match listing {
        Listing::Channels => ("list-channels", "channel listing"),
        Listing::Members => ("list-members-in-channel", "members"),
        Listing::Users => ("list-users", "users"),
    };
    // Sorting makes fallback selection stable across HashMap iteration order.
    let mut names: Vec<_> = schemas.keys().collect();
    names.sort();
    for prefix in ["slack_v2", "slack"] {
        let exact = format!("{prefix}-{action}");
        if let Some(name) = names.iter().find(|name| tool_suffix(name) == exact) {
            return Ok((*name).clone());
        }
    }
    names
        .into_iter()
        .find(|name| {
            let tool = tool_suffix(name).to_ascii_lowercase().replace('-', "_");
            match listing {
                Listing::Channels => is_slack_channel_search_tool_name(name),
                Listing::Members => {
                    tool.contains("member")
                        && (tool.contains("channel") || tool.contains("conversation"))
                        && (tool.contains("list") || tool.contains("get"))
                }
                Listing::Users => {
                    tool.contains("user")
                        && tool.contains("list")
                        && !["channel", "conversation", "email", "find", "group"]
                            .iter()
                            .any(|word| tool.contains(word))
                }
            }
        })
        .cloned()
        .ok_or(SlackSourceError::ToolsUnavailable(capability))
}

fn tool_suffix(name: &str) -> &str {
    name.rsplit_once("__").map_or(name, |(_, tool)| tool)
}

fn is_slack_channel_search_tool_name(name: &str) -> bool {
    let tool = tool_suffix(name).to_ascii_lowercase().replace('-', "_");
    let channel_noun = tool.contains("channel") || tool.contains("conversation");
    let listing_verb = tool.contains("search") || tool.contains("list");
    let other_surface = [
        "member", "history", "message", "canvas", "create", "user", "emoji", "file",
    ]
    .iter()
    .any(|word| tool.contains(word));
    channel_noun && listing_verb && !other_surface
}

fn listing_arguments(
    schema: &Value,
    cursor: Option<&str>,
    conversation: Option<&SlackConversationId>,
    channels: bool,
) -> Value {
    let properties = &schema["properties"];
    let mut arguments = json!({});
    if let Some(cursor) = cursor.filter(|_| properties.get("cursor").is_some()) {
        arguments["cursor"] = json!(cursor);
    }
    if properties.get("limit").is_some() {
        arguments["limit"] = json!(200);
    }
    if channels {
        if properties.get("query").is_some() {
            arguments["query"] = json!("");
        }
        if let Some(types) = properties.get("types") {
            // The provisional fixture declares a string; other tools accept arrays.
            arguments["types"] = if types["type"] == "string" {
                json!("public_channel,private_channel")
            } else {
                json!(["public_channel", "private_channel"])
            };
        }
        if properties.get("exclude_archived").is_some() {
            arguments["exclude_archived"] = json!(false);
        }
    }
    if let Some(conversation) = conversation
        && let Some(key) = ["channel", "conversation", "channel_id"]
            .into_iter()
            .find(|key| properties.get(key).is_some())
    {
        arguments[key] = json!(conversation.as_str());
    }
    arguments
}

async fn call_channels(
    tools: &impl ToolSet<()>,
    user: &MacroUserIdStr<'static>,
    name: &str,
    arguments: &Value,
    first_page: bool,
) -> Result<Value, SlackSourceError> {
    match call_tool(tools, user, name, arguments).await {
        // Some search tools reject the explicit empty query. Do not retry scope
        // failures or rate limits, or discard a continuation cursor on retry.
        Err(SlackSourceError::Other(_)) if first_page && arguments != &json!({}) => {
            call_tool(tools, user, name, &json!({})).await
        }
        result => result,
    }
}

async fn call_tool(
    tools: &impl ToolSet<()>,
    user: &MacroUserIdStr<'static>,
    name: &str,
    arguments: &Value,
) -> Result<Value, SlackSourceError> {
    ToolSet::<()>::try_tool_call(
        tools,
        (),
        RequestContext::new(user.clone()),
        name,
        arguments,
    )
    .await
    .map_err(|error| source_error(error.to_string()))?
    .map_err(|error| source_error(error.description))
}

fn source_error(text: String) -> SlackSourceError {
    let lower = text.to_ascii_lowercase();
    if ["ratelimited", "rate_limited", "429"]
        .iter()
        .any(|marker| lower.contains(marker))
    {
        static RETRY_AFTER: LazyLock<regex::Regex> =
            LazyLock::new(|| regex::Regex::new(r"retry[\s_-]+after\s*:?\s*(\d+)").unwrap());
        let retry_after = RETRY_AFTER
            .captures(&lower)
            .and_then(|capture| capture[1].parse::<u64>().ok())
            .map(Duration::from_secs);
        SlackSourceError::RateLimited { retry_after }
    } else if lower.contains("missing_scope") {
        SlackSourceError::MissingScope(text)
    } else {
        SlackSourceError::Other(anyhow::anyhow!(text))
    }
}
