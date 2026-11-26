//! Gemini 4's signatures are bound to their original parts. Keep only the
//! signatures, the part boundaries, and a digest of the visible content.

use crate::types::AssistantMessagePart;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[cfg(test)]
mod test;

const MAX_TURN_REPLAY_BYTES: usize = 1024 * 1024;
/// Maximum private replay metadata hydrated for one Gemini 4 session.
pub const MAX_GEMINI_4_SESSION_REPLAY_BYTES: usize = 8 * 1024 * 1024;

/// Private native replay state for one completed Gemini 4 turn.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct Gemini4Replay {
    model: String,
    responses: Vec<ReplayResponse>,
}

impl Gemini4Replay {
    /// Whether this state belongs to the selected provider model.
    pub fn is_for_model(&self, model: &str) -> bool {
        self.model == model && !self.responses.is_empty()
    }

    /// Validate persisted content and recover each model round's boundary.
    pub fn assistant_rounds(
        &self,
        parts: &[AssistantMessagePart],
    ) -> Option<Vec<Vec<AssistantMessagePart>>> {
        use AssistantMessagePart::{
            McpToolCall, Text, Thinking, ToolCall, ToolCallErr, ToolCallResponseJson,
        };
        let mut parts = parts.iter().filter(|part| !matches!(part, Thinking { .. }));
        let mut rounds = Vec::new();
        for response in &self.responses {
            let mut expected: HashSet<_> = response
                .parts
                .iter()
                .filter_map(|part| match part {
                    Part::Call { id, .. } => Some(call_alias(id)),
                    Part::Text { .. } => None,
                })
                .collect();
            let mut round = Vec::new();
            let mut visible = Vec::new();
            for part in parts.by_ref() {
                let mut resolved = part.clone();
                match part {
                    Text { text } => visible.push(json!({ "text": text })),
                    ToolCall { name, json, id } => {
                        visible.push(
                            json!({ "functionCall": { "name": name, "args": json, "id": id } }),
                        );
                    }
                    McpToolCall {
                        name,
                        service,
                        json,
                        id,
                        ..
                    } => {
                        let name = format!("mcp__{service}__{name}");
                        visible.push(
                            json!({ "functionCall": { "name": name, "args": json, "id": id } }),
                        );
                        resolved = ToolCall {
                            name,
                            json: json.clone(),
                            id: id.clone(),
                        };
                    }
                    ToolCallResponseJson { id, .. } | ToolCallErr { id, .. } => {
                        if !expected.remove(id) {
                            return None;
                        }
                        round.push(resolved);
                        if expected.is_empty() {
                            break;
                        }
                        continue;
                    }
                    Thinking { .. } => unreachable!("thinking was filtered"),
                }
                round.push(resolved);
            }
            if !expected.is_empty() || digest(&visible_parts(&visible)?)? != response.digest {
                return None;
            }
            rounds.push(round);
        }
        parts.next().is_none().then_some(rounds)
    }
}

impl std::fmt::Debug for Gemini4Replay {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Gemini4Replay")
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
struct ReplayResponse {
    digest: [u8; 32],
    parts: Vec<Part>,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
enum Part {
    Text {
        bytes: usize,
        signature: Option<String>,
    },
    Call {
        id: String,
        signature: Option<String>,
    },
}

/// Replay state local to one turn. The dedicated transport adds each provider
/// response and the tool hook checks its exact invocation before dispatch.
#[derive(Clone)]
pub struct Gemini4ReplaySession(Arc<Mutex<ReplaySession>>);

impl std::fmt::Debug for Gemini4ReplaySession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Gemini4ReplaySession")
            .finish_non_exhaustive()
    }
}

struct ReplaySession {
    model: String,
    historical: usize,
    historical_bytes: usize,
    responses: Vec<ReplayResponse>,
    pending: Option<(ReplayResponse, Vec<Value>)>,
}

impl Gemini4ReplaySession {
    /// Begin a turn with prior assistant parts from the same model.
    pub fn new(model: &str, history: Vec<Gemini4Replay>) -> Option<Self> {
        let historical_bytes = history.iter().try_fold(0usize, |sum, turn| {
            if !turn.is_for_model(model) {
                return None;
            }
            let sum = sum.checked_add(serde_json::to_vec(turn).ok()?.len())?;
            (sum <= MAX_GEMINI_4_SESSION_REPLAY_BYTES).then_some(sum)
        })?;
        let responses: Vec<_> = history
            .into_iter()
            .flat_map(|turn| turn.responses)
            .collect();
        Some(Self(Arc::new(Mutex::new(ReplaySession {
            model: model.to_owned(),
            historical: responses.len(),
            historical_bytes,
            responses,
            pending: None,
        }))))
    }

