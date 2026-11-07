//! Native replay starts empty; callbacks are enabled only after moving into core.
use crate::{
    ports::{Effect, SimNow, SimPorts},
    transcript::{ServerInput, Transcript},
};
use std::collections::BTreeMap;
use sync_protocol::time::WallDuration;
use sync_server_core::domain::room::{Room, RoomConfig};

/// Golden fixtures with every callback implemented by the native room.
/// Add names with the callback extraction commits starting at C8.
pub const ENABLED: &[&str] = &[];

/// Parsing, unsupported-callback and parity failures stay distinguishable.
#[derive(Debug, thiserror::Error)]
pub enum ReplayError {
    /// The recording cannot be decoded losslessly.
    #[error("invalid transcript: {0}")]
    Invalid(String),
    /// A callback still belongs to the Worker adapter.
    #[error("callback not yet extracted into Room: {0}")]
    Unsupported(String),
    /// A recording is deliberately not yet in the replay allowlist.
    #[error("transcript not enabled for native replay: {0}")]
    NotEnabled(String),
    /// Exact effects or permitted semantic snapshot values differ.
    #[error("transcript mismatch: {0}")]
    Mismatch(String),
}
/// Result of one native callback, preserving emitted effects at a crash boundary.
pub enum StepResult {
    /// Callback completed synchronously.
    Done(Vec<Effect>),
    /// Callback stopped at a scheduled crash.
    Crashed(Vec<Effect>),
}
/// Owns the real core Room, sharing only the in-memory runtime ports across wakeups.
pub struct SimRoom {
    room: Room<SimPorts>,
}
fn config() -> RoomConfig {
    RoomConfig {
        awareness_timeout: WallDuration(5_000),
        alarm_delay: std::time::Duration::from_secs(5),
        isolate_keepalive: std::time::Duration::from_secs(60),
        create_default_state: true,
        oversized_message_warning: 1_000_000,
    }
}
impl SimRoom {
    /// Construct a cold native room over the supplied runtime state.
    pub fn new(ports: SimPorts) -> Self {
        Self {
            room: Room::new(ports, config()),
        }
    }
    /// Inspect the same Room used by future extracted callbacks.
    pub fn room(&self) -> &Room<SimPorts> {
        &self.room
    }
    /// Access the real room for native use-case tests and simulation drivers.
    pub fn room_mut(&mut self) -> &mut Room<SimPorts> {
        &mut self.room
    }
    /// Drive only already-extracted events; never substitute fake callback outputs.
    pub fn step(&mut self, now: SimNow, input: ServerInput) -> Result<StepResult, ReplayError> {
        self.room.ports().set_now(now);
        match input {
            ServerInput::NewObject => {
                let ports = self.room.ports().clone();
                self.room = Room::new(ports, config());
            }
            ServerInput::AdvanceClock(duration) => self.room.ports().set_now(SimNow {
                unix_ms: now.unix_ms + duration.as_millis() as i64,
                monotonic: now.monotonic + duration,
            }),
            ServerInput::RuntimeCloses(socket) => self.room.ports().runtime_closes(&socket),
            other => return Err(ReplayError::Unsupported(other.kind().into())),
        }
        let effects = self.room.ports().take_effects();
        Ok(if self.room.ports().crashed() {
            StepResult::Crashed(effects)
        } else {
            StepResult::Done(effects)
        })
    }
}
/// Replay enabled recordings through real native Room callbacks.
/// C7 intentionally enables none: a successful no-op must never masquerade as parity.
pub fn replay(transcript: &Transcript) -> Result<Vec<Effect>, ReplayError> {
    if !ENABLED.contains(&transcript.name.as_str()) {
        return Err(ReplayError::NotEnabled(transcript.name.clone()));
    }
    let mut rooms = BTreeMap::new();
    let mut effects = Vec::new();
    for recorded in transcript.inputs()? {
        let room = rooms
            .entry(recorded.room)
            .or_insert_with(|| SimRoom::new(SimPorts::new()));
        match room.step(recorded.now, recorded.input)? {
            StepResult::Done(next) | StepResult::Crashed(next) => effects.extend(next),
        }
    }
    Ok(effects)
}
