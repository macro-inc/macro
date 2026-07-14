use super::AnthropicToolContext;
use crate::types::request::WEB_FETCH_TOOL;
use crate::types::response::ResponseContentKind;
use crate::types::response::web_fetch::WebFetchResponse;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

/// Fetch a web page using Claude's built-in web fetch tool.
#[derive(Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "WebFetch",
    description = "Fetch the contents of a web page using Claude's built-in web fetch tool."
)]
pub struct WebFetch {
    /// The URL to fetch or an instruction describing what to fetch.
    pub input: String,
}

#[async_trait]
impl AsyncTool<AnthropicToolContext> for WebFetch {
    type Output = WebFetchResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        service_context: ServiceContext<AnthropicToolContext>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let ctx = &*service_context;
        let blocks =
            super::invoke_server_tool(&ctx.client, &ctx.model, WEB_FETCH_TOOL.clone(), &self.input)
                .await?;

        blocks
            .into_iter()
            .find_map(|b| match b {
                ResponseContentKind::WebFetchToolResult(r) => Some(r),
                _ => None,
            })
            .ok_or_else(|| ToolCallError {
                internal_error: anyhow::anyhow!("no web fetch result in response"),
                description: "No web fetch result returned".into(),
            })
    }
}
