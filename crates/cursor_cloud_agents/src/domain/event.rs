//! The Cursor cloud event vocabulary.
//!
//! A run's SSE stream is a sequence of `(event name, JSON payload)` records.
//! This module names every record this crate understands, in the domain's own
//! vocabulary, so the translation ([`crate::domain::translate`]) and the
//! session service never see SSE framing or raw JSON. The shapes are taken
//! from recorded live streams — the Cursor docs name the events but not their
//! payloads — so unrecognized events and unrecognized `interaction_update`
//! subtypes are preserved as [`CursorEvent::Unknown`] and
//! [`InteractionUpdate::Other`] rather than dropped: the stream must survive
//! Cursor adding vocabulary.

#[cfg(test)]
mod test;

use crate::domain::model::{CursorRunId, RunStatus};
use serde::Deserialize;
use serde_json::Value;

/// One decoded event from a run's stream.
#[derive(Debug, Clone, PartialEq)]
pub enum CursorEvent {
    /// The run's lifecycle status changed (also sent once on connect).
    Status {
        /// The run the stream is reporting on.
        run_id: CursorRunId,
        /// Its current status.
        status: RunStatus,
    },
    /// A chunk of the agent's user-facing reply.
    Assistant {
        /// The text delta.
        text: String,
    },
    /// A chunk of the agent's reasoning.
    Thinking {
        /// The text delta.
        text: String,
    },
    /// A tool call was announced or progressed.
    ToolCall(ToolCallEvent),
    /// The undocumented SDK-shaped envelope. Most subtypes duplicate the
    /// documented events one-for-one; the ones that carry anything unique are
    /// modelled in [`InteractionUpdate`].
    Interaction(InteractionUpdate),
    /// The run reached a terminal state.
    Result {
        /// The run that ended.
        run_id: CursorRunId,
        /// The terminal status — `Finished` on success.
        status: RunStatus,
        /// The agent's final reply, when there is one.
        text: Option<String>,
        /// Wall-clock duration of the run.
        duration_ms: Option<u64>,
    },
    /// A keepalive; carries nothing.
    Heartbeat,
    /// The server reported a stream-level error.
    Error {
        /// A machine-readable code.
        code: Option<String>,
        /// A human-readable message.
        message: String,
    },
    /// The stream is complete; nothing follows.
    Done,
    /// An event name this crate does not know. Kept whole for logging.
    Unknown {
        /// The SSE event name.
        event: String,
        /// Its raw payload.
        data: Value,
    },
}

/// A `tool_call` event: Cursor sends the same event name for the opening
/// announcement and every later progress report, distinguished only by
/// whether the `callId` has been seen before.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEvent {
    /// Cursor's id for the call. May contain a literal newline — see
    /// [`crate::domain::translate`], which collapses it before the id
    /// reaches ACP.
    pub call_id: String,
    /// The tool's name, e.g. `run_terminal_cmd`. The only kind signal
    /// available at announcement time.
    pub name: String,
    /// Cursor's status word (`running`, `completed`, …) — free-form on the
    /// wire, mapped to ACP statuses by the translation.
    #[serde(default)]
    pub status: Option<String>,
    /// Raw tool input, when present.
    #[serde(default)]
    pub args: Option<Value>,
    /// Raw tool output, when present.
    #[serde(default)]
    pub result: Option<Value>,
    /// Which halves of the call Cursor truncated for transport.
    #[serde(default, deserialize_with = "lenient_truncation")]
    pub truncated: Truncation,
}

/// Which halves of a tool call Cursor truncated for transport.
///
/// Observed on the wire as an object — `{"result": true}` in
/// `fixtures/real/list_and_delete.sse`. It was originally modelled as a bare
/// `bool`, which meant that object failed to deserialize and took the entire
/// `tool_call` event down with it: the call degraded to
/// [`CursorEvent::Unknown`] and disappeared from the client, over a field the
/// translation never reads.
///
/// `args` is included because it is the only other half there is to truncate;
/// no recording has shown it yet, so it defaults to false like any absent
/// field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Truncation {
    /// Cursor truncated the tool's input.
    #[serde(default)]
    pub args: bool,
    /// Cursor truncated the tool's output.
    #[serde(default)]
    pub result: bool,
}

/// Read a [`Truncation`], falling back to "nothing truncated" for any shape
/// this crate does not recognize.
///
/// Deliberately lenient where the rest of this module is strict: everywhere
/// else a shape mismatch costs one event, but here it would cost the whole
/// tool call — and this is the one field on a `tool_call` nothing downstream
/// consumes. A drifted shape should lose the flag, not the call. The corpus
/// sweep is what surfaces the drift.
fn lenient_truncation<'de, D>(deserializer: D) -> Result<Truncation, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    Ok(Truncation::deserialize(&value).unwrap_or_default())
}

