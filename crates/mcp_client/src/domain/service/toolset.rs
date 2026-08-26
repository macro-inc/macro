use crate::domain::models::{CallToolResultExt, Error, MacroUserIdStr, McpServer, McpServerRecord};
use crate::domain::ports::{McpConnector, McpServerStore};
use ai_toolset::{
    AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ToolCallError, ToolInfo,
    ToolResult, ToolSet, ToolSetError,
};
use rmcp::RoleClient;
use rmcp::model::{CallToolRequestParams, CallToolResult, Tool};
use rmcp::service::Peer;
use schemars::Schema;
use std::collections::BTreeMap;
use std::pin::Pin;
use std::sync::Arc;

#[cfg(test)]
mod test;

const MANGLED_PREFIX: &str = "mcp__";
const MANGLED_SEPARATOR: &str = "__";
/// Model providers reject tool names that do not match
/// `^[a-zA-Z0-9_-]{1,128}$`, and they validate the whole tool array: a single
/// malformed name fails every request in the conversation, not just calls to
/// that tool.
const MAX_MANGLED_LEN: usize = 128;
/// Substituted when the server segment sanitizes to nothing, so a mangled
/// name can never contain an empty segment.
const EMPTY_SERVER_SEGMENT: &str = "server";
/// Substituted when the tool segment sanitizes to nothing.
const EMPTY_TOOL_SEGMENT: &str = "tool";
/// Floor for truncating the server segment, so a very long tool name cannot
/// squeeze the server segment down to nothing. Must exceed both placeholders.
const MIN_TRUNCATED_SEGMENT: usize = 8;

/// The characters model providers accept in a tool name.
fn is_allowed(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// Replaces every run of disallowed characters with a single `_` and trims
/// leading and trailing underscores.
///
/// `collapse_underscores` additionally collapses runs of underscores into one.
/// The server segment needs that: [`MangledName::parse`] splits on the first
/// `__`, so a server segment containing `__` would make the split report the
/// wrong server name.
fn sanitize_segment(raw: &str, collapse_underscores: bool) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_disallowed_run = false;
    for c in raw.chars() {
        let next = if is_allowed(c) {
            in_disallowed_run = false;
            c
        } else if in_disallowed_run {
            continue;
        } else {
            in_disallowed_run = true;
            '_'
        };
        if collapse_underscores && next == '_' && out.ends_with('_') {
            continue;
        }
        out.push(next);
    }
    out.trim_matches('_').to_owned()
}

/// Shortens an already sanitized (so ASCII) segment to at most `max` bytes,
/// dropping any underscore left dangling at the cut and falling back to
/// `placeholder` if nothing survives.
fn fit_segment(segment: &mut String, max: usize, placeholder: &str) {
    if segment.len() <= max {
        return;
    }
    segment.truncate(max);
    while segment.ends_with('_') {
        segment.pop();
    }
    if segment.is_empty() {
        segment.push_str(placeholder);
    }
}

/// A mangled tool name plus whether sanitizing had to change it.
struct Mangled {
    /// The sanitized name, always matching `^[a-zA-Z0-9_-]{1,128}$`.
    name: MangledName,
    /// Set when the sanitized name differs from the raw `server__tool` join,
    /// i.e. the raw names would have been rejected by the provider.
    sanitized: bool,
}

/// A mangled tool name in the format `mcp__<server>__<tool>`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct MangledName(String);

impl Mangled {
    /// Builds `mcp__<server>__<tool>`, sanitizing both segments so the result
    /// always matches `^[a-zA-Z0-9_-]{1,128}$`.
    ///
    /// Server names are human-readable display names (`Google Sheets`), so
    /// they routinely contain characters providers reject. Sanitizing here
    /// rather than where the name is written also covers names already
    /// persisted, and keeps every future source of the name covered.
    ///
    /// Truncation is safe for dispatch: the unmangled tool name is kept on
    /// [`RegisteredTool`] and is what gets sent to the peer.
    fn new(server_name: &str, tool_name: &str) -> Self {
        let mut server = sanitize_segment(server_name, true);
        let mut tool = sanitize_segment(tool_name, false);

        if server.is_empty() {
            server = EMPTY_SERVER_SEGMENT.to_owned();
        }
        if tool.is_empty() {
            tool = EMPTY_TOOL_SEGMENT.to_owned();
        }

        let budget = MAX_MANGLED_LEN - MANGLED_PREFIX.len() - MANGLED_SEPARATOR.len();
        if server.len() + tool.len() > budget {
            let server_max = budget.saturating_sub(tool.len()).max(MIN_TRUNCATED_SEGMENT);
            fit_segment(&mut server, server_max, EMPTY_SERVER_SEGMENT);
        }
        if server.len() + tool.len() > budget {
            fit_segment(&mut tool, budget - server.len(), EMPTY_TOOL_SEGMENT);
        }

        let sanitized = server != server_name || tool != tool_name;
        Self {
            name: MangledName(format!("{MANGLED_PREFIX}{server}{MANGLED_SEPARATOR}{tool}")),
            sanitized,
        }
    }
}

