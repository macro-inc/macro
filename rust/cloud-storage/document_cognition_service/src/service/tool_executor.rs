//! [`ToolExecutor`] implementation backed by the DCS AI toolset.

use ai_tools::{AiToolSet, RequestContext, ToolServiceContext, all_tools};
use chat::domain::models::{ChatErr, ToolCallOutcome};
use chat::domain::ports::ToolExecutor;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

/// Implements [`ToolExecutor`] by wrapping the DCS `AsyncToolSet<ToolServiceContext>`.
pub struct DcsToolExecutor {
    toolset: Arc<AiToolSet>,
    tool_context: ToolServiceContext,
}

impl DcsToolExecutor {
    /// Create a new executor from the DCS tool context.
    pub fn new(tool_context: ToolServiceContext) -> Self {
        Self {
            toolset: all_tools().toolset,
            tool_context,
        }
    }
}

impl ToolExecutor for DcsToolExecutor {
    fn validate_args(&self, tool_name: &str, args: &serde_json::Value) -> Result<(), ChatErr> {
        let tool = self
            .toolset
            .user_tools
            .get(tool_name)
            .ok_or_else(|| ChatErr::BadRequest(format!("unknown tool: {tool_name}")))?;
        tool.try_deserialize(args)
            .map_err(|e| ChatErr::BadRequest(format!("invalid args: {e}")))?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn call_tool(
        &self,
        user_id: MacroUserIdStr<'static>,
        tool_name: &str,
        args: &serde_json::Value,
    ) -> Result<ToolCallOutcome, ChatErr> {
        let request_context = RequestContext { user_id };
        match self
            .toolset
            .try_user_tool_call(self.tool_context.clone(), request_context, tool_name, args)
            .await
        {
            Ok(Ok(result)) => Ok(ToolCallOutcome::Success(result)),
            Ok(Err(tool_err)) => {
                tracing::error!(error=?tool_err.internal_error, "tool execution failed");
                Ok(ToolCallOutcome::ExecutionError {
                    description: tool_err.description,
                })
            }
            Err(e) => Err(ChatErr::BadRequest(e.to_string())),
        }
    }
}