    pub(super) fn apply(&self, body: &mut Value) -> Option<()> {
        let mut state = self.0.lock().ok()?;
        let messages = body.get_mut("contents")?.as_array_mut()?;
        let mut count = 0;
        for index in 0..messages.len() {
            if messages[index]["role"] != "model" {
                continue;
            }
            let replay = state.responses.get(count).or_else(|| {
                (count == state.responses.len())
                    .then_some(state.pending.as_ref()?)
                    .map(|(replay, _)| replay)
            })?;
            let (earlier, later) = messages.split_at_mut(index + 1);
            let parts = earlier[index].get_mut("parts")?.as_array_mut()?;
            restore(parts, replay)?;
            restore_result_ids(later, &replay.parts)?;
            count += 1;
        }
        let expected = state.responses.len() + usize::from(state.pending.is_some());
        if count != expected {
            return None;
        }
        if let Some((replay, _)) = state.pending.take() {
            state.responses.push(replay);
        }
        Some(())
    }

    pub(crate) fn attests_tool_call(&self, id: &str, name: &str, args: &str) -> bool {
        let Ok(args) = serde_json::from_str::<Value>(args) else {
            return false;
        };
        let Ok(state) = self.0.lock() else {
            return false;
        };
        state.pending.as_ref().is_some_and(|(_, calls)| {
            calls.iter().any(|call| {
                call["id"]
                    .as_str()
                    .is_some_and(|native| call_alias(native) == id)
                    && call["name"] == name
                    && call["args"] == args
            })
        })
    }

    /// Return the private metadata to persist after a successful turn.
    pub fn complete(&self) -> Option<Gemini4Replay> {
        let state = self.0.lock().ok()?;
        state.persistable(&state.pending.as_ref()?.0)
    }
}

impl ReplaySession {
    fn persistable(&self, next: &ReplayResponse) -> Option<Gemini4Replay> {
        let mut responses = self.responses[self.historical..].to_vec();
        responses.push(next.clone());
        let replay = Gemini4Replay {
            model: self.model.clone(),
            responses,
        };
        let bytes = serde_json::to_vec(&replay).ok()?.len();
        (bytes <= MAX_TURN_REPLAY_BYTES
            && self.historical_bytes + bytes <= MAX_GEMINI_4_SESSION_REPLAY_BYTES)
            .then_some(replay)
    }
}

pub(super) struct Capture {
    session: Gemini4ReplaySession,
    parts: Vec<Value>,
    bytes: usize,
    valid: bool,
}

impl Capture {
    pub(super) fn new(session: Gemini4ReplaySession) -> Self {
        Self {
            session,
            parts: Vec::new(),
            bytes: 0,
            valid: true,
        }
    }

    pub(super) fn invalidate(&mut self) {
        self.valid = false;
        self.parts.clear();
    }

    pub(super) fn event(&mut self, event: &Value, bytes: usize) -> bool {
        if !self.valid {
            return false;
        }
        self.bytes = self.bytes.saturating_add(bytes);
        if self.bytes > MAX_TURN_REPLAY_BYTES {
            self.invalidate();
            return false;
        }
        if let Some(parts) = event
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
        {
            self.parts.extend(parts.iter().cloned());
        }
        let Some(reason) = event
            .pointer("/candidates/0/finishReason")
            .and_then(Value::as_str)
        else {
            return true;
        };
        self.valid = false;
        if reason == "STOP"
            && let Some(replay) = capture_parts(&self.parts)
            && let Ok(mut state) = self.session.0.lock()
            && state.persistable(&replay.0).is_some()
        {
            state.pending = Some(replay);
            return true;
        }
        false
    }
}

