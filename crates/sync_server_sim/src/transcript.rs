//! Lossless C0 JSONL loading and strict native comparison primitives.
use crate::{
    ports::{Effect, SimNow},
    replay::ReplayError,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
};
use sync_server_core::domain::{permissions::AuthToken, socket::WebSocketId, types::SessionKey};

/// A parsed HTTP input; authentication and routing remain explicit adapter work.
#[derive(Clone, Debug)]
pub struct RoomRequest {
    /// HTTP method as recorded.
    pub method: String,
    /// Exact request path.
    pub path: String,
    /// Exact query string, including token bytes.
    pub query: String,
    /// Recorded selected headers.
    pub headers: BTreeMap<String, Value>,
    /// Exact request body.
    pub body: Vec<u8>,
}
/// Sans-I/O events accepted by the eventual native room adapter.
pub enum ServerInput {
    /// Discard volatile room memory while retaining durable ports and sockets.
    NewObject,
    /// Verified connect request, used directly by simulation clients.
    Connect {
        /// Verified grant.
        grant: AuthToken,
        /// Exact storage identity.
        key: SessionKey,
    },
    /// An incoming binary frame.
    Binary {
        /// Sending socket.
        socket: WebSocketId,
        /// Original bytes including frame header.
        bytes: Vec<u8>,
    },
    /// An incoming text frame.
    Text {
        /// Sending socket.
        socket: WebSocketId,
        /// Original text.
        text: String,
    },
    /// Close callback, while the runtime still lists the socket.
    Close(WebSocketId),
    /// Runtime socket error callback.
    SocketError(WebSocketId),
    /// Durable alarm callback.
    AlarmFired,
    /// Unmodified HTTP input for the native route adapter.
    Http(RoomRequest),
    /// Move simulation time between callbacks.
    AdvanceClock(std::time::Duration),
    /// Runtime socket removal after its close callback.
    RuntimeCloses(WebSocketId),
}
impl ServerInput {
    /// Stable input kind for unsupported-callback diagnostics.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::NewObject => "new",
            Self::Connect { .. } => "connect",
            Self::Binary { .. } | Self::Text { .. } => "message",
            Self::Close(_) => "close",
            Self::SocketError(_) => "error",
            Self::AlarmFired => "alarm",
            Self::Http(_) => "fetch",
            Self::AdvanceClock(_) => "advance_clock",
            Self::RuntimeCloses(_) => "runtime_closes",
        }
    }
}
/// One recorded input and its clock/room context.
pub struct RecordedInput {
    /// Position identifies callbacks even after runtime callback counters restart.
    pub record_index: usize,
    /// Runtime callback identity; clocks may be equal across distinct inputs.
    pub callback: u64,
    /// Durable Object identity in the recording.
    pub room: String,
    /// Time at callback entry.
    pub now: SimNow,
    /// Lossless input decoded from JSONL.
    pub input: ServerInput,
}
/// A loaded golden transcript; all records remain available for ordered comparison.
pub struct Transcript {
    /// Relative fixture identity used by the explicit replay allowlist.
    pub name: String,
    /// Raw ordered C0 records, including harness seeds, clocks and storage dumps.
    pub records: Vec<Value>,
}
fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, ReplayError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ReplayError::Invalid(format!("missing string field {key}")))
}
fn bytes(value: &Value, key: &str) -> Result<Vec<u8>, ReplayError> {
    STANDARD
        .decode(required(value, key)?)
        .map_err(|e| ReplayError::Invalid(e.to_string()))
}
fn socket(value: &Value) -> Result<WebSocketId, ReplayError> {
    WebSocketId::from_tags(&[required(value, "ws_id")?.to_owned()])
        .map_err(|e| ReplayError::Invalid(e.to_string()))
}
impl Transcript {
    /// Parse every nonempty JSONL record without normalizing payloads.
    pub fn parse(name: impl Into<String>, source: &str) -> Result<Self, ReplayError> {
        let mut records = Vec::new();
        for (index, line) in source
            .lines()
            .enumerate()
            .filter(|(_, line)| !line.trim().is_empty())
        {
            let value: Value = serde_json::from_str(line)
                .map_err(|error| ReplayError::Invalid(format!("line {}: {error}", index + 1)))?;
            if !value.is_object() {
                return Err(ReplayError::Invalid(format!(
                    "line {} is not an object",
                    index + 1
                )));
            }
            records.push(value);
        }
        if records.is_empty() {
            return Err(ReplayError::Invalid("empty transcript".into()));
        }
        Ok(Self {
            name: name.into(),
            records,
        })
    }
    /// Load a fixture from disk, retaining its supplied relative identity.
    pub fn load(path: &Path, name: impl Into<String>) -> Result<Self, ReplayError> {
        let text = if path.extension().is_some_and(|ext| ext == "gz") {
            let file =
                std::fs::File::open(path).map_err(|e| ReplayError::Invalid(e.to_string()))?;
            let mut text = String::new();
            flate2::read::MultiGzDecoder::new(file)
                .read_to_string(&mut text)
                .map_err(|e| ReplayError::Invalid(e.to_string()))?;
            text
        } else {
            std::fs::read_to_string(path).map_err(|e| ReplayError::Invalid(e.to_string()))?
        };
        Self::parse(name, &text)
    }
    /// Decode runtime callbacks; harness seeds remain in `records` for future route setup.
    pub fn inputs(&self) -> Result<Vec<RecordedInput>, ReplayError> {
        let mut inputs = Vec::new();
        for (record_index, value) in self.records.iter().enumerate() {
            let Some(kind) = value.get("in").and_then(Value::as_str) else {
                continue;
            };
            let input = match kind {
                "seed" => continue,
                "new" => ServerInput::NewObject,
                "fetch" => ServerInput::Http(RoomRequest {
                    method: required(value, "method")?.into(),
                    path: required(value, "path")?.into(),
                    query: value
                        .get("query")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .into(),
                    headers: value
                        .get("headers")
                        .and_then(Value::as_object)
                        .map(|h| h.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                        .unwrap_or_default(),
                    body: bytes(value, "body_b64")?,
                }),
                "message" => {
                    if let Some(text) = value.get("text").and_then(Value::as_str) {
                        ServerInput::Text {
                            socket: socket(value)?,
                            text: text.into(),
                        }
                    } else {
                        ServerInput::Binary {
                            socket: socket(value)?,
                            bytes: bytes(value, "binary_b64")?,
                        }
                    }
                }
                "close" => ServerInput::Close(socket(value)?),
                "error" => ServerInput::SocketError(socket(value)?),
                "alarm" => ServerInput::AlarmFired,
                other => return Err(ReplayError::Unsupported(other.into())),
            };
            let unix_ms = value
                .get("unix_ms")
                .and_then(Value::as_i64)
                .ok_or_else(|| ReplayError::Invalid("missing input wall clock".into()))?;
            let millis = value
                .get("monotonic_ms")
                .and_then(Value::as_f64)
                .ok_or_else(|| ReplayError::Invalid("missing input monotonic clock".into()))?;
            if !millis.is_finite() || millis < 0.0 {
                return Err(ReplayError::Invalid("invalid monotonic time".into()));
            }
            inputs.push(RecordedInput {
                record_index,
                callback: value["callback"]
                    .as_u64()
                    .ok_or_else(|| ReplayError::Invalid("missing callback identity".into()))?,
                room: required(value, "room")?.into(),
                now: SimNow {
                    unix_ms,
                    monotonic: std::time::Duration::from_secs_f64(millis / 1000.0),
                },
                input,
            });
        }
        Ok(inputs)
    }
}
/// Enumerate JSONL fixtures deterministically; codec binaries are separate inputs.
pub fn fixtures(root: &Path) -> Result<Vec<PathBuf>, ReplayError> {
    let mut paths = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|e| ReplayError::Invalid(e.to_string()))? {
        let path = entry
            .map_err(|e| ReplayError::Invalid(e.to_string()))?
            .path();
        if path.is_dir() {
            paths.extend(fixtures(&path)?);
        } else if path.extension().is_some_and(|ext| ext == "jsonl")
            || path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".jsonl.gz"))
        {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}
