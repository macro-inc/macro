use ai_toolset::{
    AsyncTool, RequestContext, SearchableTool, ServiceContext, ToolLoader, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ToolServiceContext;

#[cfg(test)]
mod test;

/// A tool surfaced by [`SearchTools`] or loaded by [`LoadTools`] — just enough
/// for the model to decide whether to load it and how to call it.
#[derive(Debug, Serialize, JsonSchema)]
pub struct ToolMatch {
    /// The exact name to load and then call the tool by.
    pub name: String,
    /// What the tool does.
    pub description: String,
}

// ---------------------------------------------------------------------------
// SearchTools — discovery only
// ---------------------------------------------------------------------------

/// Response from [`SearchTools`]: matching tools (name + description), not yet
/// loaded.
#[derive(Debug, Serialize, JsonSchema)]
pub struct SearchToolsResponse {
    /// Tools matching the query. Call `LoadTools` with the names you want to use.
    pub results: Vec<ToolMatch>,
}

/// `SearchTools` discovers tools from connected integrations (MCP servers such
/// as Slack, Gmail, Linear) that are not listed upfront. It only *finds* tools —
/// returning their names and descriptions — without loading them, so it can
/// return many candidates cheaply. To actually use a tool, pass its name to
/// `LoadTools`.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "SearchTools",
    description = "Find tools from connected integrations (e.g. Slack, Gmail, Linear, GitHub) by keyword. Returns matching tools' names and descriptions but does NOT load them — pass the names you want to `LoadTools` to make them callable. Searching is cheap, so cast a wide net."
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
        Ok(SearchToolsResponse {
            results: search(&request_context.searchable_tools, &self.query),
        })
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

/// Match `query` against `catalog` and return the matches' name + description,
/// ranked by relevance. Does not load anything.
///
/// The query is split into whitespace-separated terms; a tool matches if **any**
/// term is a case-insensitive substring of its name or description, ranked by
/// how many distinct terms match (so "github list commits" surfaces the most
/// relevant tools first). All matches are returned — searching is cheap and
/// loading is a separate step. An empty query returns the whole catalog.
fn search(catalog: &[SearchableTool], query: &str) -> Vec<ToolMatch> {
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

    scored
        .into_iter()
        .map(|(_, t)| ToolMatch {
            name: t.name.clone(),
            description: t.description.clone(),
        })
        .collect()
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
                loaded.push(ToolMatch {
                    name: t.name.clone(),
                    description: t.description.clone(),
                });
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
