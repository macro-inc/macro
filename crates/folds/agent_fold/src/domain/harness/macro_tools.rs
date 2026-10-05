//! Macro as a tool provider: which tool names are Macro's, and what those
//! tools return.
//!
//! Not a harness either. Macro's tools reach the fold through whichever
//! harness called them - natively from Macro's own in-process agent, or over
//! Macro's MCP server from any other - and the harness decides how the result
//! is wrapped ([`HarnessReader::unwrap_tool_output`]). What is *inside* the
//! wrapper is Macro's whichever harness relayed it, and that is what this
//! module reads:
//!
//! - Which Macro tools are *user tools* - drafted by the agent, finished by
//!   the user - and the [`UserToolResponse`] they return. Mirrors
//!   `ai_toolset::UserToolResponse`, restated here so the wasm fold does not
//!   depend on the toolset crate.
//! - Macro's own delegation tool, `Subagent`, and its [`SubagentResponse`].
//!   Mirrors `ai_tools::subagent::SubagentResponse`.
//!
//! Every other Macro tool's result is the tool's own JSON, handed to a reader
//! as it is.
//!
//! [`HarnessReader::unwrap_tool_output`]: super::HarnessReader::unwrap_tool_output

use serde::Deserialize;
use serde_json::Value;

use crate::domain::model::{SubagentResult, ToolName, UserToolOutcome};

/// The name every session's server list gives Macro's own MCP server.
/// Mirrors `agent_harness::MACRO_MCP_NAME`; restated here rather than
/// imported so the wasm fold does not pull in the harness crate.
pub const MCP_SERVER: &str = "macro";

/// The Macro tool `name` reaches over Macro's own MCP server, if it is one.
/// A native name is never a Macro tool by this rule - Macro's in-process
/// agent is recognized by the harness it runs under, not by its tool names.
#[must_use]
pub fn mcp_tool(name: &ToolName) -> Option<&str> {
    match name {
        ToolName::Mcp { server, tool } if server == MCP_SERVER => Some(tool),
        ToolName::Native { .. } | ToolName::Mcp { .. } => None,
    }
}

/// Macro tools the agent drafts and the user finishes.
///
/// Registered with `add_user_tool` on the backend: calling one returns
/// `"PendingUserExecution"` and performs nothing until the user acts through
/// the session's own API.
pub const USER_TOOLS: &[&str] = &["SendEmail", "CreateCalendarEvent"];

/// Macro's own delegation tool. Mirrors `agent_inmem`'s `SUBAGENT_TOOL`.
pub const SUBAGENT_TOOL: &str = "Subagent";

/// What the fold does with a Macro tool, by its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacroTool<'name> {
    /// A user tool: folds to a draft the user finishes.
    User(&'name str),
    /// The `Subagent` tool: folds to a delegation, like a harness's own.
    Subagent,
    /// Any other Macro tool: folds to its own input and output.
    Other(&'name str),
}

impl<'name> MacroTool<'name> {
    /// Classify a Macro tool by name.
    #[must_use]
    pub fn of(tool: &'name str) -> Self {
        if USER_TOOLS.contains(&tool) {
            Self::User(tool)
        } else if tool == SUBAGENT_TOOL {
            Self::Subagent
        } else {
            Self::Other(tool)
        }
    }
}

/// What the `Subagent` tool returns: the child's answer as prose.
#[derive(Deserialize)]
struct SubagentResponse {
    result: String,
}

/// A `Subagent` call's result, from its own response (`value`, already
/// unwrapped) and the error its wrapper reported, if any. `None` when there
/// is neither.
#[must_use]
pub fn subagent_result(value: &Value, error: Option<String>) -> Option<SubagentResult> {
    let response: Option<SubagentResponse> = serde_json::from_value(value.clone()).ok();
    let result = SubagentResult {
        text: response
            .map(|response| response.result)
            .filter(|text| !text.is_empty()),
        error,
        ..SubagentResult::default()
    };
    (!result.is_empty()).then_some(result)
}

/// The backend's `UserToolResponse<T>`, with the action left as JSON: each
/// user tool defines its own.
#[derive(Debug, Deserialize)]
enum UserToolResponse {
    PendingUserExecution,
    Rejected,
    UserAction(Value),
}

/// `SendEmail`'s action, mirroring `email::SendEmailResponse`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SendEmailAction {
    Sent {
        message_id: String,
        thread_id: String,
    },
    ConvertedToDraft {
        draft_id: String,
        #[serde(default)]
        thread_id: Option<String>,
    },
    UserEdited,
}

/// Read a `UserToolResponse<T>` value into an outcome.
///
/// `value` is the tool's own result, already unwrapped. `tool` picks the
/// `UserAction` shape: `SendEmail` distinguishes sent from saved-as-draft,
/// anything else reports the action's payload whole.
#[must_use]
pub fn user_tool_outcome(tool: &str, value: &Value) -> UserToolOutcome {
    if value.is_null() {
        return UserToolOutcome::Pending;
    }
    let Ok(response) = serde_json::from_value::<UserToolResponse>(value.clone()) else {
        return UserToolOutcome::Unrecognized;
    };
    match response {
        UserToolResponse::PendingUserExecution => UserToolOutcome::Pending,
        UserToolResponse::Rejected => UserToolOutcome::Rejected,
        UserToolResponse::UserAction(action) => user_action_outcome(tool, action),
    }
}

fn user_action_outcome(tool: &str, action: Value) -> UserToolOutcome {
    // Every user tool's composer reports an edit the same way.
    if action.as_str() == Some("userEdited") {
        return UserToolOutcome::Edited;
    }
    if tool == "SendEmail" {
        return match serde_json::from_value::<SendEmailAction>(action) {
            Ok(SendEmailAction::Sent {
                message_id,
                thread_id,
            }) => UserToolOutcome::Sent {
                message_id,
                thread_id,
            },
            Ok(SendEmailAction::ConvertedToDraft {
                draft_id,
                thread_id,
            }) => UserToolOutcome::Draft {
                draft_id,
                thread_id,
            },
            Ok(SendEmailAction::UserEdited) => UserToolOutcome::Edited,
            Err(_) => UserToolOutcome::Unrecognized,
        };
    }
    UserToolOutcome::Completed { result: action }
}