/// Native snapshot equivalence: document value, oplog VV and both frontiers.
/// This is intentionally weaker than the byte-exact real Worker recording check.
pub fn equivalent_snapshots(left: &[u8], right: &[u8]) -> Result<bool, ReplayError> {
    let left = sync_server_core::domain::state::DocumentState::try_from_snapshot(left)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    let right = sync_server_core::domain::state::DocumentState::try_from_snapshot(right)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    Ok(
        left.loro_doc.get_deep_value() == right.loro_doc.get_deep_value()
            && left.loro_doc.oplog_vv() == right.loro_doc.oplog_vv()
            && left.frontiers() == right.frontiers(),
    )
}
/// Compare ordered effects with only the native snapshot and awareness exceptions.
pub fn compare_effects(expected: &[Effect], actual: &[Effect]) -> Result<(), ReplayError> {
    compare_effects_in_context(expected, actual, None)
}
/// Compare one callback with its pre-message full document snapshot when available.
/// Delta export relaxation requires this context; it never treats a pending import as equal.
pub fn compare_effects_in_context(
    expected: &[Effect],
    actual: &[Effect],
    baseline: Option<&[u8]>,
) -> Result<(), ReplayError> {
    let expected = logical_effects(expected)?;
    let actual = logical_effects(actual)?;
    if expected.len() != actual.len() {
        return Err(ReplayError::Mismatch("effect count differs".into()));
    }
    for (index, (a, b)) in expected.iter().zip(&actual).enumerate() {
        let fail = || ReplayError::Mismatch(format!("ordered port effect {index} differs"));
        if a.operation != b.operation {
            return Err(fail());
        }
        if matches!(a.operation.as_str(), "send" | "connections.send_binary") {
            let af: Vec<Vec<u8>> =
                serde_json::from_value(a.value["frames"].clone()).map_err(|_| fail())?;
            let bf: Vec<Vec<u8>> =
                serde_json::from_value(b.value["frames"].clone()).map_err(|_| fail())?;
            let mut av = a.value.clone();
            let mut bv = b.value.clone();
            av.as_object_mut().ok_or_else(fail)?.remove("frames");
            bv.as_object_mut().ok_or_else(fail)?.remove("frames");
            if av != bv || !equivalent_remote_frames_in_context(&af, &bf, baseline)? {
                return Err(fail());
            }
        } else if a == b {
            continue;
        } else if a.operation == "storage.put"
            && a.value["key"] == "LAST_VERSION_VECTOR"
            && b.value["key"] == "LAST_VERSION_VECTOR"
        {
            let mut av = a.value.clone();
            let mut bv = b.value.clone();
            av.as_object_mut().ok_or_else(fail)?.remove("value");
            bv.as_object_mut().ok_or_else(fail)?.remove("value");
            if av != bv
                || !equivalent_stored_value(
                    "LAST_VERSION_VECTOR",
                    &a.value["value"],
                    &b.value["value"],
                )?
            {
                return Err(fail());
            }
        } else if a.operation == "snapshot.put"
            || (a.operation == "background.publish" && a.value.get("snapshot").is_some())
        {
            let field = if a.operation == "snapshot.put" {
                "bytes"
            } else {
                "snapshot"
            };
            let av: Vec<u8> = serde_json::from_value(a.value[field].clone()).map_err(|_| fail())?;
            let bv: Vec<u8> = serde_json::from_value(b.value[field].clone()).map_err(|_| fail())?;
            let mut a = a.value.clone();
            let mut b = b.value.clone();
            a.as_object_mut().ok_or_else(fail)?.remove(field);
            b.as_object_mut().ok_or_else(fail)?.remove(field);
            if a != b || !equivalent_snapshots(&av, &bv)? {
                return Err(fail());
            }
        } else {
            return Err(fail());
        }
    }
    Ok(())
}

