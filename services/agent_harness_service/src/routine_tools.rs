//! Run catalog tools for routine steps in-process, as the routine owner.
//!
//! The same tools, contexts and side effects (Gmail operations, events,
//! notifications) the in-process agent uses. The scheduler's program decides
//! which step runs; only the tools a routine step may name can be called here.

use std::sync::Arc;

use ai_tools::{AiHost, AiToolSet, ToolServiceContext, tools_for};
use ai_toolset::{RequestContext, ToolSet, ToolSetError};
use macro_user_id::user_id::MacroUserIdStr;
use routine_program::RoutineTool;
use scheduled_action::domain::ports::{RoutineToolOutcome, RoutineTools};
use serde_json::{Map, Value};

#[cfg(test)]
mod test;

/// Largest output kept for later steps. Routine tools are writes with small
/// outputs; anything larger is dropped rather than truncated into invalid JSON.
const MAX_OUTPUT_BYTES: usize = 32 * 1024;
/// Longest failure message kept in the run's history.
const MAX_MESSAGE_CHARS: usize = 500;

/// The MCP host's catalog: it has no tools that wait for a person to confirm.
pub struct CatalogRoutineTools {
    toolset: Arc<AiToolSet>,
    context: ToolServiceContext,
}

impl CatalogRoutineTools {
    /// Tools act as Macro on the owner's behalf, like the in-process agent.
    pub fn new(context: ToolServiceContext) -> Self {
        Self {
            toolset: tools_for(AiHost::Mcp).toolset,
            context,
        }
    }
}

impl RoutineTools for CatalogRoutineTools {
    #[tracing::instrument(name = "routine.tool", skip_all, fields(tool = %tool.name()))]
    async fn call(
        &self,
        owner: &MacroUserIdStr<'static>,
        tool: RoutineTool,
        arguments: Map<String, Value>,
    ) -> RoutineToolOutcome {
        let mut context = self.context.clone();
        context.usage_context =
            ai_usage::UsageContext::new(ai_usage::AiFeature::Automation, owner.clone());
        // Arguments and results are the owner's content (email text, messages):
        // no GenAI capture of them, and the run's history keeps the outcome.
        let request = RequestContext::new(owner.clone()).with_genai_telemetry(false);
        let result = self
            .toolset
            .try_tool_call(context, request, tool.name(), &Value::Object(arguments))
            .await;
        outcome(tool.name(), result)
    }
}

fn outcome(
    tool: &str,
    result: Result<ai_toolset::ToolResult<Value>, ToolSetError>,
) -> RoutineToolOutcome {
    match result {
        Ok(Ok(output)) => RoutineToolOutcome::Completed {
            output: if output.to_string().len() > MAX_OUTPUT_BYTES {
                Value::Null
            } else {
                output
            },
        },
        Ok(Err(error)) => {
            // The description can quote the owner's data; it stays in history.
            tracing::warn!(tool, "routine tool refused or failed");
            failed(error.description)
        }
        Err(ToolSetError::Deserialization(error)) => {
            failed(format!("The arguments don't match {tool}: {error}"))
        }
        Err(ToolSetError::NotFound(_)) => failed(format!("{tool} isn't available.")),
    }
}

fn failed(message: String) -> RoutineToolOutcome {
    RoutineToolOutcome::Failed {
        message: match message.char_indices().nth(MAX_MESSAGE_CHARS) {
            Some((end, _)) => format!("{}…", &message[..end]),
            None => message,
        },
    }
}
