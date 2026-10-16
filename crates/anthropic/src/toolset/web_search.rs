use super::AnthropicToolContext;
use crate::types::request::WEB_SEARCH_TOOL;
use crate::types::response::ResponseContentKind;
use crate::types::response::web_search::{SearchResult, WebSearchContent, WebSearchResponse};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use std::collections::HashSet;

/// Search the web using Claude's built-in web search.
#[derive(Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "WebSearch",
    description = "Search the web for information using Claude's built-in web search tool."
)]
pub struct WebSearch {
    /// The search query or instruction.
    pub input: String,
}

impl ToolAnnotated for WebSearch {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Search the web")
        .with_open_world()
        .without_idempotent();
}

#[async_trait]
impl AsyncTool<AnthropicToolContext> for WebSearch {
    type Output = WebSearchResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        service_context: ServiceContext<AnthropicToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let ctx = &*service_context;
        let blocks =
            super::invoke_server_tool(ctx, &request_context, WEB_SEARCH_TOOL.clone(), &self.input)
                .await?;

        collect_results(blocks).ok_or_else(|| ToolCallError {
            internal_error: anyhow::anyhow!("no web search result in response"),
            description: "No web search result returned".into(),
        })
    }
}

/// Fold every `web_search_tool_result` block of one response into the tool's
/// output.
///
/// The server-side model runs as many searches as the instruction needs, one
/// result block each, so the output carries all of them (deduplicated by URL)
/// under the first search's id rather than whichever block came first. A
/// search error is only the outcome when no search returned results, and
/// `None` means the model never searched.
///
/// `encrypted_content` is dropped: it is an opaque blob only the Anthropic
/// API can read, for citing within the same conversation, which never happens
/// here, and it is by far the largest part of every result.
pub(crate) fn collect_results(blocks: Vec<ResponseContentKind>) -> Option<WebSearchResponse> {
    let mut searched = None;
    let mut results = Vec::new();
    let mut seen_urls = HashSet::new();
    let mut failed = None;
    for block in blocks {
        let ResponseContentKind::WebSearchToolResult(result) = block else {
            continue;
        };
        match result.content {
            WebSearchContent::Results(found) => {
                searched.get_or_insert(result.tool_use_id);
                for found in found {
                    let SearchResult::WebSearchResult {
                        title,
                        url,
                        page_age,
                        ..
                    } = found;
                    if !seen_urls.insert(url.clone()) {
                        continue;
                    }
                    results.push(SearchResult::WebSearchResult {
                        title,
                        url,
                        encrypted_content: None,
                        page_age,
                    });
                }
            }
            WebSearchContent::Error(error) => {
                failed.get_or_insert((result.tool_use_id, error));
            }
        }
    }
    match (searched, failed) {
        (Some(tool_use_id), _) => Some(WebSearchResponse {
            content: WebSearchContent::Results(results),
            tool_use_id,
        }),
        (None, Some((tool_use_id, error))) => Some(WebSearchResponse {
            content: WebSearchContent::Error(error),
            tool_use_id,
        }),
        (None, None) => None,
    }
}
