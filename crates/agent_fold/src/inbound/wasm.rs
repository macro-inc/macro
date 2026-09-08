//! The fold, as the browser calls it.
//!
//! Two entry points over one fold. [`fold_session`] takes a session id and
//! that session's whole log and gives back the messages it derives.
//! [`FoldStream`] is the same fold kept open: construct one per live session,
//! push frames as they arrive, and each push reports the single message it
//! changed. The log arrives in exactly the shape the raw-log endpoint serves,
//! a recording stores, and the realtime event carries - `{userId?, direction,
//! content}` per frame - so a caller passes bytes through rather than
//! translating them, and catching up and following are the same code.
//!
//! The shape JavaScript actually sees lives in [`crate::inbound::wire`], not
//! here - this module is only the wasm-bindgen glue that carries values of
//! those types across the boundary. See that module's docs for why they are
//! kept apart.
//!
//! # Why catching up is not a loop of pushes
//!
//! [`FoldStream::extend`] exists rather than leaving a caller to push a
//! fetched log frame by frame. A push serializes the message it changed
//! across the boundary, and a session's frames overwhelmingly change the same
//! agent message over and over - so replaying 6500 frames one at a time would
//! serialize 6500 whole messages to produce one. `extend` folds them all and
//! serializes the answer once.

use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::model::{FoldedMessage as ModelFoldedMessage, SessionMetadata};
use crate::domain::ports::FoldMachine;
use crate::inbound::wire::{FoldedMessage, FoldedStreamEvent};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

/// Fold one session's log into the messages a channel renders.
///
/// `session_id` is the session the entries belong to; it is not repeated per
/// entry, and it is what the returned `agentSessionMessageId`s are built from.
///
/// Errors only on input this cannot read - a session id that is not a UUID, or
/// entries that are not log frames. The fold itself is total: an unrecognized
/// or half-finished frame yields a partially-known message rather than a
/// failure, because rendering some of a session always beats rendering none.
///
/// # Errors
///
/// Returns a JS string describing what could not be read.
#[wasm_bindgen]
pub fn fold_session(session_id: &str, entries: JsValue) -> Result<JsValue, JsValue> {
    let session = parse_session(session_id)?;
    let messages = fold(parse_log(session, entries)?);
    encode_messages(session, messages)
}

/// One live session's fold, held open between frames.
///
/// The streaming counterpart to [`fold_session`], wrapping the same
/// [`FoldMachineImpl`] the server folds with. A caller following a session
/// keeps one of these per session for as long as the session lasts: frames
/// must arrive in log order, and the machine only ever grows.
///
/// A client that opens a channel mid-session catches up with [`Self::extend`]
/// and then follows with [`Self::push`] on the *same* machine. Refolding the
/// fetched log into a throwaway and then pushing live frames into a second
/// machine would derive the same messages twice from different halves of the
/// log; there is one machine per session precisely so that cannot happen.
#[wasm_bindgen]
pub struct FoldStream {
    /// Half of the composite id every message this machine derives is keyed
    /// by, and the reason the session id is taken once rather than per frame.
    session: AgentSessionId,
    machine: FoldMachineImpl,
}

#[wasm_bindgen]
impl FoldStream {
    /// A machine for `session_id` that has folded nothing.
    ///
    /// # Errors
    ///
    /// Returns a JS string when the session id is not a UUID.
    #[wasm_bindgen(constructor)]
    pub fn new(session_id: &str) -> Result<FoldStream, JsValue> {
        Ok(Self {
            session: parse_session(session_id)?,
            machine: FoldMachineImpl::new(),
        })
    }

    /// Fold a run of frames in one go, answering with every message derived
    /// so far - the catch-up path. See the module docs for why this is not a
    /// loop of [`Self::push`].
    ///
    /// # Errors
    ///
    /// Returns a JS string when the entries are not log frames.
    pub fn extend(&mut self, entries: JsValue) -> Result<JsValue, JsValue> {
        for entry in parse_log(self.session, entries)? {
            let _ = self.machine.push(entry);
        }
        self.messages()
    }

    /// Fold one more frame, reporting the changes it implied as an array of
    /// `{kind: "new" | "update", message}` and `{kind: "metadata", metadata}`
    /// events - empty for a frame that changes nothing, which is most of
    /// them.
    ///
    /// # Errors
    ///
    /// Returns a JS string when the entry is not a log frame.
    pub fn push(&mut self, entry: JsValue) -> Result<JsValue, JsValue> {
        let entry: LogEntry = serde_wasm_bindgen::from_value(entry)
            .map_err(|error| JsValue::from_str(&format!("log entry is not readable: {error}")))?;

        let events: Vec<FoldedStreamEvent> = self
            .machine
            .push(entry.into_log(self.session))
            .into_iter()
            .map(|event| FoldedStreamEvent::new(self.session, event))
            .collect();

        encode(&events)
            .map_err(|error| JsValue::from_str(&format!("fold events are not encodable: {error}")))
    }

    /// The session metadata as it now stands - what the latest
    /// `{kind: "metadata"}` event carried, for a caller that caught up with
    /// [`Self::extend`] and saw no events.
    ///
    /// # Errors
    ///
    /// Returns a JS string describing what could not be encoded.
    pub fn metadata(&self) -> Result<JsValue, JsValue> {
        let metadata: SessionMetadata = self.machine.metadata().clone().into();
        encode(&metadata).map_err(|error| {
            JsValue::from_str(&format!("session metadata is not encodable: {error}"))
        })
    }

    /// Every message folded so far, oldest first.
    ///
    /// The same answer [`fold_session`] gives for the frames pushed so far -
    /// they are one fold - which is what a reader relies on when a channel
    /// that has been following a session is reopened.
    ///
    /// # Errors
    ///
    /// Returns a JS string describing what could not be encoded.
    pub fn messages(&self) -> Result<JsValue, JsValue> {
        let messages: Vec<FoldedMessage> = self
            .machine
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

/// Read an array of served log entries as this session's log frames.
fn parse_log(session: AgentSessionId, entries: JsValue) -> Result<Vec<AgentSessionLog>, JsValue> {
    let entries: Vec<LogEntry> = serde_wasm_bindgen::from_value(entries)
        .map_err(|error| JsValue::from_str(&format!("log entries are not readable: {error}")))?;

    Ok(entries
        .into_iter()
        .map(|entry| entry.into_log(session))
        .collect())
}

/// Encode folded messages for the browser.
fn encode_messages(
    session: AgentSessionId,
    messages: Vec<ModelFoldedMessage>,
) -> Result<JsValue, JsValue> {
    let messages: Vec<FoldedMessage> = messages
        .into_iter()
        .map(|message| FoldedMessage::new(session, message))
        .collect();

    encode(&messages)
        .map_err(|error| JsValue::from_str(&format!("folded messages are not encodable: {error}")))
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
