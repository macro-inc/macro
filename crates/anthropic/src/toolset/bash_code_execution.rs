use super::AnthropicToolContext;
use crate::types::request::CODE_EXECUTION_TOOL;
use crate::types::response::ResponseContentKind;
use crate::types::response::code_execution::BashCodeExecutionResponse;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

/// Execute a bash command using Claude's built-in code execution sandbox.
#[derive(Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "BashCodeExecution",
    description = "Execute a bash command in a sandboxed environment using Claude's built-in code execution tool."
)]
pub struct BashCodeExecution {
    /// The bash command or instruction to execute.
    pub input: String,
}

#[async_trait]
impl AsyncTool<AnthropicToolContext> for BashCodeExecution {
    type Output = BashCodeExecutionResponse;

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
                ResponseContentKind::BashCodeExecutionToolResult(r) => Some(r),
                _ => None,
            })
            .ok_or_else(|| ToolCallError {
                internal_error: anyhow::anyhow!("no bash code execution result in response"),
                description: "No bash code execution result returned".into(),
            })
    }
}