/// The `interaction_update` subtypes that carry information no documented
/// event does. `text-delta` and `thinking-delta` duplicate the `assistant`
/// and `thinking` events one-for-one — consuming both would double every
/// chunk — so they land in [`InteractionUpdate::Other`] and are ignored.
#[derive(Debug, Clone, PartialEq)]
pub enum InteractionUpdate {
    /// The user's prompt echoed back into the stream. The one place the
    /// stream states which prompt opened the turn.
    UserMessage {
        /// The prompt text.
        text: String,
    },
    /// A tool call began, with Cursor's *typed* tool descriptor — richer
    /// than the `tool_call` event's bare name, but it always arrives after
    /// it, so it can only refine later updates.
    ToolCallStarted {
        /// The same call id the `tool_call` event uses.
        call_id: String,
        /// Cursor's tool type, e.g. `shell`.
        tool_type: Option<String>,
    },
    /// A tool call finished, same descriptor.
    ToolCallCompleted {
        /// The same call id the `tool_call` event uses.
        call_id: String,
        /// Cursor's tool type, e.g. `shell`.
        tool_type: Option<String>,
    },
    /// Incremental output token count for the current step.
    TokenDelta {
        /// Tokens since the previous report.
        tokens: u64,
    },
    /// A subtype that carries nothing the documented events do not.
    Other {
        /// The subtype's `type` tag, for logging.
        kind: String,
    },
}

impl CursorEvent {
    /// Decode one SSE record into the vocabulary.
    ///
    /// Malformed payloads for known events degrade to [`CursorEvent::Unknown`]
    /// rather than erroring: a stream that has already cost a run should not
    /// die because one record's shape drifted.
    #[must_use]
    pub fn from_wire(event: &str, data: Value) -> Self {
        match event {
            "status" => match StatusPayload::deserialize(&data) {
                Ok(payload) => Self::Status {
                    run_id: CursorRunId::new(payload.run_id),
                    status: payload.status,
                },
                Err(_) => Self::unknown(event, data),
            },
            "assistant" | "thinking" => match TextPayload::deserialize(&data) {
                Ok(payload) if event == "assistant" => Self::Assistant { text: payload.text },
                Ok(payload) => Self::Thinking { text: payload.text },
                Err(_) => Self::unknown(event, data),
            },
            "tool_call" => match ToolCallEvent::deserialize(&data) {
                Ok(call) => Self::ToolCall(call),
                Err(_) => Self::unknown(event, data),
            },
            "interaction_update" => Self::Interaction(InteractionUpdate::from_payload(&data)),
            "result" => match ResultPayload::deserialize(&data) {
                Ok(payload) => Self::Result {
                    run_id: CursorRunId::new(payload.run_id),
                    status: payload.status,
                    text: payload.text,
                    duration_ms: payload.duration_ms,
                },
                Err(_) => Self::unknown(event, data),
            },
            "heartbeat" => Self::Heartbeat,
            "error" => match ErrorPayload::deserialize(&data) {
                Ok(payload) => Self::Error {
                    code: payload.code,
                    message: payload.message,
                },
                Err(_) => Self::unknown(event, data),
            },
            "done" => Self::Done,
            _ => Self::unknown(event, data),
        }
    }

    fn unknown(event: &str, data: Value) -> Self {
        Self::Unknown {
            event: event.to_owned(),
            data,
        }
    }
}

impl InteractionUpdate {
    /// Decode the envelope's payload by its `type` tag.
    fn from_payload(data: &Value) -> Self {
        let kind = data
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        match kind.as_str() {
            "user-message-appended" => {
                let text = data
                    .pointer("/userMessage/text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                Self::UserMessage { text }
            }
            // `partial-tool-call` carries exactly what `tool-call-started`
            // does — a call id and Cursor's typed descriptor — for a call
            // whose arguments are still streaming. Nothing on it is unique
            // (the `tool_call` event repeats the arguments in full, and every
            // recorded call that sends a partial also sends a started), but it
            // reaches the same conclusion by the same route, so it takes that
            // route rather than being dropped as unrecognized.
            "tool-call-started" | "tool-call-completed" | "partial-tool-call" => {
                let call_id = data
                    .get("callId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let tool_type = data
                    .pointer("/toolCall/type")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                if kind == "tool-call-completed" {
                    Self::ToolCallCompleted { call_id, tool_type }
                } else {
                    Self::ToolCallStarted { call_id, tool_type }
                }
            }
            "token-delta" => Self::TokenDelta {
                tokens: data.get("tokens").and_then(Value::as_u64).unwrap_or(0),
            },
            _ => Self::Other { kind },
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    run_id: String,
    status: RunStatus,
}

#[derive(Deserialize)]
struct TextPayload {
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResultPayload {
    run_id: String,
    status: RunStatus,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    duration_ms: Option<u64>,
}

#[derive(Deserialize)]
struct ErrorPayload {
    #[serde(default)]
    code: Option<String>,
    message: String,
}
