//! MCP's shapes, as they reach the fold through any harness.
//!
//! Not a harness: MCP is the protocol a harness reaches Macro's tools over,
//! and it wraps every result the same way whoever the harness is. Two of its
//! shapes matter here:
//!
//! - `CallToolResult` - `{ content: [blocks], structuredContent?, isError? }`.
//!   A harness may copy that whole envelope into ACP's `rawOutput` rather
//!   than the tool's own JSON, so the fold unwraps it before reading.
//! - `UserToolResponse<T>` - what Macro's *user tools* (`SendEmail`,
//!   `CreateCalendarEvent`) return: `"PendingUserExecution"` until the user
//!   acts, then `"Rejected"` or `{ "UserAction": T }`.
//!
//! Macro's own in-process agent calls its tools directly, so its output
//! arrives bare; [`unwrap_call_result`] leaves a bare value alone.

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

/// A tool's own result, with any MCP `CallToolResult` envelope removed, and
/// the error text when the envelope marked the call failed.
///
/// Preference order for the payload: `structuredContent`; else the first
/// `text` content block that parses as JSON; else the text blocks joined as
/// a string; else the value untouched. A bare array of content blocks (how
/// Claude Code copies `content` into `rawOutput`) is read the same way.
#[must_use]
pub fn unwrap_call_result(raw: &Value) -> (Value, Option<String>) {
    // An envelope is recognized by shape, not by key: a tool's own JSON may
    // well have a `content` field (`ReadContent` returns `{ content: { text },
    // comments }`), and only an array of typed blocks is MCP's.
    let (blocks, structured, is_error) = match raw {
        Value::Object(map) if is_envelope(map) => (
            map.get("content").and_then(Value::as_array),
            map.get("structuredContent"),
            map.get("isError").and_then(Value::as_bool).unwrap_or(false),
        ),
        Value::Array(items) if !items.is_empty() && items.iter().all(is_content_block) => {
            (Some(items), None, false)
        }
        _ => return (raw.clone(), None),
    };

    let texts: Vec<&str> = blocks
        .into_iter()
        .flatten()
        .filter_map(block_text)
        .collect();
    let error = is_error.then(|| texts.join("\n"));

    if let Some(structured) = structured {
        return (structured.clone(), error);
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

/// Whether an object is a `CallToolResult`: it carries `structuredContent`,
/// or its `content` is an array of typed blocks.
fn is_envelope(map: &serde_json::Map<String, Value>) -> bool {
    if map.contains_key("structuredContent") {
        return true;
    }
    map.get("content")
        .and_then(Value::as_array)
        .is_some_and(|blocks| blocks.iter().all(is_content_block))
}

fn is_content_block(value: &Value) -> bool {
    value
        .as_object()
        .and_then(|block| block.get("type"))
        .and_then(Value::as_str)
        .is_some()
}

fn block_text(block: &Value) -> Option<&str> {
    let block = block.as_object()?;
    if block.get("type")?.as_str()? != "text" {
        return None;
    }
    block.get("text")?.as_str()
}

/// Read a `UserToolResponse<T>` value into an outcome.
///
/// `value` is the tool's own result, already unwrapped. `tool` picks the
/// `UserAction` shape: `SendEmail` distinguishes sent from saved-as-draft,
/// anything else reports the action's payload whole.
#[must_use]
pub fn user_tool_outcome(tool: &str, value: &Value) -> UserToolOutcome {
    match value {
        Value::Null => UserToolOutcome::Pending,
        Value::String(word) if word == "PendingUserExecution" => UserToolOutcome::Pending,
        Value::String(word) if word == "Rejected" => UserToolOutcome::Rejected,
        Value::Object(map) if map.len() == 1 => match map.get("UserAction") {
            Some(action) => user_action_outcome(tool, action),
            None => UserToolOutcome::Unrecognized,
        },
        _ => UserToolOutcome::Unrecognized,
    }
}

fn user_action_outcome(tool: &str, action: &Value) -> UserToolOutcome {
    if action.as_str() == Some("userEdited") {
        return UserToolOutcome::Edited;
    }
    if tool == "SendEmail" {
        if let Some(sent) = action.get("sent")
            && let (Some(message_id), Some(thread_id)) = (
                sent.get("message_id").and_then(Value::as_str),
                sent.get("thread_id").and_then(Value::as_str),
            )
        {
            return UserToolOutcome::Sent {
                message_id: message_id.to_owned(),
                thread_id: thread_id.to_owned(),
            };
        }
        if let Some(draft) = action.get("convertedToDraft")
            && let Some(draft_id) = draft.get("draft_id").and_then(Value::as_str)
        {
            return UserToolOutcome::Draft {
                draft_id: draft_id.to_owned(),
                thread_id: draft
                    .get("thread_id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
            };
        }
        return UserToolOutcome::Unrecognized;
    }
    UserToolOutcome::Completed {
        result: action.clone(),
    }
}
