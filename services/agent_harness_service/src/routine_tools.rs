//! Run catalog tools for routine steps in-process, as the routine owner.
//!
//! The same tools, contexts and side effects (Gmail operations, events,
//! notifications) the in-process agent uses. The scheduler decides which tools
//! a routine may call; this adapter only runs them.

use std::sync::Arc;

use agent_session::domain::routines::{RoutineSessionError, RoutineToolOutcome, RoutineToolRunner};
use ai_tools::{AiHost, AiToolSet, ToolServiceContext, tools_for};
use ai_toolset::{RequestContext, ToolSet, ToolSetError};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Map, Value};

#[cfg(test)]
mod test;

/// Largest output returned to the scheduler. Routine tools are writes with
/// small outputs; anything larger is dropped rather than truncated into
/// invalid JSON.
const MAX_OUTPUT_BYTES: usize = 32 * 1024;
/// Longest failure message returned to the scheduler.
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

impl RoutineToolRunner for CatalogRoutineTools {
    #[tracing::instrument(name = "routine.tool", skip_all, fields(tool), err)]
    async fn run(
        &self,
        owner: &MacroUserIdStr<'static>,
        tool: &str,
        arguments: Map<String, Value>,
    ) -> Result<RoutineToolOutcome, RoutineSessionError> {
        let mut context = self.context.clone();
        context.usage_context =
            ai_usage::UsageContext::new(ai_usage::AiFeature::Automation, owner.clone());
        let arguments = Value::Object(arguments);
        let result = self
            .toolset
            .try_tool_call(
                context,
                RequestContext::new(owner.clone()),
                tool,
                &arguments,
            )
            .await;
        Ok(outcome(tool, result))
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
            tracing::warn!(tool, error = ?error.internal_error, "routine tool failed");
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
