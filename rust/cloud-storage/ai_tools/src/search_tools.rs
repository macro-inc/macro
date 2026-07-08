use ai_toolset::{
    AsyncTool, RequestContext, SearchableTool, ServiceContext, ToolLoader, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ToolServiceContext;

#[cfg(test)]
mod test;

/// A tool surfaced by [`SearchTools`] / [`LoadTools`] — just enough for the
/// model to decide how to call it.
#[derive(Debug, Serialize, JsonSchema)]
pub struct ToolMatch {
    /// The exact name to call the tool by.
    pub name: String,
    /// What the tool does.
    pub description: String,
}

impl ToolMatch {
    fn of(tool: &SearchableTool) -> Self {
        Self {
            name: tool.name.clone(),
            description: tool.description.clone(),
        }
    }
}

// ---------------------------------------------------------------------------
// SearchTools — discovery + auto-loading
// ---------------------------------------------------------------------------

/// How many top-ranked matches a single [`SearchTools`] call loads
/// automatically.
///
/// Every loaded tool's schema is advertised on all subsequent requests for the
/// session, so auto-loading must be bounded — a broad query against a large
/// integration would otherwise permanently bloat every following request.
/// Matches past the cap are still returned (as `additional_matches`) and can
/// be loaded explicitly with [`LoadTools`].
const MAX_AUTO_LOADED_MATCHES: usize = 8;

/// Response from [`SearchTools`]: ranked matches, split into the top matches
/// (auto-loaded, callable on the next model turn) and the remainder (loadable
/// via [`LoadTools`]).
#[derive(Debug, Serialize, JsonSchema)]
pub struct SearchToolsResponse {
    /// Top matches, ranked by relevance. These are loaded: call them by exact
    /// name on the next step.
    pub results: Vec<ToolMatch>,
    /// Matches past the auto-load cap, ranked. Not callable yet — pass a name
    /// to `LoadTools` if one of these is the tool you need.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub additional_matches: Vec<ToolMatch>,
}

/// `SearchTools` discovers tools from connected integrations (MCP servers such
/// as Slack, Gmail, Linear) that are not listed upfront, and auto-loads the top
/// matches so they are callable on the next model turn. This keeps the model
/// from needing a brittle search → load → call three-step protocol: skipping
/// the load step left the announced tool unadvertised, so the model's intended
/// call was never dispatched and the turn ended empty.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "SearchTools",
    description = "Find tools from connected integrations (e.g. Slack, Gmail, Linear, GitHub) by keyword. The top matches are loaded automatically: call them by exact name on your next step. Matches past the auto-load cap come back under `additional_matches` and need `LoadTools` first. Searching is cheap, so cast a wide net."
)]
pub struct SearchTools {
    /// Keywords describing the capability you need (matched against tool names
    /// and descriptions, case-insensitive).
    #[schemars(
        description = "Keywords describing the capability you need, e.g. \"linear issue\" or \"github list commits\"."
    )]
    pub query: String,
}

#[async_trait]
impl AsyncTool<ToolServiceContext> for SearchTools {
    type Output = SearchToolsResponse;

    #[tracing::instrument(skip_all, fields(query = %self.query), err)]
    async fn call(
        &self,
        _service_context: ServiceContext<ToolServiceContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(search_and_stage(
            &request_context.searchable_tools,
            &self.query,
            request_context.tool_loader.as_ref(),
        ))
    }
}

// ---------------------------------------------------------------------------
// LoadTools — load named tools so they become callable
// ---------------------------------------------------------------------------

/// Response from [`LoadTools`]: which requested tools were loaded, and any names
/// that weren't found.
#[derive(Debug, Serialize, JsonSchema)]
pub struct LoadToolsResponse {
    /// Tools that are now loaded and callable by name.
    pub loaded: Vec<ToolMatch>,
    /// Requested names that don't exist (call `SearchTools` to find valid names).
    pub not_found: Vec<String>,
}

