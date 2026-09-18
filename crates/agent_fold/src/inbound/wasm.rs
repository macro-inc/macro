//! The fold, as the browser calls it.
//!
//! One entry point: [`FoldStream`], a session's fold kept open. Construct one
//! per live session and push [`FoldInput`]s into it in order - a snapshot of
//! the fetched log first, then confirmed rows as they arrive over the socket,
//! and the client's own actions the moment it issues them. Each push reports
//! what it changed.
//!
//! The confirmed rows arrive in exactly the shape the raw-log endpoint serves
//! and the realtime event carries - `{createdAt, id, userId?, direction,
//! content}` per row - so a caller passes bytes through rather than
//! translating them. A speculated action arrives as the same JSON the control
//! endpoint accepts, so the client never learns a second shape for it.
//!
//! The shape JavaScript actually sees lives in [`crate::inbound::wire`], not
//! here - this module is only the wasm-bindgen glue that carries values of
//! those types across the boundary. See that module's docs for why they are
//! kept apart.

use crate::domain::ingestion::LogCursor;
use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::model::SessionMetadata;
use crate::domain::speculation::{FoldInput, Speculation, SpeculativeFold};
use crate::inbound::wire::{FoldedMessage, FoldedStreamEvent};
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

/// One live session's fold, held open between inputs.
///
/// Wraps [`SpeculativeFold`], which wraps the same
/// [`crate::domain::fold::FoldMachineImpl`] the server folds with. A caller
/// following a session keeps one of these per session for as long as the
/// session lasts and pushes every input through [`Self::push`]: the fetched
/// log and the streamed frames after it go into one machine, so a channel
/// opened mid-session continues the fold rather than starting a second one
/// beside it.
#[wasm_bindgen]
pub struct FoldStream {
    /// Half of the composite id every message this machine derives is keyed
    /// by, and the reason the session id is taken once rather than per input.
    session: AgentSessionId,
    fold: SpeculativeFold,
}

#[wasm_bindgen]
impl FoldStream {
    /// A fold for `session_id` that has seen nothing. The first input pushed
    /// must be a snapshot.
    ///
    /// # Errors
    ///
    /// Returns a JS string when the session id is not a UUID.
    #[wasm_bindgen(constructor)]
    pub fn new(session_id: &str) -> Result<FoldStream, JsValue> {
        let session = parse_session(session_id)?;
        Ok(Self {
            session,
            fold: SpeculativeFold::new(session),
        })
    }

    /// Fold inputs in order, reporting the changes they implied as an array
    /// of `{kind: "new" | "update", message}`, `{kind: "replace", messages}`
    /// and `{kind: "metadata", metadata}` events. Empty for inputs that
    /// change nothing renderable, which is most confirmed rows.
    ///
    /// # Errors
    ///
    /// Returns a JS string when an input cannot be read, when a live or
    /// speculative input arrives before any snapshot, or when an action
    /// cannot be encoded as the frame the harness would log.
    pub fn push(&mut self, inputs: JsValue) -> Result<JsValue, JsValue> {
        let inputs: Vec<WireInput> = serde_wasm_bindgen::from_value(inputs).map_err(|error| {
            JsValue::from_str(&format!("fold inputs are not readable: {error}"))
        })?;
        let mut events = Vec::new();
        for input in inputs {
            let input = input.into_input(self.session)?;
            let changes = self
                .fold
                .push(input)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
            events.extend(
                changes
                    .into_iter()
                    .map(|event| FoldedStreamEvent::new(self.session, event)),
            );
        }
        encode(&events)
            .map_err(|error| JsValue::from_str(&format!("fold events are not encodable: {error}")))
    }

    /// The session metadata as it now stands - what the latest
    /// `{kind: "metadata"}` event carried.
    ///
    /// # Errors
    ///
    /// Returns a JS string describing what could not be encoded.
    pub fn metadata(&self) -> Result<JsValue, JsValue> {
        let metadata: &SessionMetadata = self.fold.metadata();
        encode(metadata).map_err(|error| {
            JsValue::from_str(&format!("session metadata is not encodable: {error}"))
        })
    }

