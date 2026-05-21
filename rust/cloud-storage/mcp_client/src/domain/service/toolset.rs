use crate::domain::models::{Error, McpServer, McpServerRecord};
use crate::domain::ports::McpConnector;
use ai_toolset::{
    AsyncToolCollection, RequestContext, RequestSchema, ToolCallError, ToolInfo, ToolResult,
    ToolSet, ToolSetError,
};
use rmcp::RoleClient;
use rmcp::model::{CallToolRequestParams, CallToolResult, Tool};
use rmcp::service::Peer;
use schemars::Schema;
use std::collections::BTreeMap;
use std::pin::Pin;
use std::sync::Arc;

const MANGLED_PREFIX: &str = "mcp__";
const MANGLED_SEPARATOR: &str = "__";

/// A mangled tool name in the format `mcp__<server>__<tool>`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct MangledName(String);

impl MangledName {
    fn new(server_name: &str, tool_name: &str) -> Self {
        Self(format!(
            "{MANGLED_PREFIX}{server_name}{MANGLED_SEPARATOR}{tool_name}"
        ))
    }

    fn parse(s: &str) -> Option<(&str, &str)> {
        s.strip_prefix(MANGLED_PREFIX)?
            .split_once(MANGLED_SEPARATOR)
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for MangledName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

struct RegisteredTool {
    peer: Peer<RoleClient>,
    tool: Tool,
}

/// Dispatches tool calls to connected MCP servers using name-mangled routing.
///
/// Every tool is exposed as `mcp__<server_name>__<tool_name>` to guarantee
/// uniqueness across servers.
pub struct McpToolSet {
    tools: BTreeMap<MangledName, RegisteredTool>,
    /// Kept alive so the background transport tasks aren't cancelled.
    _connections: Vec<McpServer>,
}

impl McpToolSet {
    /// Connect to every server in `records` concurrently, discover tools, and
    /// register them.
    ///
    /// Servers that fail to connect or list tools are silently skipped.
    #[tracing::instrument(skip_all)]
    pub async fn new(records: &[McpServerRecord]) -> Self {
        let futs = records
            .iter()
            .filter(|r| r.enabled)
            .map(|record| async move {
                let client = record.connect().await.inspect_err(|e| {
                    tracing::warn!(server = %record.server_name, error = ?e, "failed to connect");
                }).ok()?;

                let server_tools = match client.list_all_tools().await {
                    Ok(t) => t,
                    Err(e) => {
                        tracing::warn!(server = %record.server_name, error = ?e, "failed to list tools");
                        let _ = client.cancel().await;
                        return None;
                    }
                };

                Some((record.server_name.clone(), client, server_tools))
            });

        let results = futures::future::join_all(futs).await;

        let mut tools = BTreeMap::new();
        let mut connections = Vec::new();
        for (server_name, client, server_tools) in results.into_iter().flatten() {
            for tool in server_tools {
                let mangled = MangledName::new(&server_name, &tool.name);

                if tools.contains_key(&mangled) {
                    tracing::warn!(%mangled, "skipping duplicate tool");
                    continue;
                }

                tools.insert(
                    mangled,
                    RegisteredTool {
                        peer: client.peer().clone(),
                        tool,
                    },
                );
            }
            connections.push(client);
        }

        Self {
            tools,
            _connections: connections,
        }
    }

    /// Returns `true` when no tools were discovered.
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    #[tracing::instrument(skip(self, arguments), err)]
    async fn call_tool(
        &self,
        name: &str,
        arguments: serde_json::Map<String, serde_json::Value>,
    ) -> Result<CallToolResult, Error> {
        let key = MangledName(name.to_owned());
        let entry = self
            .tools
            .get(&key)
            .ok_or_else(|| Error::UnknownTool(name.to_owned()))?;

        let params = CallToolRequestParams::new(entry.tool.name.clone()).with_arguments(arguments);

        entry
            .peer
            .call_tool(params)
            .await
            .map_err(|e| Error::ToolCall(e.to_string()))
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for McpToolSet {
    fn try_tool_call<'a>(
        &'a self,
        _context: Context,
        _request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>,
    > {
        Box::pin(async move {
            let arguments = match json {
                serde_json::Value::Object(map) => map.clone(),
                _ => serde_json::Map::new(),
            };

            let result = match self.call_tool(tool_name, arguments).await {
                Ok(result) => result,
                Err(Error::UnknownTool(name)) => {
                    return Err(ToolSetError::NotFound(name));
                }
                Err(e) => {
                    let description = e.to_string();
                    return Ok(Err(ToolCallError {
                        internal_error: anyhow::anyhow!("{}", &description),
                        description,
                    }));
                }
            };

            let text = result
                .content
                .into_iter()
                .filter_map(|c| c.raw.as_text().map(|t| t.text.clone()))
                .collect::<Vec<_>>()
                .join("");

            if result.is_error.unwrap_or(false) {
                Ok(Err(ToolCallError {
                    internal_error: anyhow::anyhow!("{}", &text),
                    description: text,
                }))
            } else {
                Ok(Ok(serde_json::Value::String(text)))
            }
        })
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        let schemas: Vec<_> = self
            .tools
            .iter()
            .map(|(mangled, entry)| RequestSchema {
                name: mangled.as_str().to_string(),
                schema: Schema::from((*entry.tool.input_schema).clone()),
            })
            .collect();

        if schemas.is_empty() {
            None
        } else {
            Some(schemas)
        }
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        let (server_name, original_name) = MangledName::parse(tool_name)?;
        let key = MangledName(tool_name.to_owned());
        let display_name = self
            .tools
            .get(&key)
            .and_then(|entry| entry.tool.title.clone());
        Some(ToolInfo::ExternalTool {
            service_name: server_name.to_owned(),
            tool_name: original_name.to_owned(),
            display_name,
        })
    }
}

/// Wraps a static [`AsyncToolCollection`] and an optional [`McpToolSet`],
/// presenting them as a single toolset to the AI loop.
pub struct CombinedToolSet<T> {
    static_tools: Arc<AsyncToolCollection<T>>,
    mcp_tools: McpToolSet,
}

impl<T> CombinedToolSet<T> {
    /// Build a combined toolset from the static tools and the user's MCP servers.
    pub async fn new(
        static_tools: Arc<AsyncToolCollection<T>>,
        records: &[McpServerRecord],
    ) -> Self {
        let mcp_tools = McpToolSet::new(records).await;
        Self {
            static_tools,
            mcp_tools,
        }
    }
}

impl<T: Send + Sync + 'static> ToolSet<T> for CombinedToolSet<T> {
    fn try_tool_call<'a>(
        &'a self,
        context: T,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>,
    > {
        if tool_name.starts_with(MANGLED_PREFIX) {
            self.mcp_tools
                .try_tool_call(context, request_context, tool_name, json)
        } else {
            self.static_tools
                .try_tool_call(context, request_context, tool_name, json)
        }
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        let mut schemas = self.static_tools.request_schemas().unwrap_or_default();
        schemas.extend(
            <McpToolSet as ToolSet<T>>::request_schemas(&self.mcp_tools).unwrap_or_default(),
        );
        if schemas.is_empty() {
            None
        } else {
            Some(schemas)
        }
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        if tool_name.starts_with(MANGLED_PREFIX) {
            <McpToolSet as ToolSet<T>>::routing_description(&self.mcp_tools, tool_name)
        } else {
            self.static_tools.routing_description(tool_name)
        }
    }
}