/// `LoadTools` loads tools discovered via `SearchTools` so they become callable.
/// Pass the exact names from the search results; after loading, call each tool
/// by its name as usual.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "LoadTools",
    description = "Load tools by name (from `SearchTools` results) so you can call them. After loading, invoke each tool by its name. Only load the tools you actually need."
)]
pub struct LoadTools {
    /// Exact tool names to load, as returned by `SearchTools`.
    #[schemars(description = "Exact tool names to load, taken from SearchTools results.")]
    pub names: Vec<String>,
}

#[async_trait]
impl AsyncTool<ToolServiceContext> for LoadTools {
    type Output = LoadToolsResponse;

    #[tracing::instrument(skip_all, fields(names = ?self.names), err)]
    async fn call(
        &self,
        _service_context: ServiceContext<ToolServiceContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(load(
            &request_context.searchable_tools,
            &self.names,
            request_context.tool_loader.as_ref(),
        ))
    }
}

// ---------------------------------------------------------------------------
// Pure logic (unit-testable without a service context)
// ---------------------------------------------------------------------------

/// Match `query` against `catalog`, ranked by relevance.
///
/// The query is split into whitespace-separated terms; a tool matches if **any**
/// term is a case-insensitive substring of its name or description, ranked by
/// how many distinct terms match (so "github list commits" surfaces the most
/// relevant tools first). All matches are returned — the caller decides how
/// many to load. An empty query returns the whole catalog.
fn search<'c>(catalog: &'c [SearchableTool], query: &str) -> Vec<&'c SearchableTool> {
    let query = query.to_lowercase();
    let terms: Vec<&str> = query.split_whitespace().collect();

    let mut scored: Vec<(usize, &SearchableTool)> = catalog
        .iter()
        .filter_map(|t| {
            if terms.is_empty() {
                return Some((0, t));
            }
            let haystack = format!("{} {}", t.name.to_lowercase(), t.description.to_lowercase());
            let score = terms
                .iter()
                .filter(|term| haystack.contains(**term))
                .count();
            (score > 0).then_some((score, t))
        })
        .collect();
    // Highest term-match count first; tie-break by name for stable ordering.
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));

    scored.into_iter().map(|(_, t)| t).collect()
}

/// Match `query`, auto-load the top [`MAX_AUTO_LOADED_MATCHES`] matches so they
/// are advertised on the next model turn, and report the loaded/unloaded split
/// to the model.
fn search_and_stage(
    catalog: &[SearchableTool],
    query: &str,
    loader: Option<&ToolLoader>,
) -> SearchToolsResponse {
    let matches = search(catalog, query);
    let (loaded, additional) = matches.split_at(matches.len().min(MAX_AUTO_LOADED_MATCHES));

    if let Some(loader) = loader
        && !loaded.is_empty()
    {
        loader.load(loaded.iter().map(|&tool| tool.clone()).collect());
    }

    SearchToolsResponse {
        results: loaded.iter().copied().map(ToolMatch::of).collect(),
        additional_matches: additional.iter().copied().map(ToolMatch::of).collect(),
    }
}

/// Look up `names` in `catalog`, hand the found tools to `loader` for loading,
/// and report which were loaded vs not found.
fn load(
    catalog: &[SearchableTool],
    names: &[String],
    loader: Option<&ToolLoader>,
) -> LoadToolsResponse {
    let mut to_load = Vec::new();
    let mut loaded = Vec::new();
    let mut not_found = Vec::new();
    for name in names {
        match catalog.iter().find(|t| &t.name == name) {
            Some(t) => {
                loaded.push(ToolMatch::of(t));
                to_load.push(t.clone());
            }
            None => not_found.push(name.clone()),
        }
    }

    // Hand the found tools to the loader; the agent layer registers them with
    // the live tool server so they are callable on the next turn.
    if !to_load.is_empty()
        && let Some(loader) = loader
    {
        loader.load(to_load);
    }

    LoadToolsResponse { loaded, not_found }
}
