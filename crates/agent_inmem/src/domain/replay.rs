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
//! context is strictly better than none. Thought chunks are skipped (past
//! reasoning is not replayed to the model). Tool calls use their canonical
//! name from `_meta.macro.toolName`; only older frames without that metadata
//! fall back to the display title.

use agent::ReasoningEffort;
use agent::types::AssistantMessagePart;
use agent_client_protocol::schema::v1::{
    ContentBlock, PromptRequest, SessionNotification, SessionUpdate, ToolCallStatus,
};
use agent_client_protocol::schema::v1::{
    RequestId, Response, SessionConfigKind, SessionConfigOption,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::Message;
use futures::future::BoxFuture;
use std::collections::{HashMap, HashSet};

use crate::domain::agent::{META_NAMESPACE, TURN_FAILED_REPLY, close_dangling_tool_calls};
use crate::domain::model_options::REASONING_EFFORT_CONFIG_ID;
use crate::domain::session::{HistoryEntry, UserPrompt, end_of_turn, splice_summary};
use agent_runtime_protocol::domain::context::ContextSummaryNotification;

#[cfg(test)]
mod test;

/// Where a session's durable frames come from when its conversation has to
/// be rebuilt - a cold attach in a process that has never served the session.
///
/// A failed read must fail the attach. An unavailable log is not an empty
/// conversation: silently forgetting it would misrepresent the agent's memory.
pub trait FrameSource: Send + Sync + 'static {
    /// The session's logged frames, oldest first.
    fn frames(
        &self,
        session: agent_session::domain::model::AgentSessionId,
    ) -> BoxFuture<'_, agent_session::domain::error::Result<Vec<Message>>>;
}

/// A turn replay has opened and not yet closed.
struct OpenTurn {
    /// The `session/prompt` request that opened it. The agent's response to
    /// it closes the turn, and the turn is known by its id.
    id: RequestId,
    prompt: UserPrompt,
    parts: Vec<AssistantMessagePart>,
}

/// Rebuild the conversation the log's frames recorded, oldest first.
///
/// User prompts open turns, `session/update` notifications fill them in, and
/// the agent's response closes them, mirroring what the live agent pushed
/// into its history as each turn ran. A prompt the agent refused never
/// entered it. A summary lands where the live one did: the log records it
/// ([`ContextSummaryNotification`]) at the point the live agent spliced it
/// in, naming the last turn it covers, so it replaces the same turns.
///
/// The rebuilt entries are not always the live ones, which is why a summary
/// goes by turn rather than by count: a prompt stopped before it ran is in
/// the log but never entered the live history, and reasoning is not replayed
/// (the model is never sent it). A failed turn rebuilds as the live agent kept
/// it, without the failure reply it sent its reader.
#[must_use]
pub fn replay_history(frames: impl IntoIterator<Item = Message>) -> Vec<HistoryEntry> {
    let mut history = Vec::new();
    let mut open: Option<OpenTurn> = None;
    let mut writing = WritingCalls::default();

    for frame in frames {
        match frame {
            Message::ToRuntime(ToRuntimeMessage::Acp(acp))
            | Message::Notification(ToRuntimeMessage::Acp(acp)) => {
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
                close_turn(&mut history, &mut open);
                writing = WritingCalls::default();
                open = Some(OpenTurn {
                    id: request.id.clone(),
                    prompt: UserPrompt::from_blocks(&prompt.prompt),
                    parts: Vec::new(),
                });
            }
            Message::ToServer(ToServerMessage::Acp(acp)) => {
                if let Some(id) = acp.0.response_id()
                    && open.as_ref().is_some_and(|turn| &turn.id == id)
                {
                    let failed =
                        matches!(acp.0, RawJsonRpcMessage::Response(Response::Error { .. }));
                    // A turn that failed after it ran told its reader so in a
                    // last text chunk the live agent never kept; it kept the
                    // prompt and whatever the turn said before.
                    let ran = failed
                        && open
                            .as_mut()
                            .is_some_and(|turn| strip_failure_reply(&mut turn.parts));
                    // The live agent answers a prompt it will not run - over
                    // its owner's budget, too long - before keeping it.
                    let refused =
                        failed && !ran && open.as_ref().is_some_and(|turn| turn.parts.is_empty());
                    if refused {
                        open = None;
                    } else {
                        close_turn(&mut history, &mut open);
                    }
                    continue;
                }
                let RawJsonRpcMessage::Notification(notification) = &acp.0 else {
                    continue;
                };
                if ContextSummaryNotification::matches_method(&notification.method) {
                    if let Some(summary) = deserialize_params::<ContextSummaryNotification>(
                        notification.params.as_ref(),
                    ) {
                        // A log from before summaries named their last turn
                        // says only how many live entries one replaced. One
                        // whose last turn the log does not hold is left out:
                        // the conversation stays whole rather than losing
                        // turns it never covered.
                        let end = match &summary.through {
                            Some(through) => end_of_turn(&history, through),
                            None => Some(summary.replaces),
                        };
                        if let Some(end) = end {
                            splice_summary(&mut history, summary.text, end);
                        }
                    }
                    continue;
                }
                if !SessionNotification::matches_method(&notification.method) {
                    continue;
                }
                let Some(notification) =
                    deserialize_params::<SessionNotification>(notification.params.as_ref())
                else {
                    continue;
                };
                // An update outside any turn (status chatter) is
                // presentation, not conversation.
                if let Some(turn) = open.as_mut() {
                    apply_update(&mut turn.parts, &mut writing, notification.update);
                }
            }
            _ => {}
        }
    }
    close_turn(&mut history, &mut open);
    history
}