// Orchestrator ruling on S6 §4.3 (2026-11-07): native replay compares logical envelopes.
// Chunk boundaries/lengths derived from Loro exports stay byte-exact only in the
// real-workerd re-record diff. Preserve all other effect ordering and fields.
fn logical_effects(effects: &[Effect]) -> Result<Vec<Effect>, ReplayError> {
    let mut result: Vec<Effect> = Vec::new();
    type BufferedFrames = (usize, Vec<Vec<u8>>);
    let mut pending: BTreeMap<(String, String), BufferedFrames> = BTreeMap::new();
    for effect in effects {
        if matches!(
            effect.operation.as_str(),
            "send" | "connections.send_binary"
        ) {
            let frame: Vec<u8> = serde_json::from_value(effect.value["frame"].clone())
                .map_err(|e| ReplayError::Invalid(e.to_string()))?;
            let final_frame = match frame.first() {
                Some(0) => false,
                Some(1) => true,
                _ => {
                    return Err(ReplayError::Mismatch(
                        "invalid outbound frame header".into(),
                    ));
                }
            };
            let key = (effect.operation.clone(), effect.value["socket"].to_string());
            let mut logical = effect.clone();
            logical
                .value
                .as_object_mut()
                .ok_or_else(|| ReplayError::Invalid("invalid send effect".into()))?
                .remove("frame");
            let (index, frames) = pending.entry(key.clone()).or_insert_with(|| {
                let index = result.len();
                result.push(logical.clone());
                (index, Vec::new())
            });
            if result[*index].value != logical.value {
                return Err(ReplayError::Mismatch(
                    "send metadata changed between fragments".into(),
                ));
            }
            frames.push(frame);
            if final_frame {
                let (index, frames) = pending.remove(&key).expect("inserted frame");
                result[index].value["frames"] = serde_json::json!(frames);
            }
        } else {
            if !pending.is_empty() {
                return Err(ReplayError::Mismatch(
                    "non-frame effect inside outbound message".into(),
                ));
            }
            result.push(effect.clone());
        }
    }
    if !pending.is_empty() {
        return Err(ReplayError::Mismatch("incomplete outbound message".into()));
    }
    Ok(result)
}