fn capture_parts(parts: &[Value]) -> Option<(ReplayResponse, Vec<Value>)> {
    let mut layout = Vec::new();
    let mut calls = Vec::new();
    let mut ids = HashSet::new();
    for part in parts {
        let signature = match part.get("thoughtSignature") {
            Some(value) => Some(value.as_str().filter(|text| !text.is_empty())?.to_owned()),
            None => None,
        };
        if part["thought"] == true {
            // Summaries are not assistant text. A signed thought summary
            // requires a different representation that keeps it private.
            if signature.is_some() {
                return None;
            }
        } else if let Some(text) = part["text"].as_str() {
            layout.push(Part::Text {
                bytes: text.len(),
                signature,
            });
        } else if let Some(call) = part.get("functionCall") {
            let id = call["id"].as_str().filter(|id| !id.is_empty())?;
            if !ids.insert(id) || signature.is_some() != calls.is_empty() {
                return None;
            }
            layout.push(Part::Call {
                id: id.to_owned(),
                signature,
            });
            calls.push(call.clone());
        } else {
            return None;
        }
    }
    let (text, mut visible_calls) = visible_parts(parts)?;
    if text.is_empty() && visible_calls.is_empty() {
        return None;
    }
    for call in &mut visible_calls {
        call["id"] = json!(call_alias(call["id"].as_str()?));
    }
    Some((
        ReplayResponse {
            digest: digest(&(text, visible_calls))?,
            parts: layout,
        },
        calls,
    ))
}

// Rig coalesces text deltas and places text before calls. Match both streams
// independently before restoring the original interleaving.
fn visible_parts(parts: &[Value]) -> Option<(String, Vec<Value>)> {
    let mut text = String::new();
    let mut calls = Vec::new();
    for part in parts {
        if part["thought"] == true {
            continue;
        }
        if let Some(delta) = part["text"].as_str() {
            text.push_str(delta);
        } else if let Some(call) = part.get("functionCall") {
            call["id"].as_str()?;
            let mut call = call.clone();
            call.sort_all_objects();
            calls.push(call);
        } else {
            return None;
        }
    }
    Some((text, calls))
}

/// A stable transcript correlation ID that does not expose the provider ID.
pub(super) fn call_alias(id: &str) -> String {
    format!("gemini-call-{:x}", Sha256::digest(id.as_bytes()))
}

fn digest(visible: &(String, Vec<Value>)) -> Option<[u8; 32]> {
    Some(Sha256::digest(serde_json::to_vec(visible).ok()?).into())
}

fn restore(parts: &mut Vec<Value>, replay: &ReplayResponse) -> Option<()> {
    let visible = visible_parts(parts)?;
    if digest(&visible)? != replay.digest {
        return None;
    }
    let (text, calls) = visible;
    let mut remaining = text.as_str();
    let mut calls = calls.into_iter();
    let mut restored = Vec::with_capacity(replay.parts.len());
    for part in &replay.parts {
        let (mut value, signature) = match part {
            Part::Text { bytes, signature } => {
                let (text, rest) = remaining.split_at_checked(*bytes)?;
                remaining = rest;
                (json!({"text": text}), signature)
            }
            Part::Call { id, signature } => {
                let mut call = calls.next()?;
                if call["id"] != call_alias(id) {
                    return None;
                }
                call["id"] = Value::from(id.clone());
                (json!({"functionCall": call}), signature)
            }
        };
        if let Some(signature) = signature {
            value["thoughtSignature"] = Value::from(signature.clone());
        }
        restored.push(value);
    }
    if !remaining.is_empty() || calls.next().is_some() {
        return None;
    }
    *parts = restored;
    Some(())
}

fn restore_result_ids(messages: &mut [Value], parts: &[Part]) -> Option<()> {
    let ids: Vec<_> = parts
        .iter()
        .filter_map(|part| match part {
            Part::Call { id, .. } => Some(id),
            Part::Text { .. } => None,
        })
        .collect();
    if ids.is_empty() {
        return Some(());
    }
    let next = messages.first_mut()?;
    if next["role"] != "user" {
        return None;
    }
    let parts = next.get_mut("parts")?.as_array_mut()?;
    let mut results = std::collections::HashMap::new();
    let mut other_parts = Vec::new();
    for part in parts.drain(..) {
        if let Some(response) = part.get("functionResponse") {
            let id = response["id"].as_str()?.to_owned();
            if results.insert(id, part).is_some() {
                return None;
            }
        } else {
            other_parts.push(part);
        }
    }
    for id in ids {
        let mut part = results.remove(&call_alias(id))?;
        part["functionResponse"]["id"] = Value::from(id.clone());
        parts.push(part);
    }
    parts.extend(other_parts);
    results.is_empty().then_some(())
}
