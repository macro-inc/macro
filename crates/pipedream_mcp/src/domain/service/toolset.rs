use crate::domain::CallToolResultExt;
use crate::domain::models::{Error, MacroUserIdStr, McpServer, PipedreamConnection};
use crate::domain::ports::McpConnection;
use ai_toolset::{
    RequestContext, RequestSchema, SearchableTool, ToolCallError, ToolInfo, ToolResult, ToolSet,
    ToolSetError,
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
pub struct PipedreamToolSet {
    tools: BTreeMap<MangledName, RegisteredTool>,
    /// Kept alive so the background transport tasks aren't cancelled.
    _connections: Vec<McpServer>,
    /// The owning user, for correlating tool-call failures in logs. All
    /// records passed to [`PipedreamToolSet::new`] belong to one user in practice.
    user_id: Option<MacroUserIdStr<'static>>,
}

impl PipedreamToolSet {
    /// Connect to every app in `records` concurrently, discover tools, and
    /// register them. Connections go through `connection` (Pipedream's
    /// remote MCP server), which injects each account's credentials
    /// server-side.
    ///
    /// Apps that fail to connect or list tools are silently skipped.
    #[tracing::instrument(skip_all)]
    pub async fn new<C: McpConnection>(
        records: &[PipedreamConnection],
        connection: Arc<C>,
    ) -> Self {
        let user_id = records.first().map(|r| r.user_id.clone());

        let futs = records.iter().filter(|r| r.enabled).map(|record| {
            let connection = connection.clone();
            async move {
                let client = connection
                    .connect(record)
                    .await
                    .inspect_err(|e| {
                        tracing::warn!(
                            user_id = %record.user_id,
                            server = %record.server_name,
                            app = %record.app_slug,
                            error = ?e,
                            "failed to connect"
                        );
                    })
                    .ok()?;

                let server_tools = match client.list_all_tools().await {
                    Ok(t) => t,
                    Err(e) => {
                        tracing::warn!(
                            user_id = %record.user_id,
                            server = %record.server_name,
                            app = %record.app_slug,
                            error = ?e,
                            "failed to list tools"
                        );
                        let _ = client.cancel().await;
                        return None;
                    }
                };

                Some((record.server_name.clone(), client, server_tools))
            }
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
            user_id,
        }
    }

    /// Returns `true` when no tools were discovered.
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// The full catalog of MCP tools, public for hosts that compose this
    /// toolset (see the `mcp_select` crate).
    pub fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.catalog()
    }

    /// The full catalog of MCP tools (mangled name + description + input schema)
    /// for on-demand loading via tool search.
    fn catalog(&self) -> Vec<SearchableTool> {
        self.tools
            .iter()
            .map(|(mangled, entry)| SearchableTool {
                name: mangled.as_str().to_string(),
                description: entry
                    .tool
                    .description
                    .as_deref()
                    .unwrap_or_default()
                    .to_string(),
                schema: Schema::from((*entry.tool.input_schema).clone()),
            })
            .collect()
    }

    /// Distinct names of the connected MCP servers that contributed tools,
    /// sorted for a stable prompt. Derived from the mangled tool keys so it
    /// reflects the servers actually serving searchable tools this request.
    fn toolset_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .tools
            .keys()
            .filter_map(|mangled| MangledName::parse(mangled.as_str()))
            .map(|(server, _tool)| server.to_string())
            .collect();
        names.sort();
        names.dedup();
        names
    }

    #[tracing::instrument(skip(self, arguments), err, fields(user_id = ?self.user_id))]
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

impl<Context: Send + Sync + 'static> ToolSet<Context> for PipedreamToolSet {
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

            if result.is_error.unwrap_or(false) {
                let description = result.error_description();
                Ok(Err(ToolCallError {
                    internal_error: anyhow::anyhow!("{}", &description),
                    description,
                }))
            } else {
                Ok(Ok(result.into_value()))
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

    fn searchable_toolset_names(&self) -> Vec<String> {
        self.toolset_names()
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