/// Compare logical envelopes; forwarded updates and VV echoes remain byte-exact.
/// Only server-exported Loro bodies and decoded awareness state have native exceptions.
pub fn equivalent_remote_frames(left: &[Vec<u8>], right: &[Vec<u8>]) -> Result<bool, ReplayError> {
    equivalent_remote_frames_in_context(left, right, None)
}
/// Compare server frames using the pre-request document for RequestSince deltas.
pub fn equivalent_remote_frames_in_context(
    left: &[Vec<u8>],
    right: &[Vec<u8>],
    baseline: Option<&[u8]>,
) -> Result<bool, ReplayError> {
    use bebop::Record;
    use sync_protocol::FromRemote;
    let valid = |frames: &[Vec<u8>]| {
        !frames.is_empty()
            && frames
                .iter()
                .enumerate()
                .all(|(index, frame)| frame.first() == Some(&u8::from(index + 1 == frames.len())))
    };
    if !valid(left) || !valid(right) {
        return Ok(false);
    }
    if left == right {
        return Ok(true);
    }
    let same_framing = left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|(a, b)| a.len() == b.len() && a[0] == b[0]);
    let left: Vec<_> = left
        .iter()
        .flat_map(|frame| frame[1..].iter().copied())
        .collect();
    let right: Vec<_> = right
        .iter()
        .flat_map(|frame| frame[1..].iter().copied())
        .collect();
    let Ok(a) = FromRemote::deserialize(&left) else {
        return Ok(false);
    };
    let Ok(b) = FromRemote::deserialize(&right) else {
        return Ok(false);
    };
    // Envelope structure must be canonical on each side: no trailing bytes,
    // unknown fields or inconsistent length prefixes may hide in a Loro export.
    let mut canonical_a = Vec::new();
    let mut canonical_b = Vec::new();
    a.serialize(&mut canonical_a)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    b.serialize(&mut canonical_b)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    if canonical_a != left || canonical_b != right {
        return Ok(false);
    }
    match (a, b) {
        (
            FromRemote::RemoteInitialSync {
                snapshot: a,
                awareness: aw,
            },
            FromRemote::RemoteInitialSync {
                snapshot: b,
                awareness: bw,
            },
        ) => Ok(equivalent_snapshots(&a, &b)? && equivalent_awareness(&aw, &bw)?),
        (
            FromRemote::RemoteSnapshot { snapshot: a },
            FromRemote::RemoteSnapshot { snapshot: b },
        ) => equivalent_snapshots(&a, &b),
        (
            FromRemote::RemoteUpdateSince { update: a, vv: av },
            FromRemote::RemoteUpdateSince { update: b, vv: bv },
        ) => {
            if *av != *bv {
                return Ok(false);
            }
            if *a == *b {
                return Ok(true);
            }
            let baseline = baseline.ok_or_else(|| {
                ReplayError::Mismatch(
                    "RequestSince delta comparison requires the pre-message document".into(),
                )
            })?;
            equivalent_updates(baseline, &a, &b)
        }
        (
            FromRemote::RemoteAwareness { awareness: a },
            FromRemote::RemoteAwareness { awareness: b },
        ) => Ok(same_framing && equivalent_awareness(&a, &b)?),
        _ => Ok(false),
    }
}
fn equivalent_awareness(left: &[u8], right: &[u8]) -> Result<bool, ReplayError> {
    let a = sync_protocol::presence::decode_timestamps(left)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    let b = sync_protocol::presence::decode_timestamps(right)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    Ok(a == b)
}

