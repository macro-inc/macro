//! Native replay enables callbacks only after their implementation moves into core.
use crate::{
    ports::{Effect, SimNow, SimPorts},
    transcript::{ServerInput, Transcript},
};
use futures::FutureExt;
use sync_protocol::time::WallDuration;
use sync_server_core::domain::room::{AlarmOutcome, InboundFrame, Room, RoomConfig};
mod golden;

/// Golden fixtures with every callback implemented by the native room.
/// Add names with the callback extraction commits starting at C8.
pub const ENABLED: &[&str] = &[
    "surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl",
    "surface_migration.test/isolated_initialization_acknowledges_only_the_identical_verified_operation_and_seed.jsonl",
    "document_atomic.test/atomic_document_API_returns_compact_state_at_the_same_revision_and_accepts_edits_from_it.jsonl",
    "surface_isolation.test/same_UUID_has_distinct_grants_snapshots_broadcasts_peers_and_effects.jsonl",
    "hibernation.test/H1_restores_the_websocket_tag_after_eviction.jsonl",
    "hibernation.test/H2_lazily_restores_stored_websocket_metadata.jsonl",
    "hibernation.test/H5_restores_read-only_write_permissions_after_eviction.jsonl",
    "hibernation.test/H8_loads_the_snapshot_and_replays_pending_operations.jsonl",
    "hibernation.test/H9_preserves_the_exists_reset_and_surviving_applied-key_quirk.jsonl",
    "hibernation.test/H10_discards_an_incomplete_inbound_frame_on_eviction.jsonl",
    "transcript_boundaries.test/A4_compaction_drops_acknowledged_pending_imports_from_the_snapshot.jsonl",
    "document_sync.test/document_sync_tests_should_receive_initial_sync_on_connect.jsonl",
    "document_sync.test/document_sync_tests_should_be_able_to_load_initial_sync_into_loro.jsonl",
    "websocket.test/websocket_tests_should_respond_to_ping_with_pong.jsonl",
    "transcript_boundaries.test/M12_echoes_the_exact_request_version_vector.jsonl",
    "delete_endpoint.test/delete_endpoint_succeeds_for_a_document_that_never_had_a_session.jsonl",
    "raw_endpoint.test/raw_endpoint_tests_should_return_404_for_non-existent_document.jsonl",
    "awareness.test/awareness_sync_tests_should_include_awareness_on_connection_if_available.jsonl",
];

/// Parsing, unsupported-callback and parity failures stay distinguishable.
#[derive(Debug, thiserror::Error)]
pub enum ReplayError {
    /// The recording cannot be decoded losslessly.
    #[error("invalid transcript: {0}")]
    Invalid(String),
    /// The extracted callback failed.
    #[error("room callback failed: {0}")]
    Callback(String),
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
        match &input {
            ServerInput::NewObject
            | ServerInput::AdvanceClock(_)
            | ServerInput::RuntimeCloses(_)
            | ServerInput::Connect { .. }
            | ServerInput::AlarmFired
            | ServerInput::Close(_)
            | ServerInput::Text { .. }
            | ServerInput::Binary { .. } => {}
            other => return Err(ReplayError::Unsupported(other.kind().into())),
        }
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
            other => {
                let future = async {
                    match other {
                        ServerInput::Connect { grant, key } => {
                            self.room.connect(grant, key).await?;
                        }
                        ServerInput::AlarmFired => {
                            self.room.ports().fire_alarm();
                            let body = match self.room.on_alarm().await? {
                                AlarmOutcome::Skipped => vec![],
                                AlarmOutcome::Completed => b"ok".to_vec(),
                            };
                            self.room.ports().transport_effect(Effect {
                                operation: "alarm.response".into(),
                                value: serde_json::json!({"status":200,"body":body}),
                            });
                        }
                        ServerInput::Close(socket) => self.room.on_close(&socket).await?,
                        ServerInput::Text { socket, text } => {
                            self.room
                                .on_frame(&socket, InboundFrame::Text(text))
                                .await?
                        }
                        ServerInput::Binary { socket, bytes } => {
                            self.room
                                .on_frame(&socket, InboundFrame::Binary(bytes))
                                .await?
                        }
                        _ => unreachable!("unsupported inputs rejected before polling"),
                    }
                    Ok::<(), sync_server_core::domain::room::RoomError>(())
                };
                match future.now_or_never() {
                    Some(Ok(())) => {}
                    Some(Err(_)) if self.room.ports().crashed() => {}
                    Some(Err(error)) => return Err(ReplayError::Callback(error.to_string())),
                    None if self.room.ports().crashed() => {}
                    None => {
                        return Err(ReplayError::Mismatch(
                            "native port did not complete on its first poll".into(),
                        ));
                    }
                }
            }
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
/// Unsupported callbacks fail explicitly rather than masquerading as parity.
pub fn replay(transcript: &Transcript) -> Result<Vec<Effect>, ReplayError> {
    if !ENABLED.contains(&transcript.name.as_str()) {
        return Err(ReplayError::NotEnabled(transcript.name.clone()));
    }
    golden::replay(transcript)
}
