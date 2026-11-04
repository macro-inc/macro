//! Primitives for custom (provider-agnostic) tool search.
//!
//! A toolset can mark some tools as **searchable** (loaded on demand) rather
//! than sent on every request. The catalog of those tools is exposed via
//! [`ToolSet::searchable_catalog`](crate::ToolSet::searchable_catalog). A
//! first-party `SearchTools` tool reads the catalog from the
//! [`RequestContext`](crate::RequestContext), matches the model's query, and
//! asks the [`ToolLoader`] to load the matches — the agent layer's loader makes
//! them real, callable tools on the next turn. This keeps a large/growing tool
//! catalog out of every request without depending on any provider's native
//! tool-search feature.

use schemars::{JsonSchema, Schema};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// The name of the tool that finds catalog tools and loads the top matches.
pub const SEARCH_TOOLS: &str = "SearchTools";

/// The name of the tool that loads catalog tools by name.
pub const LOAD_TOOLS: &str = "LoadTools";

/// A tool that is loaded on demand via tool search rather than sent on every
/// request. The catalog of these is returned by
/// [`ToolSet::searchable_catalog`](crate::ToolSet::searchable_catalog) and read
/// by the `SearchTools` tool to match the model's query.
#[derive(Clone, Debug)]
pub struct SearchableTool {
    /// The tool's name, exactly as it must be called (e.g. a mangled MCP name).
    pub name: String,
    /// Human-readable description, matched against search queries.
    pub description: String,
    /// JSON schema for the tool's input — needed to register the tool once it
    /// is loaded.
    pub schema: Schema,
}

/// Callback that loads searchable tools into the active request.
///
/// `SearchTools` calls this with the tools matching the query. The agent layer
/// supplies the implementation, which registers the tools with the live tool
/// server so they become advertised and callable on the next turn. Defined here
/// as a plain `Fn` so `ai_toolset` stays free of any agent/rig dependency.
#[derive(Clone)]
pub struct ToolLoader(Arc<dyn Fn(Vec<SearchableTool>) + Send + Sync>);

impl ToolLoader {
    /// Wrap a closure as a [`ToolLoader`].
    pub fn new(f: impl Fn(Vec<SearchableTool>) + Send + Sync + 'static) -> Self {
        Self(Arc::new(f))
    }

    /// Request that `tools` be loaded into the active request.
    pub fn load(&self, tools: Vec<SearchableTool>) {
        (self.0)(tools)
    }
}

impl std::fmt::Debug for ToolLoader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToolLoader")
    }
}

/// A tool surfaced by [`SearchTools`] / [`LoadTools`] — just enough for the
/// model to decide how to call it.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ToolMatch {
    /// The exact name to call the tool by.
    pub name: String,
    /// What the tool does.
    pub description: String,
}

impl ToolMatch {
    /// The match for `tool`.
    pub fn of(tool: &SearchableTool) -> Self {
        Self {
            name: tool.name.clone(),
            description: tool.description.clone(),
        }
    }
}

/// Response from [`SearchTools`]: ranked matches, split into the top matches
/// (auto-loaded, callable on the next model turn) and the remainder (loadable
/// via [`LoadTools`]).
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SearchToolsResponse {
    /// Top matches, ranked by relevance. These are loaded: call them by exact
    /// name on the next step.
    pub results: Vec<ToolMatch>,
    /// Matches past the auto-load cap, ranked. Not callable yet — pass a name
    /// to `LoadTools` if one of these is the tool you need.
    pub additional_matches: Vec<ToolMatch>,
}

/// Response from [`LoadTools`]: which requested tools were loaded, and any names
/// that weren't found.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct LoadToolsResponse {
    /// Tools that are now loaded and callable by name.
    pub loaded: Vec<ToolMatch>,
    /// Requested names that don't exist (call `SearchTools` to find valid names).
    pub not_found: Vec<String>,
}

/// The names of the catalog tools a `tool_name` call loaded, read from its
/// `result`. Empty for any other tool, and for a result that is not the
/// tool's response (an error, or a result cut for length).
pub fn tools_loaded_by(tool_name: &str, result: &str) -> Vec<String> {
    let matches = match tool_name {
        SEARCH_TOOLS => serde_json::from_str::<SearchToolsResponse>(result)
            .map(|response| response.results)
            .unwrap_or_default(),
        LOAD_TOOLS => serde_json::from_str::<LoadToolsResponse>(result)
            .map(|response| response.loaded)
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    matches.into_iter().map(|tool| tool.name).collect()
}

#[cfg(test)]
mod test;