/// Import both deltas into equivalent pre-message documents and compare full state.
pub fn equivalent_updates(baseline: &[u8], left: &[u8], right: &[u8]) -> Result<bool, ReplayError> {
    let a = sync_server_core::domain::state::DocumentState::try_from_snapshot(baseline)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    let b = sync_server_core::domain::state::DocumentState::try_from_snapshot(baseline)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    let ai = a
        .loro_doc
        .import(left)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    let bi = b
        .loro_doc
        .import(right)
        .map_err(|e| ReplayError::Invalid(e.to_string()))?;
    if ai.pending.is_some()
        || bi.pending.is_some()
        || a.loro_doc.state_vv() != a.loro_doc.oplog_vv()
        || b.loro_doc.state_vv() != b.loro_doc.oplog_vv()
    {
        return Err(ReplayError::Mismatch(
            "RequestSince baseline lacks dependencies".into(),
        ));
    }
    Ok(a.loro_doc.get_deep_value() == b.loro_doc.get_deep_value()
        && a.loro_doc.oplog_vv() == b.loro_doc.oplog_vv()
        && a.frontiers() == b.frontiers())
}

// The orchestrator's native VV ordering ruling applies to this generated Loro
// revision metadata as well; client-supplied VV echoes remain exact bytes.
pub(crate) fn equivalent_stored_value(
    key: &str,
    a: &Value,
    b: &Value,
) -> Result<bool, ReplayError> {
    if key != "LAST_VERSION_VECTOR" {
        return Ok(a == b);
    }
    let decode = |value: &Value| -> Result<loro::VersionVector, ReplayError> {
        let bytes: Vec<u8> = serde_json::from_value(value.clone())
            .map_err(|e| ReplayError::Invalid(e.to_string()))?;
        loro::VersionVector::decode(&bytes).map_err(|e| ReplayError::Invalid(e.to_string()))
    };
    Ok(decode(a)? == decode(b)?)
}
