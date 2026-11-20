//! Screen take-over and hand-back notices ride on an agent's next brain
//! message: one text block per notice, after everything already in the last
//! user message (a user message that answers tool calls must start with its
//! `tool_result` blocks), as `<macro-runtime-notice>{json}</macro-runtime-notice>`.
//! They are delivered only once the model accepted the request; the caller
//! acknowledges them then.

use axum::body::Bytes;
use computer_screen::domain::models::{AgentNotice, PendingNotice};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use uuid::Uuid;

use crate::computers::screen::Screens;

#[cfg(test)]
mod test;

/// `body` with the agent's pending notices in it, and the ids to
/// acknowledge once upstream accepted it. A body without a user message, or
/// a failed read, goes as it came and leaves the notices for the next
/// request.
pub(super) async fn deliver(
    body: Bytes,
    screens: &Screens,
    agent: &MacroUserIdStr<'_>,
) -> (Bytes, Vec<Uuid>) {
    let Ok(mut request) = serde_json::from_slice::<Value>(&body) else {
        return (body, Vec::new());
    };
    if last_user_message(&mut request).is_none() {
        return (body, Vec::new());
    }
    let pending = match screens.pending_notices(agent).await {
        Ok(pending) => pending,
        Err(error) => {
            tracing::warn!(error = ?error, "could not read the agent's screen notices");
            return (body, Vec::new());
        }
    };
    if pending.is_empty() {
        return (body, Vec::new());
    }
    tracing::info!(
        notices = pending.len(),
        "delivering screen notices to the agent"
    );
    let ids: Vec<Uuid> = pending.iter().map(|pending| pending.id).collect();
    let notices: Vec<AgentNotice> = pending
        .into_iter()
        .map(|PendingNotice { notice, .. }| notice)
        .collect();
    insert(&mut request, &notices);
    match serde_json::to_vec(&request) {
        Ok(rewritten) => (Bytes::from(rewritten), ids),
        Err(_) => (body, Vec::new()),
    }
}

fn last_user_message(request: &mut Value) -> Option<&mut Value> {
    request
        .get_mut("messages")?
        .as_array_mut()?
        .iter_mut()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
}

/// The frame of one notice. The JSON escapes `<`, `>` and `&`, so a note
/// or a name can't close the frame early.
fn frame(notice: &AgentNotice) -> String {
    let payload = serde_json::to_string(notice)
        .unwrap_or_default()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
    format!("<macro-runtime-notice>{payload}</macro-runtime-notice>")
}

/// Put `notices` last in the last user message of `request`.
fn insert(request: &mut Value, notices: &[AgentNotice]) {
    let Some(message) = last_user_message(request) else {
        return;
    };
    let blocks = notices
        .iter()
        .map(|notice| serde_json::json!({ "type": "text", "text": frame(notice) }));
    let content = match message.get_mut("content").map(Value::take) {
        Some(Value::String(text)) => vec![serde_json::json!({ "type": "text", "text": text })],
        Some(Value::Array(content)) => content,
        _ => Vec::new(),
    };
    message["content"] = Value::Array(content.into_iter().chain(blocks).collect());
}
