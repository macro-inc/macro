use super::AnthropicToolContext;
use crate::types::request::WEB_SEARCH_TOOL;
use crate::types::response::ResponseContentKind;
use crate::types::response::web_search::WebSearchResponse;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

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

#[async_trait]
impl AsyncTool<AnthropicToolContext> for WebSearch {
    type Output = WebSearchResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        service_context: ServiceContext<AnthropicToolContext>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let ctx = &*service_context;
        let blocks = super::invoke_server_tool(
            &ctx.client,
            &ctx.model,
            WEB_SEARCH_TOOL.clone(),
            &self.input,
        )
        .await?;

        blocks
            .into_iter()
            .find_map(|b| match b {
                ResponseContentKind::WebSearchToolResult(r) => Some(r),
                _ => None,
            })
            .ok_or_else(|| ToolCallError {
                internal_error: anyhow::anyhow!("no web search result in response"),
                description: "No web search result returned".into(),
            })
    }
}
