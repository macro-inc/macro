//! Screen take-over and hand-back notices ride on an agent's next brain
//! message: one text block per notice, first in the last user message, as
//! `<macro-runtime-notice>{json}</macro-runtime-notice>`.

use axum::body::Bytes;
use computer_screen::domain::models::AgentNotice;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;

use crate::computers::screen::Screens;

#[cfg(test)]
mod test;

/// `body` with the agent's pending notices in it. A body without a user
/// message, or a failed read, goes as it came and leaves the notices for
/// the next request.
pub(super) async fn deliver(body: Bytes, screens: &Screens, agent: &MacroUserIdStr<'_>) -> Bytes {
    let Ok(mut request) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    if last_user_message(&mut request).is_none() {
        return body;
    }
    let notices = match screens.take_notices(agent).await {
        Ok(notices) => notices,
        Err(error) => {
            tracing::warn!(error = ?error, "could not read the agent's screen notices");
            return body;
        }
    };
    if notices.is_empty() {
        return body;
    }
    tracing::info!(
        notices = notices.len(),
        "delivering screen notices to the agent"
    );
    insert(&mut request, &notices);
    serde_json::to_vec(&request)
        .map(Bytes::from)
        .unwrap_or(body)
}

fn last_user_message(request: &mut Value) -> Option<&mut Value> {
    request
        .get_mut("messages")?
        .as_array_mut()?
        .iter_mut()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
}

/// Put `notices` first in the last user message of `request`.
fn insert(request: &mut Value, notices: &[AgentNotice]) {
    let Some(message) = last_user_message(request) else {
        return;
    };
    let blocks: Vec<Value> = notices
        .iter()
        .map(|notice| {
            let payload = serde_json::to_string(notice).unwrap_or_default();
            serde_json::json!({
                "type": "text",
                "text": format!("<macro-runtime-notice>{payload}</macro-runtime-notice>"),
            })
        })
        .collect();
    let content = match message.get_mut("content").map(Value::take) {
        Some(Value::String(text)) => vec![serde_json::json!({ "type": "text", "text": text })],
        Some(Value::Array(content)) => content,
        _ => Vec::new(),
    };
    message["content"] = Value::Array(blocks.into_iter().chain(content).collect());
}
