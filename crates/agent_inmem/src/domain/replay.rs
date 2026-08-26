//! Rebuilding a session's model-facing conversation from its durable log.
//!
//! The conversation an in-process agent runs its turns from lives in memory
//! ([`SessionState`](crate::domain::session::SessionState)), so a process
//! restart would otherwise start the model's context over even though the
//! frame log still holds the whole session. This module is the other half of
//! [`update_for_part`](crate::domain::agent): it walks the logged frames -
//! which this same agent wrote - and turns them back into the
//! [`HistoryEntry`] list the next turn is built from.
//!
//! Replay is deliberately lenient: a frame it does not recognize contributes
//! nothing rather than failing the attach, because a partially-rebuilt
//! context is strictly better than none. Two shapes are intentionally lossy:
//! thought chunks are skipped (past reasoning is not replayed to the model),
//! and a tool call is rebuilt under the display title it was streamed with,
//! which for the Macro product toolset is the tool name itself.

use agent::types::AssistantMessagePart;
use agent_client_protocol::schema::v1::{
    ContentBlock, PromptRequest, SessionNotification, SessionUpdate, ToolCallStatus,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::action::COMPACT_COMMAND;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::Message;
use futures::future::BoxFuture;

use crate::domain::agent::close_dangling_tool_calls;
use crate::domain::session::HistoryEntry;

#[cfg(test)]
mod test;

/// Where a session's durable frames come from when its conversation has to
/// be rebuilt - a cold attach in a process that has never served the session.
///
/// Failures degrade to an empty history (the model's context starts over,
/// which was every restart's behavior before replay existed) rather than
/// failing the attach.
pub trait FrameSource: Send + Sync + 'static {
    /// The session's logged frames, oldest first.
    fn frames(
        &self,
        session: agent_session::domain::model::AgentSessionId,
    ) -> BoxFuture<'_, Vec<Message>>;
}

/// Rebuild the conversation the log's frames recorded, oldest first.
///
/// User prompts open turns and `session/update` notifications fill them in,
/// mirroring what the live agent pushed into its history as the turn ran. A
/// `/compact` prompt drops everything recorded before it, exactly as the live
/// agent's compact handling cleared its history.
#[must_use]
pub fn replay_history(frames: impl IntoIterator<Item = Message>) -> Vec<HistoryEntry> {
    let mut history = Vec::new();
    let mut open: Option<(String, Vec<AssistantMessagePart>)> = None;

    for frame in frames {
        match frame {
            Message::ToRuntime(ToRuntimeMessage::Acp(acp)) => {
                let RawJsonRpcMessage::Request(request) = &acp.0 else {
                    continue;
                };
                if !PromptRequest::matches_method(&request.method) {
                    continue;
                }
                let Some(prompt) = deserialize_params::<PromptRequest>(request.params.as_ref())
                else {
                    continue;
                };
                let text: String = prompt
                    .prompt
                    .iter()
                    .filter_map(|block| match block {
                        ContentBlock::Text(text) => Some(text.text.as_str()),
                        _ => None,
                    })
                    .collect();
                close_turn(&mut history, &mut open);
                if text.trim() == COMPACT_COMMAND {
                    // Compaction dropped everything before it from the
                    // model's context; replaying it back would undo that.
                    history.clear();
                } else {
                    open = Some((text, Vec::new()));
                }
            }
            Message::ToServer(ToServerMessage::Acp(acp)) => {
                let RawJsonRpcMessage::Notification(notification) = &acp.0 else {
                    continue;
                };
                if !SessionNotification::matches_method(&notification.method) {
                    continue;
                }
                let Some(notification) =
                    deserialize_params::<SessionNotification>(notification.params.as_ref())
                else {
                    continue;
                };
                // An update outside any turn (the compact acknowledgement,
                // status chatter) is presentation, not conversation.
                if let Some((_, parts)) = open.as_mut() {
                    apply_update(parts, notification.update);
                }
            }
            _ => {}
        }
    }
    close_turn(&mut history, &mut open);
    history
}

/// Fold one `session/update` back into the open turn's parts.
fn apply_update(parts: &mut Vec<AssistantMessagePart>, update: SessionUpdate) {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            let ContentBlock::Text(text) = chunk.content else {
                return;
            };
            // Chunks are streamed deltas; coalesce them back into one part.
            if let Some(AssistantMessagePart::Text { text: last }) = parts.last_mut() {
                last.push_str(&text.text);
            } else {
                parts.push(AssistantMessagePart::Text { text: text.text });
            }
        }
        SessionUpdate::ToolCall(call) => {
            parts.push(AssistantMessagePart::ToolCall {
                name: call.title.clone(),
                json: call.raw_input.clone().unwrap_or(serde_json::Value::Null),
                id: call.tool_call_id.0.to_string(),
            });
        }
        SessionUpdate::ToolCallUpdate(update) => {
            let id = update.tool_call_id.0.to_string();
            // Only a call this turn opened and has not answered yet can be
            // closed; anything else would poison the provider payload.
            let Some(name) = unanswered_call_name(parts, &id) else {
                return;
            };
            match update.fields.status {
                Some(ToolCallStatus::Completed) => {
                    parts.push(AssistantMessagePart::ToolCallResponseJson {
                        name,
                        json: update
                            .fields
                            .raw_output
                            .clone()
                            .unwrap_or(serde_json::Value::Null),
                        id,
                    });
                }
                Some(ToolCallStatus::Failed) => {
                    let description = update
                        .fields
                        .raw_output
                        .as_ref()
                        .and_then(|output| output.get("error"))
                        .and_then(|error| error.as_str())
                        .unwrap_or("cancelled")
                        .to_owned();
                    parts.push(AssistantMessagePart::ToolCallErr {
                        name,
                        description,
                        id,
                    });
                }
                _ => {}
            }
        }
        // Thought chunks are not replayed to the model, and everything else
        // the protocol can carry is presentation this agent never emits.
        _ => {}
    }
}

/// The name of the turn's tool call `id`, when it exists and has no response
/// yet.
fn unanswered_call_name(parts: &[AssistantMessagePart], id: &str) -> Option<String> {
    let responded = parts.iter().any(|part| match part {
        AssistantMessagePart::ToolCallResponseJson { id: answered, .. }
        | AssistantMessagePart::ToolCallErr { id: answered, .. } => answered == id,
        _ => false,
    });
    if responded {
        return None;
    }
    parts.iter().find_map(|part| match part {
        AssistantMessagePart::ToolCall { name, id: call, .. }
        | AssistantMessagePart::McpToolCall { name, id: call, .. }
            if call == id =>
        {
            Some(name.clone())
        }
        _ => None,
    })
}

/// Push the open turn into the history, closing whatever it left dangling.
fn close_turn(
    history: &mut Vec<HistoryEntry>,
    open: &mut Option<(String, Vec<AssistantMessagePart>)>,
) {
    let Some((prompt, mut parts)) = open.take() else {
        return;
    };
    let _ = close_dangling_tool_calls(&mut parts);
    history.push(HistoryEntry::User(prompt));
    if !parts.is_empty() {
        history.push(HistoryEntry::Assistant(parts));
    }
}

/// Deserialize a frame's params, `None` when the shape does not match.
fn deserialize_params<T: serde::de::DeserializeOwned>(
    params: Option<&RawJsonRpcParams>,
) -> Option<T> {
    match params? {
        RawJsonRpcParams::Object(map) => {
            serde_json::from_value(serde_json::Value::Object(map.clone())).ok()
        }
        RawJsonRpcParams::Array(_) => None,
    }
}