    /// Every message as the reader should see it, oldest first - the
    /// confirmed conversation with this client's unconfirmed actions on top.
    ///
    /// # Errors
    ///
    /// Returns a JS string describing what could not be encoded.
    pub fn messages(&self) -> Result<JsValue, JsValue> {
        let messages: Vec<FoldedMessage> = self
            .fold
            .messages()
            .iter()
            .cloned()
            .map(|message| FoldedMessage::new(self.session, message))
            .collect();

        encode(&messages).map_err(|error| {
            JsValue::from_str(&format!("folded messages are not encodable: {error}"))
        })
    }
}

/// The session a caller named, or a JS string saying it is not a session id.
fn parse_session(session_id: &str) -> Result<AgentSessionId, JsValue> {
    session_id
        .parse()
        .map(AgentSessionId::new_from_uuid)
        .map_err(|error| JsValue::from_str(&format!("session id is not a uuid: {error}")))
}

/// Encode a value for the browser as plain JSON-shaped data.
///
/// `serde_wasm_bindgen`'s default turns a `serde_json::Value` object into an
/// ES `Map`, which `JSON.stringify` renders as `{}` and no reader expects. The
/// generated TypeScript contract types these fields as plain objects, so the
/// JSON-compatible serializer is the one that honors it.
fn encode<T: serde::Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    serde::Serialize::serialize(value, &serde_wasm_bindgen::Serializer::json_compatible())
}

/// One input, as JavaScript sends it. Mirrors the `FoldInput` union in the
/// worker protocol.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WireInput {
    /// `{kind: "snapshot", rows: DurableEntry[]}`
    Snapshot { rows: Vec<DurableEntry> },
    /// `{kind: "confirmed", row: DurableEntry}`
    Confirmed { row: DurableEntry },
    /// `{kind: "speculated", actionId, action, userId?}` - `action` is the
    /// control endpoint's request body. The user id is the caller's own, so
    /// it is read strictly: a client that cannot name itself has a bug.
    #[serde(rename_all = "camelCase")]
    Speculated {
        action_id: AgentActionId,
        action: AgentAction,
        #[serde(default)]
        user_id: Option<MacroUserIdStr<'static>>,
    },
    /// `{kind: "retracted", actionId}`
    #[serde(rename_all = "camelCase")]
    Retracted { action_id: AgentActionId },
}

impl WireInput {
    fn into_input(self, session: AgentSessionId) -> Result<FoldInput, JsValue> {
        Ok(match self {
            Self::Snapshot { rows } => FoldInput::Snapshot(
                rows.into_iter()
                    .map(|row| (row.cursor, row.frame.into_log(session)))
                    .collect(),
            ),
            Self::Confirmed { row } => {
                FoldInput::Confirmed(row.cursor, row.frame.into_log(session))
            }
            Self::Speculated {
                action_id,
                action,
                user_id,
            } => FoldInput::Speculated(Speculation::new(action_id, action, user_id)),
            Self::Retracted { action_id } => FoldInput::Retracted(action_id),
        })
    }
}

/// One entry of a session's protocol log, as the endpoint serves it.
#[derive(Deserialize)]
struct LogEntry {
    /// The user whose action produced the frame, when one did. Absent on
    /// everything the runtime originated.
    #[serde(rename = "userId", default)]
    user_id: Option<String>,
    /// `direction` and `content`, flattened in - the frame's own two fields.
    #[serde(flatten)]
    message: Message,
}

/// A log entry with its durable cursor, as the endpoint and the realtime
/// event both carry it.
#[derive(Deserialize)]
struct DurableEntry {
    #[serde(flatten)]
    cursor: LogCursor,
    #[serde(flatten)]
    frame: LogEntry,
}

impl LogEntry {
    fn into_log(self, session: AgentSessionId) -> AgentSessionLog {
        AgentSessionLog {
            agent_session_id: session,
            // A user id that will not parse is dropped rather than rejected:
            // it costs the prompt its attribution, and the placeholder row it
            // renders into carries a sender of its own anyway.
            user_id: self
                .user_id
                .and_then(|id| MacroUserIdStr::try_from(id).ok()),
            content: self.message,
        }
    }
}
