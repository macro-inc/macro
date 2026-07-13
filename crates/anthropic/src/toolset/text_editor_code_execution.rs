use super::AnthropicToolContext;
use crate::types::request::CODE_EXECUTION_TOOL;
use crate::types::response::ResponseContentKind;
use crate::types::response::code_execution::TextEditorCodeExecutionResponse;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

/// Use Claude's built-in text editor in a sandboxed code execution environment.
#[derive(Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "TextEditorCodeExecution",
    description = "Use a text editor in a sandboxed environment using Claude's built-in code execution tool."
)]
pub struct TextEditorCodeExecution {
    /// The text editing instruction.
    pub input: String,
}

#[async_trait]
impl AsyncTool<AnthropicToolContext> for TextEditorCodeExecution {
    type Output = TextEditorCodeExecutionResponse;

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
            CODE_EXECUTION_TOOL.clone(),
            &self.input,
        )
        .await?;

        blocks
            .into_iter()
            .find_map(|b| match b {
                ResponseContentKind::TextEditorCodeExecutionToolResult(r) => Some(r),
                _ => None,
            })
            .ok_or_else(|| ToolCallError {
                internal_error: anyhow::anyhow!("no text editor code execution result in response"),
                description: "No text editor code execution result returned".into(),
            })
    }
}