/// Rebuild the last valid reasoning-effort selection from durable frames.
#[must_use]
pub fn replay_reasoning_effort(frames: &[Message]) -> ReasoningEffort {
    replay_config(frames, effort_from_options)
}

/// Restore the last confirmed speed selection after a runtime restart.
pub fn replay_speed(frames: &[Message]) -> agent::ModelSpeed {
    replay_config(frames, |options| {
        options
            .iter()
            .find_map(|option| {
                if option.id.to_string() != "speed" {
                    return None;
                }
                let SessionConfigKind::Select(select) = &option.kind else {
                    return None;
                };
                agent::ModelSpeed::parse(&select.current_value.to_string())
            })
            .unwrap_or_default()
    })
}

fn replay_config<T: Default>(frames: &[Message], read: impl Fn(&[SessionConfigOption]) -> T) -> T {
    let mut pending = HashSet::new();
    let mut current = T::default();
    for frame in frames {
        match frame {
            Message::ToRuntime(ToRuntimeMessage::Acp(acp)) => {
                if let RawJsonRpcMessage::Request(request) = &acp.0
                    && matches!(
                        request.method.as_ref(),
                        "session/new"
                            | "session/load"
                            | "session/resume"
                            | "session/set_config_option"
                    )
                {
                    pending.insert(request.id.clone());
                }
            }
            Message::ToServer(ToServerMessage::Acp(acp)) => match &acp.0 {
                RawJsonRpcMessage::Response(Response::Result { id, result })
                    if pending.remove(id) =>
                {
                    if let Some(options) = result.get("configOptions").and_then(|options| {
                        serde_json::from_value::<Vec<SessionConfigOption>>(options.clone()).ok()
                    }) {
                        current = read(&options);
                    }
                }
                RawJsonRpcMessage::Response(Response::Error { id, .. }) => {
                    pending.remove(id);
                }
                RawJsonRpcMessage::Notification(notification) => {
                    if let Some(SessionNotification {
                        update: SessionUpdate::ConfigOptionUpdate(update),
                        ..
                    }) = deserialize_params::<SessionNotification>(notification.params.as_ref())
                    {
                        current = read(&update.config_options);
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    current
}

/// Take the failure reply off the end of a failed turn's parts, the way the
/// live agent's history never had it. Answers whether there was one: only a
/// turn that ran sends it.
fn strip_failure_reply(parts: &mut Vec<AssistantMessagePart>) -> bool {
    let Some(AssistantMessagePart::Text { text }) = parts.last_mut() else {
        return false;
    };
    let Some(said) = text.strip_suffix(TURN_FAILED_REPLY) else {
        return false;
    };
    // Set apart with a blank line when the turn had said something.
    let kept = said.strip_suffix("\n\n").unwrap_or(said).to_owned();
    if kept.is_empty() {
        parts.pop();
    } else {
        *text = kept;
    }
    true
}

/// Calls the turn opened `pending` - the model was still writing them - by
/// id, with the tool name and title they opened under. The live agent only
/// adds a call to its history once it is finished, so replay holds these back
/// until the update that starts them, and a call the turn ended in the middle
/// of never enters the history at all.
#[derive(Default)]
struct WritingCalls(HashMap<String, (String, String)>);

/// The tool name a logged call ran under: `_meta.macro.toolName`, else (for
/// frames from before it) the title.
fn logged_tool_name(meta: Option<&agent_client_protocol::schema::v1::Meta>, title: &str) -> String {
    meta.and_then(|meta| meta.get(META_NAMESPACE))
        .and_then(|meta| meta.get("toolName"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or(title)
        .to_owned()
}

/// The history part the live agent recorded for a call to `tool_name`.
///
/// An MCP tool runs under its mangled name (`mcp__<server>__<tool>`), and the
/// live agent records it as an [`AssistantMessagePart::McpToolCall`] split the
/// way routing splits that name, with the server's display title when it gave
/// one (the title is the mangled name otherwise).
fn tool_call_part(
    tool_name: String,
    title: &str,
    json: serde_json::Value,
    id: String,
) -> AssistantMessagePart {
    match mcp_toolset::unmangle(&tool_name) {
        Some((service, tool)) => AssistantMessagePart::McpToolCall {
            name: tool.to_owned(),
            service: service.to_owned(),
            display_name: (title != tool_name).then(|| title.to_owned()),
            json,
            id,
        },
        None => AssistantMessagePart::ToolCall {
            name: tool_name,
            json,
            id,
        },
    }
}

/// Fold one `session/update` back into the open turn's parts.
fn apply_update(
    parts: &mut Vec<AssistantMessagePart>,
    writing: &mut WritingCalls,
    update: SessionUpdate,
) {
    match update {
        SessionUpdate::ToolCall(call) if call.status == ToolCallStatus::Pending => {
            writing.0.insert(
                call.tool_call_id.0.to_string(),
                (
                    logged_tool_name(call.meta.as_ref(), &call.title),
                    call.title.clone(),
                ),
            );
        }
        SessionUpdate::ToolCallUpdate(update)
            if writing.0.contains_key(update.tool_call_id.0.as_ref()) =>
        {
            let id = update.tool_call_id.0.to_string();
            match update.fields.status {
                // A peek at the arguments so far.
                Some(ToolCallStatus::Pending) | None => {}
                Some(ToolCallStatus::InProgress) => {
                    let (name, title) = writing.0.remove(&id).unwrap_or_default();
                    parts.push(tool_call_part(
                        name,
                        &title,
                        update.fields.raw_input.unwrap_or(serde_json::Value::Null),
                        id,
                    ));
                }
                // Closed before the model finished writing it: it never ran.
                Some(_) => {
                    writing.0.remove(&id);
                }
            }
        }
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
            parts.push(tool_call_part(
                logged_tool_name(call.meta.as_ref(), &call.title),
                &call.title,
                call.raw_input.clone().unwrap_or(serde_json::Value::Null),
                call.tool_call_id.0.to_string(),
            ));
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
                    // A failure with no error is the live agent closing a call
                    // its turn ended under. It recorded that close under the
                    // call's own name when the turn ended, which is where
                    // `close_turn` closes it here too.
                    let Some(description) = update
                        .fields
                        .raw_output
                        .as_ref()
                        .and_then(|output| output.get("error"))
                        .and_then(|error| error.as_str())
                    else {
                        return;
                    };
                    parts.push(AssistantMessagePart::ToolCallErr {
                        name,
                        description: description.to_owned(),
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

/// The name the turn's tool call `id` ran under - an MCP tool's mangled name,
/// as the live agent records its result - when it exists and has no response
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
        AssistantMessagePart::ToolCall { name, id: call, .. } if call == id => Some(name.clone()),
        AssistantMessagePart::McpToolCall {
            name,
            service,
            id: call,
            ..
        } if call == id => Some(format!("mcp__{service}__{name}")),
        _ => None,
    })
}

/// The command that cleared the model's context before summaries kept it
/// bounded, and what the agent answered it with. Logs from then still carry
/// both; a `/compact` sent since is a message like any other.
const OLD_COMPACT_COMMAND: &str = "/compact";
const CLEARED_CONTEXT: &str =
    "Compacted: the earlier conversation is no longer in the model's context.";

/// Push the open turn into the history, closing whatever it left dangling.
fn close_turn(history: &mut Vec<HistoryEntry>, open: &mut Option<OpenTurn>) {
    let Some(OpenTurn {
        id,
        prompt,
        mut parts,
    }) = open.take()
    else {
        return;
    };
    let cleared = prompt.text.trim() == OLD_COMPACT_COMMAND
        && prompt.attachments.is_empty()
        && matches!(
            parts.as_slice(),
            [AssistantMessagePart::Text { text }] if text == CLEARED_CONTEXT
        );
    if cleared {
        // What the live agent cleared then stays cleared.
        history.clear();
        return;
    }
    let _ = close_dangling_tool_calls(&mut parts);
    history.push(HistoryEntry::User {
        prompt,
        request_id: id,
    });
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

fn effort_from_options(options: &[SessionConfigOption]) -> ReasoningEffort {
    options
        .iter()
        .find_map(|option| {
            if option.id.to_string() != REASONING_EFFORT_CONFIG_ID {
                return None;
            }
            let SessionConfigKind::Select(select) = &option.kind else {
                return None;
            };
            select.current_value.to_string().parse().ok()
        })
        .unwrap_or_default()
}
