//! Screen take-over and hand-back notices ride on an agent's next brain
//! message: one text block per notice, after everything already in the last
//! user message (a user message that answers tool calls must start with its
//! `tool_result` blocks), as `<macro-runtime-notice>{json}</macro-runtime-notice>`.
//! They go only to the agent's main loop: a request its runtime marks
//! [`MAIN_LOOP_HEADER`] `main` that offers tools, so neither a side query
//! of the runtime (asking a person, a call's brain) nor a tool-less side
//! call of Claude Code's takes them. Each is claimed by one request at a
//! time, so two concurrent requests never both carry it; the caller
//! acknowledges them once the model's answer finished, and gives them back
//! when it didn't.

use axum::body::Bytes;
use axum::http::HeaderMap;
use computer_screen::domain::models::{AgentNotice, NoticeClaim, PendingNotice};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;

use crate::computers::screen::Screens;

#[cfg(test)]
mod test;

/// The header the agent's runtime sets on its main loop's requests
/// (`packages/starter-agent`, `behavior/agent/claude.ts`).
pub(crate) const MAIN_LOOP_HEADER: &str = "x-macro-agent-loop";

/// Whether a request is the agent's main loop: marked, and offering tools.
fn main_loop(headers: &HeaderMap, request: &Value) -> bool {
    let marked = headers
        .get(MAIN_LOOP_HEADER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("main"));
    let offers_tools = request
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| !tools.is_empty());
    marked && offers_tools
}

/// `body` with the agent's pending notices in it, and the claims to
/// acknowledge once upstream's answer finished (or give back when it
/// didn't). A
/// request that isn't the main loop, a body without a user message, or a
/// failed read goes as it came and leaves the notices for the next one.
pub(super) async fn deliver(
    body: Bytes,
    headers: &HeaderMap,
    screens: &Screens,
    agent: &MacroUserIdStr<'_>,
) -> (Bytes, Vec<NoticeClaim>) {
    let Ok(mut request) = serde_json::from_slice::<Value>(&body) else {
        return (body, Vec::new());
    };
    if !main_loop(headers, &request) || last_user_message(&mut request).is_none() {
        return (body, Vec::new());
    }
    let pending = match screens.claim_notices(agent).await {
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
    let claims: Vec<NoticeClaim> = pending.iter().map(|pending| pending.claim).collect();
    insert(&mut request, &pending);
    match serde_json::to_vec(&request) {
        Ok(rewritten) => (Bytes::from(rewritten), claims),
        Err(_) => {
            if let Err(error) = screens.notices_returned(&claims).await {
                tracing::warn!(error = ?error, "could not give screen notices back");
            }
            (body, Vec::new())
        }
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

/// A notice as the agent reads it: with its id, the same each time it is
/// carried, so a notice given back and carried again (its first answer
/// may have reached the agent after all) reads as the same notice.
#[derive(serde::Serialize)]
struct Framed<'a> {
    id: uuid::Uuid,
    #[serde(flatten)]
    notice: &'a AgentNotice,
}

/// The frame of one notice. The JSON escapes `<`, `>` and `&`, so a note
/// or a name can't close the frame early.
fn frame(pending: &PendingNotice) -> String {
    let framed = Framed {
        id: pending.claim.id,
        notice: &pending.notice,
    };
    let payload = serde_json::to_string(&framed)
        .unwrap_or_default()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
    format!("<macro-runtime-notice>{payload}</macro-runtime-notice>")
}

/// Put `notices` last in the last user message of `request`.
fn insert(request: &mut Value, notices: &[PendingNotice]) {
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