impl MangledName {
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
    /// The owning user, for correlating tool-call failures in logs. All
    /// records passed to [`McpToolSet::new`] belong to one user in practice.
    user_id: Option<MacroUserIdStr<'static>>,
}

impl McpToolSet {
    /// Connect to every server in `records` concurrently, discover tools, and
    /// register them. Credential updates (e.g. refreshed OAuth tokens) are
    /// persisted through `server_store`.
    ///
    /// Servers that fail to connect or list tools are silently skipped.
    #[tracing::instrument(skip_all)]
    pub async fn new<S: McpServerStore>(records: &[McpServerRecord], server_store: Arc<S>) -> Self {
        let user_id = records.first().map(|r| r.user_id.clone());

        let futs = records.iter().filter(|r| r.enabled).map(|record| {
            let server_store = server_store.clone();
            async move {
                let client = record
                    .connect(server_store)
                    .await
                    .inspect_err(|e| {
                        tracing::warn!(
                            user_id = %record.user_id,
                            server = %record.server_name,
                            url = %record.url,
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
                            url = %record.url,
                            error = ?e,
                            "failed to list tools"
                        );
                        let _ = client.cancel().await;
                        return None;
                    }
                };

                Some((
                    record.server_name.clone(),
                    record.url.clone(),
                    client,
                    server_tools,
                ))
            }
        });

        let results = futures::future::join_all(futs).await;

        let mut tools = BTreeMap::new();
        let mut connections = Vec::new();
        for (server_name, url, client, server_tools) in results.into_iter().flatten() {
            for tool in server_tools {
                let Mangled {
                    name: mangled,
                    sanitized,
                } = Mangled::new(&server_name, &tool.name);

                if sanitized {
                    tracing::warn!(
                        user_id = ?user_id,
                        server = %server_name,
                        url = %url,
                        tool = %tool.name,
                        %mangled,
                        "sanitized tool name to satisfy the provider tool-name pattern"
                    );
                }

                if tools.contains_key(&mangled) {
                    tracing::warn!(
                        user_id = ?user_id,
                        server = %server_name,
                        url = %url,
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
    /// toolset outside [`CombinedToolSet`] (see the `mcp_select` crate).
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

/// Wraps a static [`AsyncToolCollection`] and an optional [`McpToolSet`],
/// presenting them as a single toolset to the AI loop.
pub struct CombinedToolSet<T> {
    static_tools: Arc<AsyncToolCollection<T>>,
    mcp_tools: McpToolSet,
}

impl<T> CombinedToolSet<T> {
    /// Build a combined toolset from the static tools and the user's MCP servers.
    ///
    /// Credential updates from the MCP connections (e.g. refreshed OAuth
    /// tokens) are persisted through `server_store`.
    pub async fn new<S: McpServerStore>(
        static_tools: Arc<AsyncToolCollection<T>>,
        records: &[McpServerRecord],
        server_store: Arc<S>,
    ) -> Self {
        let mcp_tools = McpToolSet::new(records, server_store).await;
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
        // Only the static (first-party) tools are sent on every request. MCP
        // tools are loaded on demand via the `SearchTools` tool — they are
        // surfaced through `searchable_catalog`, not here — so a large/growing
        // MCP catalog never bloats the request.
        self.static_tools.request_schemas()
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.mcp_tools.catalog()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        self.mcp_tools.toolset_names()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        if tool_name.starts_with(MANGLED_PREFIX) {
            <McpToolSet as ToolSet<T>>::routing_description(&self.mcp_tools, tool_name)
        } else {
            self.static_tools.routing_description(tool_name)
        }
    }
}
