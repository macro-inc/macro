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

/// A catalog tool as [`SEARCH_TOOLS`] and [`LOAD_TOOLS`] report it: just
/// enough for the model to decide how to call it.
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

/// Response from [`SEARCH_TOOLS`]: ranked matches, split into the top matches
/// (auto-loaded, callable on the next model turn) and the remainder (loadable
/// via [`LOAD_TOOLS`]).
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SearchToolsResponse {
    /// Top matches, ranked by relevance. These are loaded: call them by exact
    /// name on the next step.
    pub results: Vec<ToolMatch>,
    /// Matches past the auto-load cap, ranked. Not callable yet — pass a name
    /// to `LoadTools` if one of these is the tool you need.
    pub additional_matches: Vec<ToolMatch>,
}

/// Response from [`LOAD_TOOLS`]: which requested tools were loaded, and any
/// names that weren't found.
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
mod test {
    use super::*;
    use crate::RequestContext;
    use macro_user_id::user_id::MacroUserIdStr;
    use std::sync::Mutex;

    fn tool(name: &str) -> SearchableTool {
        SearchableTool {
            name: name.to_string(),
            description: String::new(),
            schema: Schema::default(),
        }
    }

    #[test]
    fn tool_loader_forwards_to_its_closure() {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = seen.clone();
        let loader = ToolLoader::new(move |tools| {
            sink.lock()
                .unwrap()
                .extend(tools.into_iter().map(|t| t.name));
        });

        loader.load(vec![tool("a"), tool("b")]);

        assert_eq!(&*seen.lock().unwrap(), &["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn request_context_new_has_no_tool_search() {
        let user = MacroUserIdStr::try_from_email("t@example.com").unwrap();
        let ctx = RequestContext::new(user);
        assert!(ctx.searchable_tools.is_empty());
        assert!(ctx.tool_loader.is_none());
    }

    #[test]
    fn with_tool_search_wires_catalog_and_loader() {
        let user = MacroUserIdStr::try_from_email("t@example.com").unwrap();
        let catalog = Arc::new(vec![tool("mcp__x__y")]);
        let loader = ToolLoader::new(|_| {});
        let ctx = RequestContext::new(user).with_tool_search(catalog, loader);

        assert_eq!(ctx.searchable_tools.len(), 1);
        assert_eq!(ctx.searchable_tools[0].name, "mcp__x__y");
        assert!(ctx.tool_loader.is_some());
    }

    #[test]
    fn tools_loaded_by_reads_search_and_load_results() {
        let search = serde_json::json!({
            "results": [{ "name": "ReadInitiative", "description": "Read a project" }],
            "additional_matches": [{ "name": "ListInitiatives", "description": "List projects" }],
        })
        .to_string();
        let load = serde_json::json!({
            "loaded": [{ "name": "ReadInitiative", "description": "Read a project" }],
            "not_found": ["ReadInitiatives"],
        })
        .to_string();

        assert_eq!(tools_loaded_by(SEARCH_TOOLS, &search), ["ReadInitiative"]);
        assert_eq!(tools_loaded_by(LOAD_TOOLS, &load), ["ReadInitiative"]);
        assert!(tools_loaded_by("ReadInitiative", &load).is_empty());
        assert!(tools_loaded_by(LOAD_TOOLS, "Tool call failed").is_empty());
    }
}
