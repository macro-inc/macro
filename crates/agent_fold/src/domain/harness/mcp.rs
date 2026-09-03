//! MCP's shapes, as they reach the fold through any harness.
//!
//! Not a harness: MCP is the protocol a harness reaches Macro's tools over,
//! and it wraps every result the same way whoever the harness is. Two of its
//! shapes matter here:
//!
//! - [`CallToolResult`] - `{ content: [blocks], structuredContent?, isError? }`.
//!   A harness may copy that whole envelope into ACP's `rawOutput` rather
//!   than the tool's own JSON, so the fold unwraps it before reading. Its
//!   content blocks are the same shape as ACP's [`ContentBlock`], which is
//!   what they deserialize as.
//! - [`UserToolResponse`] - what Macro's *user tools* (`SendEmail`,
//!   `CreateCalendarEvent`) return: `"PendingUserExecution"` until the user
//!   acts, then `"Rejected"` or `{ "UserAction": T }`. Mirrors
//!   `ai_toolset::UserToolResponse`, restated here so the wasm fold does not
//!   depend on the toolset crate.
//!
//! Macro's own in-process agent calls its tools directly, so its output
//! arrives bare; [`unwrap_call_result`] leaves a bare value alone.

use agent_client_protocol::schema::v1::ContentBlock;
use serde::Deserialize;
use serde_json::Value;

use crate::domain::model::UserToolOutcome;

/// Macro tools the agent drafts and the user finishes.
///
/// Registered with `add_user_tool` on the backend: calling one returns
/// `"PendingUserExecution"` and performs nothing until the user acts through
/// the session's own API. The fold folds them to
/// [`ToolDetail::UserTool`](crate::domain::model::ToolDetail::UserTool) so a
/// reader can mount the compose surface rather than a result card.
pub const USER_TOOLS: &[&str] = &["SendEmail", "CreateCalendarEvent"];

/// Whether `tool` is a Macro user tool.
#[must_use]
pub fn is_user_tool(tool: &str) -> bool {
    USER_TOOLS.contains(&tool)
}

/// MCP's `CallToolResult`, as far as the fold reads it.
///
/// Deserializing an object into this is how an envelope is recognized: a
/// tool's own JSON may well have a `content` field (`ReadContent` returns
/// `{ content: { text }, comments }`), but only an array of typed blocks
/// deserializes as one, and an object with neither `content` nor
/// `structuredContent` is no envelope at all.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CallToolResult {
    content: Option<Vec<ContentBlock>>,
    structured_content: Option<Value>,
    #[serde(default)]
    is_error: bool,
}

impl CallToolResult {
    /// The envelope `raw` is, if it is one.
    fn recognize(raw: &Value) -> Option<Self> {
        match raw {
            Value::Object(_) => {
                let result: Self = serde_json::from_value(raw.clone()).ok()?;
                (result.content.is_some() || result.structured_content.is_some()).then_some(result)
            }
            // How Claude Code copies `content` into `rawOutput`: the blocks
            // alone, no envelope around them.
            Value::Array(items) if !items.is_empty() => {
                let content: Vec<ContentBlock> = serde_json::from_value(raw.clone()).ok()?;
                Some(Self {
                    content: Some(content),
                    structured_content: None,
                    is_error: false,
                })
            }
            _ => None,
        }
    }

    /// The text blocks' text, in order.
    fn texts(&self) -> Vec<&str> {
        self.content
            .iter()
            .flatten()
            .filter_map(|block| match block {
                ContentBlock::Text(text) => Some(text.text.as_str()),
                _ => None,
            })
            .collect()
    }
}

/// A tool's own result, with any MCP [`CallToolResult`] envelope removed,
/// and the error text when the envelope marked the call failed.
///
/// Preference order for the payload: `structuredContent`; else the first
/// text block that parses as JSON; else the text blocks joined as a string;
/// else `null`. A value that is not an envelope is returned untouched.
#[must_use]
pub fn unwrap_call_result(raw: &Value) -> (Value, Option<String>) {
    let Some(result) = CallToolResult::recognize(raw) else {
        return (raw.clone(), None);
    };
    let texts = result.texts();
    let error = result.is_error.then(|| texts.join("\n"));

    if let Some(structured) = result.structured_content {
        return (structured, error);
    }
    if let Some(parsed) = texts
        .iter()
        .find_map(|text| serde_json::from_str::<Value>(text).ok())
    {
        return (parsed, error);
    }
    if texts.is_empty() {
        return (Value::Null, error);
    }
    (Value::String(texts.join("\n")), error)
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
