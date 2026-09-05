//! The toolset over connected servers.

use crate::McpServer;
use crate::call_tool_result::CallToolResultExt;
use crate::mangle::{Mangled, MangledName};
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

/// Errors from MCP tool dispatch.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The requested tool was not found on any connected server.
    #[error("unknown tool: {0}")]
    UnknownTool(String),
    /// A tool invocation failed.
    #[error("tool call failed: {0}")]
    ToolCall(String),
}

/// One live server and the name its tools are exposed under.
pub struct ConnectedServer {
    /// The server segment of every mangled name, e.g. `Linear`.
    pub name: String,
    /// The open session, kept alive for as long as the toolset is.
    pub client: McpServer,
}

struct RegisteredTool {
    peer: Peer<RoleClient>,
    tool: Tool,
}

/// Dispatches tool calls to connected MCP servers using name-mangled routing.
///
/// Every tool is exposed as `mcp__<server_name>__<tool_name>` to guarantee
/// uniqueness across servers.
///
/// Cheap to clone: every clone shares the same live sessions, which stay open
/// until the last clone is dropped. A host that keeps one across turns hands
/// out clones and composes them like any other toolset.
#[derive(Clone)]
pub struct RemoteMcpToolSet(Arc<Registered>);

struct Registered {
    tools: BTreeMap<MangledName, RegisteredTool>,
    /// Kept alive so the background transport tasks aren't cancelled.
    _connections: Vec<McpServer>,
    /// Who the servers belong to, for correlating tool-call failures in logs.
    subject: Option<String>,
}

impl RemoteMcpToolSet {
    /// Discover every server's tools and register them.
    ///
    /// `subject` names whose servers these are, for logs only. A server that
    /// fails to list its tools is skipped with a warning: one bad server must
    /// not take the others' tools with it.
    #[tracing::instrument(skip_all, fields(servers = servers.len(), subject = ?subject))]
    pub async fn from_connected(servers: Vec<ConnectedServer>, subject: Option<String>) -> Self {
        let listings = futures::future::join_all(servers.into_iter().map(|server| async move {
            match server.client.list_all_tools().await {
                Ok(tools) => Some((server.name, server.client, tools)),
                Err(error) => {
                    tracing::warn!(
                        server = %server.name,
                        error = ?error,
                        "failed to list tools; skipping the server"
                    );
                    let _ = server.client.cancel().await;
                    None
                }
            }
        }))
        .await;

        let mut tools = BTreeMap::new();
        let mut connections = Vec::new();
        for (server_name, client, server_tools) in listings.into_iter().flatten() {
            for tool in server_tools {
                let Mangled {
                    name: mangled,
                    sanitized,
                } = Mangled::new(&server_name, &tool.name);

                if sanitized {
                    tracing::warn!(
                        subject = ?subject,
                        server = %server_name,
                        tool = %tool.name,
                        %mangled,
                        "sanitized tool name to satisfy the provider tool-name pattern"
                    );
                }

                if tools.contains_key(&mangled) {
                    tracing::warn!(
                        subject = ?subject,
                        server = %server_name,
                        tool = %tool.name,
                        %mangled,
                        "skipping duplicate tool"
                    );
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

        Self(Arc::new(Registered {
            tools,
            _connections: connections,
            subject,
        }))
    }

    /// Returns `true` when no tools were discovered.
    pub fn is_empty(&self) -> bool {
        self.0.tools.is_empty()
    }

    /// The full catalog of MCP tools (mangled name + description + input
    /// schema) for on-demand loading via tool search.
    pub fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.0
            .tools
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
            .0
            .tools
            .keys()
            .filter_map(|mangled| MangledName::parse(mangled.as_str()))
            .map(|(server, _tool)| server.to_string())
            .collect();
        names.sort();
        names.dedup();
        names
    }

    #[tracing::instrument(skip(self, arguments), err, fields(subject = ?self.0.subject))]
    async fn call_tool(
        &self,
        name: &str,
        arguments: serde_json::Map<String, serde_json::Value>,
    ) -> Result<CallToolResult, Error> {
        let key = MangledName(name.to_owned());
        let entry = self
            .0
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

impl<Context: Send + Sync + 'static> ToolSet<Context> for RemoteMcpToolSet {
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
            .0
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

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        RemoteMcpToolSet::searchable_catalog(self)
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        self.toolset_names()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        let (server_name, original_name) = MangledName::parse(tool_name)?;
        let key = MangledName(tool_name.to_owned());
        let display_name = self
            .0
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
