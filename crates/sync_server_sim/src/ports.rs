//! Deterministic in-memory implementations of every room capability.
//! CS-60/CS-56: futures and errors stay on the calling thread, like Worker ports.
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet, VecDeque},
    rc::Rc,
    time::Duration,
};
use sync_server_core::domain::{
    connection::{ConnectionMetadata, SurfaceLifecycle},
    document::DocumentAttribution,
    migration::{SourceState, TargetState},
    models::{BlameRow, PeerWithUserId},
    ports::*,
    socket::{SocketTagError, WebSocketId},
    state::RootChange,
    types::*,
};

/// An ordered call or delivery at a room port boundary.
#[derive(Clone, Debug, PartialEq)]
pub struct Effect {
    /// Capability and operation, for example `storage.put`.
    pub operation: String,
    /// Typed operation arguments represented without byte loss.
    pub value: Value,
}

/// A deterministic failure at a numbered operation (indices start at zero).
#[derive(Clone, Debug)]
pub enum Fault {
    /// Return an adapter error.
    Error(String),
    /// Stop polling this call until the room is discarded.
    Crash,
}
/// Faults are keyed by operation name and its zero-based invocation index.
pub type FaultSchedule = BTreeMap<(String, usize), Fault>;

/// Native port failure, including an injected room crash.
#[derive(Clone, Debug, thiserror::Error)]
pub enum SimError {
    /// A deterministic adapter failure.
    #[error("{0}")]
    Failure(String),
    /// The simulated process no longer makes progress.
    #[error("simulated room crash")]
    Crashed,
}

/// Whether writes and socket deliveries complete immediately or await confirmation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum GateMode {
    /// Every write is durable immediately; used by transcript replay.
    #[default]
    Immediate,
    /// Sends wait for confirmation of preceding writes; used by fault simulations.
    Held,
}

/// Explicit simulation clocks; no ambient time is read.
#[derive(Clone, Copy, Debug, Default)]
pub struct SimNow {
    /// Wall-clock milliseconds.
    pub unix_ms: i64,
    /// Time since the simulation's monotonic origin.
    pub monotonic: Duration,
}

#[derive(Clone, Default)]
struct DurableData {
    values: BTreeMap<String, Value>,
    snapshots: BTreeMap<String, Vec<u8>>,
    peers: BTreeMap<(String, String), (String, Option<String>)>,
    blame: BTreeMap<(String, String), (u64, i64)>,
    alarm: Option<UnixMillis>,
}
#[derive(Default)]
struct State {
    data: DurableData,
    durable: DurableData,
    checkpoints: BTreeMap<u64, DurableData>,
    generation: u64,
    confirmed: u64,
    held: Vec<(u64, Effect)>,
    delivery_proofs: Vec<(u64, u64)>,
    queued_sends: Vec<Effect>,
    completed_closes: Vec<(WebSocketId, u16)>,
    completed_puts: Vec<(String, Value, u64)>,
    gate: GateMode,
    effects: Vec<Effect>,
    counts: BTreeMap<String, usize>,
    faults: FaultSchedule,
    operation_errors: BTreeMap<String, String>,
    crashed: bool,
    sockets: Vec<WebSocketId>,
    enumeration: VecDeque<Vec<WebSocketId>>,
    closing: BTreeSet<WebSocketId>,
    tags: BTreeMap<WebSocketId, Vec<String>>,
    now: SimNow,
    clocks: VecDeque<(String, u128)>,
    presence_clocks: VecDeque<i64>,
    entropy: VecDeque<uuid_types::Uuid>,
    next_uuid: u128,
    verdicts: VecDeque<Result<bool, SimError>>,
    latency: BTreeMap<String, Duration>,
    busy_for: Duration,
}
impl State {
    fn call(&mut self, operation: &str, value: Value) -> Result<(), SimError> {
        if self.crashed {
            return Err(SimError::Crashed);
        }
        self.effects.push(Effect {
            operation: operation.into(),
            value,
        });
        let index = self.counts.entry(operation.into()).or_default();
        let fault = self.faults.get(&(operation.into(), *index)).cloned();
        *index += 1;
        let all_index = self.counts.entry("*".into()).or_default();
        let global_fault = self.faults.get(&("*".into(), *all_index)).cloned();
        *all_index += 1;
        let fault = fault.or(global_fault).or_else(|| {
            self.operation_errors
                .get(operation)
                .cloned()
                .map(Fault::Error)
        });
        self.busy_for += self.latency.get(operation).copied().unwrap_or_default();
        match fault {
            Some(Fault::Error(error)) => Err(SimError::Failure(error)),
            Some(Fault::Crash) => {
                self.crashed = true;
                Err(SimError::Crashed)
            }
            None => Ok(()),
        }
    }
    fn write(&mut self) {
        self.generation += 1;
        match self.gate {
            GateMode::Immediate => {
                self.durable = self.data.clone();
                self.confirmed = self.generation;
            }
            GateMode::Held => {
                self.checkpoints.insert(self.generation, self.data.clone());
            }
        }
    }
    fn commit_directory(&mut self) {
        self.durable.peers = self.data.peers.clone();
        self.durable.blame = self.data.blame.clone();
        for checkpoint in self.checkpoints.values_mut() {
            checkpoint.peers = self.data.peers.clone();
            checkpoint.blame = self.data.blame.clone();
        }
    }
    fn deliver(&mut self, effect: Effect) {
        self.queued_sends.push(effect.clone());
        if self.gate == GateMode::Held && self.generation > self.confirmed {
            self.held.push((self.generation, effect));
        } else {
            self.delivery_proofs.push((self.generation, self.confirmed));
            self.effects.push(effect);
        }
    }
}

/// Shared native ports; cloning preserves the durable store and runtime socket set.
#[derive(Clone, Default)]
pub struct SimPorts(Rc<RefCell<State>>);
impl SimPorts {
    /// Start with immediate durability and deterministic empty state.
    pub fn new() -> Self {
        Self::default()
    }
    /// Set the time at callback entry and reset accumulated network latency.
    pub fn set_now(&self, now: SimNow) {
        let mut s = self.0.borrow_mut();
        s.now = now;
        s.busy_for = Duration::ZERO;
    }
    /// Queue runtime enumeration order; membership is still checked against live sockets.
    pub fn seed_enumeration(&self, lists: impl IntoIterator<Item = Vec<WebSocketId>>) {
        self.0.borrow_mut().enumeration = lists.into_iter().collect();
    }
    /// Supply previously unobservable local-delete timestamps from C0 wire data.
    pub fn seed_presence_clocks(&self, values: impl IntoIterator<Item = i64>) {
        self.0.borrow_mut().presence_clocks = values.into_iter().collect();
    }
    /// Queue exact clock readings, in port-call order, for native replay.
    pub fn seed_clocks(&self, values: impl IntoIterator<Item = (String, u128)>) {
        self.0.borrow_mut().clocks.extend(values);
    }
    /// Queue socket UUIDs observed in the Worker transcript.
    pub fn seed_entropy(&self, values: impl IntoIterator<Item = uuid_types::Uuid>) {
        self.0.borrow_mut().entropy.extend(values);
    }
    /// Queue recorded comment-service verdicts; absent verdicts fail closed.
    pub fn seed_verdicts(&self, values: impl IntoIterator<Item = Result<bool, SimError>>) {
        self.0.borrow_mut().verdicts.extend(values);
    }
    /// Replace the deterministic fault schedule.
    pub fn set_faults(&self, faults: FaultSchedule) {
        self.0.borrow_mut().faults = faults;
    }
    /// Inject a fault after this many additional port calls, across all capabilities.
    pub fn fault_after_calls(&self, after: usize, fault: Fault) {
        let mut state = self.0.borrow_mut();
        let next = state
            .counts
            .get("*")
            .copied()
            .unwrap_or(0)
            .saturating_add(after);
        state.faults.insert(("*".into(), next), fault);
    }
    /// Number of calls already made to a capability, for relative fault schedules.
    pub fn call_count(&self, operation: &str) -> usize {
        self.0.borrow().counts.get(operation).copied().unwrap_or(0)
    }
    /// Enable or clear a capability outage without altering its stored data.
    pub fn set_operation_error(&self, operation: &str, error: Option<String>) {
        let mut state = self.0.borrow_mut();
        if let Some(error) = error {
            state.operation_errors.insert(operation.into(), error);
        } else {
            state.operation_errors.remove(operation);
        }
    }
    /// Fresh runtime over a clone of only confirmed durable storage.
    /// Loading it cannot change the live activation or its effect log.
    pub fn fork_durable(&self) -> Self {
        let state = self.0.borrow();
        Self(Rc::new(RefCell::new(State {
            data: state.durable.clone(),
            durable: state.durable.clone(),
            now: state.now,
            ..State::default()
        })))
    }
    /// Configure a network operation's simulated busy window.
    pub fn set_latency(&self, operation: &str, latency: Duration) {
        self.0
            .borrow_mut()
            .latency
            .insert(operation.into(), latency);
    }
    /// Network time accumulated during the current callback.
    pub fn busy_for(&self) -> Duration {
        self.0.borrow().busy_for
    }
    /// Whether a fault terminated this activation.
    pub fn crashed(&self) -> bool {
        self.0.borrow().crashed
    }
    /// Select immediate durability or held output-gate delivery.
    pub fn set_gate(&self, mode: GateMode) {
        self.0.borrow_mut().gate = mode;
    }
    /// Current issued write generation, for explicit durability confirmation.
    pub fn write_generation(&self) -> u64 {
        self.0.borrow().generation
    }
    /// Confirm issued writes through this generation and release eligible sends.
    pub fn confirm_through(&self, generation: u64) {
        let mut s = self.0.borrow_mut();
        let generation = generation.min(s.generation);
        if let Some(data) = s.checkpoints.get(&generation).cloned() {
            s.durable = data;
        }
        s.confirmed = s.confirmed.max(generation);
        s.checkpoints.retain(|key, _| *key > generation);
        let held = std::mem::take(&mut s.held);
        for (at, effect) in held {
            if at <= s.confirmed {
                let confirmed = s.confirmed;
                s.delivery_proofs.push((at, confirmed));
                s.effects.push(effect);
            } else {
                s.held.push((at, effect));
            }
        }
    }
    /// Crash recovery retains only durable data and runtime socket handles.
    pub fn recover(&self) {
        let mut s = self.0.borrow_mut();
        s.data = s.durable.clone();
        s.held.clear();
        s.checkpoints.clear();
        s.generation = s.confirmed;
        s.crashed = false;
    }
    /// Override runtime tags to exercise missing or malformed hibernation metadata.
    pub fn set_socket_tags(&self, socket: WebSocketId, tags: Vec<String>) {
        self.0.borrow_mut().tags.insert(socket, tags);
    }
    /// Begin a runtime close without removing the socket from the callback list.
    pub fn begin_close(&self, socket: &WebSocketId) {
        self.0.borrow_mut().closing.insert(socket.clone());
    }
    /// Remove a closing socket only after its close callback has completed.
    pub fn runtime_closes(&self, socket: &WebSocketId) {
        self.0.borrow_mut().sockets.retain(|item| item != socket);
    }
    /// The runtime consumes the current alarm before invoking its callback.
    pub fn fire_alarm(&self) {
        let mut s = self.0.borrow_mut();
        s.data.alarm = None;
        s.durable.alarm = None;
    }
    /// Inspect the durable wakeup deadline without a port call.
    pub fn alarm_dump(&self) -> Option<i64> {
        self.0.borrow().data.alarm.map(|time| time.0)
    }
    /// Inspect attribution tables without emitting query effects.
    pub fn directory_dump(&self) -> Value {
        let s = self.0.borrow();
        json!({
            "peer_user_map": s.data.peers.iter().map(|((document, peer), (user, actor))| json!({"document_id":document,"peer_id":peer,"user_id":user,"actor":actor})).collect::<Vec<_>>(),
            "blame": s.data.blame.iter().map(|((document,node),(peer,time))|json!({"document_id":document,"node_id":node,"peer_id":peer.to_string(),"timestamp_ms":time})).collect::<Vec<_>>()
        })
    }
    pub(crate) fn transport_effect(&self, effect: Effect) {
        self.0.borrow_mut().effects.push(effect);
    }
    /// Successful close requests; failed attempts remain only in the ordinary effect log.
    pub fn take_completed_closes(&self) -> Vec<(WebSocketId, u16)> {
        std::mem::take(&mut self.0.borrow_mut().completed_closes)
    }
    /// Successful send enqueues, excluding failed attempts and preserving gate order.
    pub fn take_queued_sends(&self) -> Vec<Effect> {
        std::mem::take(&mut self.0.borrow_mut().queued_sends)
    }
    /// Drain (required write generation, confirmed generation) proofs in delivery order.
    /// This side channel observes the output gate without altering recorded effects.
    pub fn take_delivery_proofs(&self) -> Vec<(u64, u64)> {
        std::mem::take(&mut self.0.borrow_mut().delivery_proofs)
    }
    /// Drain the ordered port log.
    pub fn take_effects(&self) -> Vec<Effect> {
        std::mem::take(&mut self.0.borrow_mut().effects)
    }
    /// Remaining recorded clock reads, for exact replay count checks.
    pub fn remaining_clocks(&self) -> usize {
        self.0.borrow().clocks.len()
    }
    /// Completed puts, with exact values and generations, separate from attempted effects.
    pub fn take_completed_puts(&self) -> Vec<(String, Value, u64)> {
        std::mem::take(&mut self.0.borrow_mut().completed_puts)
    }
    /// Current visible key/value storage, including writes awaiting gate confirmation.
    pub fn storage_dump(&self) -> BTreeMap<String, Value> {
        self.0.borrow().data.values.clone()
    }
    /// Inspect logical snapshot bytes without emitting a simulated port call.
    pub fn snapshot_dump(&self) -> BTreeMap<String, Vec<u8>> {
        self.0.borrow().data.snapshots.clone()
    }
    async fn enter(&self, operation: &str, value: Value) -> Result<(), SimError> {
        let result = self.0.borrow_mut().call(operation, value);
        match result {
            Err(SimError::Crashed) => std::future::pending().await,
            other => other,
        }
    }
    fn read<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, SimError> {
        self.0
            .borrow()
            .data
            .values
            .get(key)
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|e| SimError::Failure(e.to_string()))
    }
    fn put(&self, key: &str, value: impl Serialize) -> Result<(), SimError> {
        let value = serde_json::to_value(value).map_err(|e| SimError::Failure(e.to_string()))?;
        let mut s = self.0.borrow_mut();
        s.data.values.insert(key.into(), value.clone());
        s.write();
        let generation = s.generation;
        s.completed_puts.push((key.into(), value, generation));
        Ok(())
    }
    fn clock(&self, kind: &str, fallback: impl FnOnce(&State) -> u128) -> u128 {
        let mut s = self.0.borrow_mut();
        if s.crashed {
            return fallback(&s);
        }
        // C0 did not observe Loro's internal clock. Only presence may use the
        // callback's explicit simulated time when an older fixture has no read.
        let seeded = if kind == "presence" && s.clocks.front().is_some_and(|(k, _)| k != kind) {
            None
        } else {
            s.clocks.pop_front()
        };
        let value = match seeded {
            Some((expected, value)) => {
                assert_eq!(expected, kind, "clock-read order mismatch");
                value
            }
            None => fallback(&s),
        };
        s.effects.push(Effect {
            operation: "clock".into(),
            value: json!({"kind":kind,"value":value.to_string()}),
        });
        value
    }
}
impl Clock for SimPorts {
    fn monotonic(&self) -> Duration {
        Duration::from_nanos(
            self.clock("monotonic", |s| (s.now.monotonic + s.busy_for).as_nanos()) as u64,
        )
    }
    fn unix_time(&self) -> UnixMillis {
        let presence = self.0.borrow_mut().presence_clocks.pop_front();
        if let Some(now) = presence {
            self.0.borrow_mut().effects.push(Effect {
                operation: "clock".into(),
                value: json!({"kind":"presence","value":now.to_string()}),
            });
            return UnixMillis(now);
        }
        UnixMillis(self.clock("presence", |s| {
            (s.now.unix_ms
                + i64::try_from(s.busy_for.as_millis()).expect("simulation latency fits"))
                as u128
        }) as i64)
    }
    fn unix_time_for(&self, purpose: WallClock) -> UnixMillis {
        UnixMillis(self.clock(purpose.tag(), |s| {
            (s.now.unix_ms + s.busy_for.as_millis() as i64) as u128
        }) as i64)
    }
    fn unix_nanos(&self) -> u128 {
        self.clock("unix_nanos", |s| {
            (s.now.unix_ms as u128) * 1_000_000 + s.busy_for.as_nanos()
        })
    }
}
impl Entropy for SimPorts {
    fn socket_uuid(&self) -> uuid_types::Uuid {
        let mut s = self.0.borrow_mut();
        if s.crashed {
            return uuid_types::Uuid::nil();
        }
        let uuid = if let Some(uuid) = s.entropy.pop_front() {
            uuid
        } else {
            s.next_uuid += 1;
            {
                let mut bytes = s.next_uuid.to_be_bytes();
                bytes[6] = (bytes[6] & 0x0f) | 0x40;
                bytes[8] = (bytes[8] & 0x3f) | 0x80;
                uuid_types::Uuid::from_bytes(bytes)
            }
        };
        s.effects.push(Effect {
            operation: "entropy".into(),
            value: json!(uuid.to_string()),
        });
        uuid
    }
}
impl Connections for SimPorts {
    type Socket = WebSocketId;
    type Error = SimError;
    fn all(&self) -> Vec<WebSocketId> {
        let mut s = self.0.borrow_mut();
        let sockets = s.sockets.clone();
        if s.crashed {
            return sockets;
        }
        let sockets = if let Some(ordered) = s.enumeration.pop_front() {
            assert_eq!(
                ordered.iter().collect::<BTreeSet<_>>(),
                sockets.iter().collect::<BTreeSet<_>>(),
                "runtime socket membership differs"
            );
            ordered
        } else {
            sockets
        };
        s.effects.push(Effect {
            operation: "connections.all".into(),
            value: json!(sockets.iter().map(WebSocketId::as_str).collect::<Vec<_>>()),
        });
        sockets
    }
    fn socket_id(&self, socket: &WebSocketId) -> Result<WebSocketId, SocketTagError> {
        let mut s = self.0.borrow_mut();
        if s.crashed {
            return Ok(socket.clone());
        }
        let tags = s.tags.get(socket).cloned().unwrap_or_default();
        s.effects.push(Effect {
            operation: "connections.id".into(),
            value: json!({"socket":socket.as_str(),"tags":tags}),
        });
        WebSocketId::from_tags(&tags)
    }
    fn accept(&self, id: &WebSocketId) -> Result<WebSocketId, SimError> {
        let mut s = self.0.borrow_mut();
        s.call("connections.accept", json!(id.as_str()))?;
        s.sockets.push(id.clone());
        s.closing.remove(id);
        s.tags.insert(id.clone(), vec![id.as_str().into()]);
        Ok(id.clone())
    }
    fn send_binary(&self, socket: &WebSocketId, frame: &[u8]) -> Result<(), SimError> {
        let mut s = self.0.borrow_mut();
        s.call(
            "connections.send_binary",
            json!({"socket":socket.as_str(),"frame":frame}),
        )?;
        if s.closing.contains(socket) || !s.sockets.contains(socket) {
            return Err(SimError::Failure(
                "Can't call WebSocket send() after close().".into(),
            ));
        }
        s.deliver(Effect {
            operation: "send".into(),
            value: json!({"socket":socket.as_str(),"frame":frame}),
        });
        Ok(())
    }
    fn send_text(&self, socket: &WebSocketId, text: &str) -> Result<(), SimError> {
        let mut s = self.0.borrow_mut();
        s.call(
            "connections.send_text",
            json!({"socket":socket.as_str(),"text":text}),
        )?;
        if s.closing.contains(socket) || !s.sockets.contains(socket) {
            return Err(SimError::Failure(
                "Can't call WebSocket send() after close().".into(),
            ));
        }
        s.deliver(Effect {
            operation: "send_text".into(),
            value: json!({"socket":socket.as_str(),"text":text}),
        });
        Ok(())
    }
    fn close(&self, socket: &WebSocketId, reason: CloseReason) -> Result<(), SimError> {
        let mut s = self.0.borrow_mut();
        s.call(
            "connections.close",
            json!({"socket":socket.as_str(),"code":CloseReason::CODE,"reason":reason.as_str()}),
        )?;
        s.closing.insert(socket.clone());
        s.completed_closes.push((socket.clone(), CloseReason::CODE));
        // C4 capture: server-close remains in getWebSockets until runtime removal.
        Ok(())
    }
}

impl RoomStorage for SimPorts {
    type Error = SimError;
    async fn session_key(&self) -> Result<Option<SessionKey>, SimError> {
        self.enter("storage.get", json!("DOCUMENT_ID")).await?;
        self.read("DOCUMENT_ID")
            .map(|value: Option<String>| value.map(SessionKey::new))
    }
    async fn surface_lifecycle(&self) -> Result<Option<SurfaceLifecycle>, SimError> {
        self.enter("storage.get", json!("SURFACE_LIFECYCLE"))
            .await?;
        self.read("SURFACE_LIFECYCLE")
    }
    async fn source_migration(&self) -> Result<Option<SourceState>, SimError> {
        self.enter("storage.get", json!("SURFACE_MIGRATION_SOURCE"))
            .await?;
        self.read("SURFACE_MIGRATION_SOURCE")
    }
    async fn target_migration(&self) -> Result<Option<TargetState>, SimError> {
        self.enter("storage.get", json!("SURFACE_MIGRATION_TARGET"))
            .await?;
        self.read("SURFACE_MIGRATION_TARGET")
    }
    async fn saved_version_vector(&self) -> Result<Option<Vec<u8>>, SimError> {
        self.enter("storage.get", json!("LAST_VERSION_VECTOR"))
            .await?;
        self.read("LAST_VERSION_VECTOR")
    }
    async fn put_session_key(&self, key: &SessionKey) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"DOCUMENT_ID","value":key.as_str()}),
        )
        .await?;
        self.put("DOCUMENT_ID", key.as_str())
    }
    async fn put_surface_lifecycle(&self, lifecycle: SurfaceLifecycle) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"SURFACE_LIFECYCLE","value":lifecycle}),
        )
        .await?;
        self.put("SURFACE_LIFECYCLE", lifecycle)
    }
    async fn put_source_migration(&self, state: &SourceState) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"SURFACE_MIGRATION_SOURCE","value":state}),
        )
        .await?;
        self.put("SURFACE_MIGRATION_SOURCE", state)
    }
    async fn put_target_migration(&self, state: &TargetState) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"SURFACE_MIGRATION_TARGET","value":state}),
        )
        .await?;
        self.put("SURFACE_MIGRATION_TARGET", state)
    }
    async fn put_saved_version_vector(&self, encoded: &[u8]) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"LAST_VERSION_VECTOR","value":encoded}),
        )
        .await?;
        self.put("LAST_VERSION_VECTOR", encoded)
    }
    async fn connection(&self, id: &WebSocketId) -> Result<Option<ConnectionMetadata>, SimError> {
        self.enter("storage.get", json!(id.as_str())).await?;
        self.read(id.as_str())
    }
    async fn put_connection(
        &self,
        id: &WebSocketId,
        metadata: &ConnectionMetadata,
    ) -> Result<(), SimError> {
        self.enter("storage.put", json!({"key":id.as_str(),"value":metadata}))
            .await?;
        self.put(id.as_str(), metadata)
    }
    async fn delete_connection(&self, id: &WebSocketId) -> Result<(), SimError> {
        self.enter("storage.delete", json!(id.as_str())).await?;
        let mut s = self.0.borrow_mut();
        s.data.values.remove(id.as_str());
        s.write();
        Ok(())
    }
    async fn pending_operations(
        &self,
    ) -> Result<Vec<Result<PendingOperation, SimError>>, SimError> {
        self.enter("storage.list", json!("o/")).await?;
        Ok(self
            .0
            .borrow()
            .data
            .values
            .iter()
            .filter_map(|(key, value)| {
                key.strip_prefix("o/").map(|id| {
                    serde_json::from_value(value.clone())
                        .map(|update| PendingOperation {
                            id: OperationId::new(id.into()),
                            update,
                        })
                        .map_err(|e| SimError::Failure(e.to_string()))
                })
            })
            .collect())
    }
    async fn put_pending_operation(&self, id: &OperationId, update: &[u8]) -> Result<(), SimError> {
        let key = format!("o/{}", id.as_str());
        self.enter("storage.put", json!({"key":key,"value":update}))
            .await?;
        self.put(&key, update)
    }
    async fn put_archived_operation(
        &self,
        id: &OperationId,
        update: &[u8],
    ) -> Result<(), SimError> {
        let key = format!("a/{}", id.as_str());
        self.enter("storage.put", json!({"key":key,"value":update}))
            .await?;
        self.put(&key, update)
    }
    async fn put_operation_attribution(
        &self,
        id: &OperationId,
        attribution: &DocumentAttribution,
    ) -> Result<(), SimError> {
        let key = format!("actor/{}", id.as_str());
        self.enter("storage.put", json!({"key":key,"value":attribution}))
            .await?;
        self.put(&key, attribution)
    }
    async fn delete_pending_operations(&self, ids: &[OperationId]) -> Result<usize, SimError> {
        let keys: Vec<_> = ids.iter().map(|id| format!("o/{}", id.as_str())).collect();
        self.enter("storage.delete_multiple", json!(keys)).await?;
        let mut s = self.0.borrow_mut();
        let count = keys
            .iter()
            .filter(|key| s.data.values.remove(*key).is_some())
            .count();
        s.write();
        Ok(count)
    }
    async fn delete_all(&self) -> Result<(), SimError> {
        self.enter("storage.delete_all", Value::Null).await?;
        let mut s = self.0.borrow_mut();
        s.data.values.clear();
        s.data.snapshots.clear();
        s.write();
        Ok(())
    }
}
impl SnapshotStore for SimPorts {
    type Error = SimError;
    fn prepare(&self, key: &SessionKey) -> Result<(), SimError> {
        self.0
            .borrow_mut()
            .call("snapshot.prepare", json!(key.as_str()))
    }
    async fn has(&self, key: &SessionKey) -> Result<bool, SimError> {
        self.enter("snapshot.has", json!(key.as_str())).await?;
        Ok(self.0.borrow().data.snapshots.contains_key(key.as_str()))
    }
    async fn get(&self, key: &SessionKey) -> Result<Vec<u8>, SnapshotReadError<SimError>> {
        self.enter("snapshot.get", json!(key.as_str()))
            .await
            .map_err(SnapshotReadError::Storage)?;
        self.0
            .borrow()
            .data
            .snapshots
            .get(key.as_str())
            .cloned()
            .ok_or(SnapshotReadError::Missing)
    }
    async fn put(&self, key: &SessionKey, snapshot: &[u8]) -> Result<(), SimError> {
        self.enter("snapshot.put", json!({"key":key.as_str(),"bytes":snapshot}))
            .await?;
        let mut s = self.0.borrow_mut();
        s.data
            .snapshots
            .insert(key.as_str().into(), snapshot.into());
        s.write();
        Ok(())
    }
    async fn delete(&self, key: &SessionKey) -> Result<(), SimError> {
        self.enter("snapshot.delete", json!(key.as_str())).await?;
        let mut s = self.0.borrow_mut();
        s.data.snapshots.remove(key.as_str());
        s.write();
        Ok(())
    }
    async fn export(
        &self,
        operation: uuid_types::Uuid,
    ) -> Result<Vec<u8>, SnapshotReadError<SimError>> {
        let key = SessionKey::new(format!("migration-export:{operation}"));
        self.prepare(&key).map_err(SnapshotReadError::Storage)?;
        self.get(&key).await
    }
    async fn put_export(
        &self,
        operation: uuid_types::Uuid,
        snapshot: &[u8],
    ) -> Result<(), SimError> {
        let key = SessionKey::new(format!("migration-export:{operation}"));
        self.prepare(&key)?;
        SnapshotStore::put(self, &key, snapshot).await
    }
}
impl AlarmScheduler for SimPorts {
    type Error = SimError;
    async fn scheduled(&self) -> Result<Option<UnixMillis>, SimError> {
        self.enter("alarm.get", Value::Null).await?;
        Ok(self.0.borrow().data.alarm)
    }
    async fn schedule_in(&self, delay: Duration) -> Result<(), SimError> {
        let now = self.clock("alarm_set_ms", |s| {
            (s.now.unix_ms + s.busy_for.as_millis() as i64) as u128
        }) as i64;
        self.enter("alarm.set", json!({"delay_ms":delay.as_millis()}))
            .await?;
        let mut s = self.0.borrow_mut();
        s.data.alarm = Some(UnixMillis(now + delay.as_millis() as i64));
        s.write();
        Ok(())
    }
    async fn cancel(&self) -> Result<(), SimError> {
        self.enter("alarm.delete", Value::Null).await?;
        let mut s = self.0.borrow_mut();
        s.data.alarm = None;
        s.write();
        Ok(())
    }
}
impl PeerDirectory for SimPorts {
    type Error = SimError;
    async fn claim_peer(
        &self,
        document: &SessionKey,
        user: &str,
        actor: Option<&str>,
        peer: PeerId,
    ) -> Result<(), SimError> {
        self.enter("peers.claim",json!({"document":document.as_str(),"user":user,"actor":actor,"peer":peer.0.to_string()})).await?;
        let mut s = self.0.borrow_mut();
        let key = (document.as_str().into(), peer.0.to_string());
        if s.data
            .peers
            .get(&key)
            .is_none_or(|(owner, _)| owner == "system")
        {
            s.data
                .peers
                .insert(key, (user.into(), actor.map(str::to_owned)));
        }
        s.commit_directory();
        Ok(())
    }
    async fn map_unowned_peers(
        &self,
        document: &SessionKey,
        user: &str,
        actor: Option<&str>,
        peers: &[PeerId],
    ) -> Result<(), SimError> {
        if peers.is_empty() {
            return Ok(());
        }
        self.enter("peers.map_unowned",json!({"document":document.as_str(),"user":user,"actor":actor,"peers":peers.iter().map(|p|p.0.to_string()).collect::<Vec<_>>()})).await?;
        let mut s = self.0.borrow_mut();
        for peer in peers {
            s.data
                .peers
                .entry((document.as_str().into(), peer.0.to_string()))
                .or_insert_with(|| (user.into(), actor.map(str::to_owned)));
        }
        s.commit_directory();
        Ok(())
    }
    async fn user_for_peer(
        &self,
        document: &SessionKey,
        peer: PeerId,
    ) -> Result<Option<String>, SimError> {
        self.enter(
            "peers.user",
            json!({"document":document.as_str(),"peer":peer.0.to_string()}),
        )
        .await?;
        Ok(self
            .0
            .borrow()
            .data
            .peers
            .get(&(document.as_str().into(), peer.0.to_string()))
            .map(|(user, _)| user.clone()))
    }
    async fn peers(&self, document: &SessionKey) -> Result<Vec<PeerWithUserId>, SimError> {
        self.enter("peers.list", json!(document.as_str())).await?;
        Ok(self
            .0
            .borrow()
            .data
            .peers
            .iter()
            .filter(|((doc, _), _)| doc == document.as_str())
            .map(|((_, peer), (user, actor))| PeerWithUserId {
                peer_id: peer.to_string(),
                user_id: user.clone(),
                actor: actor.clone(),
            })
            .collect())
    }
    async fn blame_for_node(
        &self,
        document: &SessionKey,
        node: &str,
    ) -> Result<Option<BlameRow>, SimError> {
        self.enter(
            "peers.blame",
            json!({"document":document.as_str(),"node":node}),
        )
        .await?;
        Ok(self
            .0
            .borrow()
            .data
            .blame
            .get(&(document.as_str().into(), node.into()))
            .map(|(peer, time)| BlameRow {
                peer_id: peer.to_string(),
                user_id: self
                    .0
                    .borrow()
                    .data
                    .peers
                    .get(&(document.as_str().into(), peer.to_string()))
                    .map(|(user, _)| user.clone()),
                actor: self
                    .0
                    .borrow()
                    .data
                    .peers
                    .get(&(document.as_str().into(), peer.to_string()))
                    .and_then(|(_, actor)| actor.clone()),
                timestamp_ms: *time,
            }))
    }
    async fn delete_document(&self, document: &SessionKey) -> Result<(), SimError> {
        self.enter("peers.delete_document", json!(document.as_str()))
            .await?;
        let mut s = self.0.borrow_mut();
        s.data.peers.retain(|(doc, _), _| doc != document.as_str());
        s.data.blame.retain(|(doc, _), _| doc != document.as_str());
        s.commit_directory();
        Ok(())
    }
}
impl CommentGate for SimPorts {
    type Error = SimError;
    async fn is_comment_only_change(&self, change: &RootChange) -> Result<bool, SimError> {
        self.enter(
            "comment_gate.check",
            json!({"before":change.before,"after":change.after}),
        )
        .await?;
        self.0
            .borrow_mut()
            .verdicts
            .pop_front()
            .unwrap_or(Ok(false))
    }
}
impl BackgroundEffects for SimPorts {
    fn publish(&self, publication: DocumentPublication) {
        if self.crashed() {
            return;
        }
        let value = match publication {
            DocumentPublication::Noop => json!({"noop":true}),
            DocumentPublication::Snapshot {
                document,
                snapshot,
                editors,
                interaction,
            } => {
                json!({"document":document.as_str(),"snapshot":snapshot,"editors":editors,"interaction":interaction})
            }
            DocumentPublication::Interaction { document, reason } => {
                json!({"document":document.as_str(),"interaction":reason})
            }
        };
        self.0.borrow_mut().effects.push(Effect {
            operation: "background.publish".into(),
            value,
        });
    }
    fn record_blame(&self, events: Vec<BlameEvent>) {
        if self.crashed() {
            return;
        }
        let mut s = self.0.borrow_mut();
        s.effects.push(Effect{operation:"background.blame".into(),value:json!(events.iter().map(|e|json!({"document":e.document_id,"node":e.node_id,"peer":e.peer_id.to_string(),"time":e.timestamp_ms})).collect::<Vec<_>>())});
        for event in events {
            s.data.blame.insert(
                (event.document_id, event.node_id),
                (event.peer_id, event.timestamp_ms),
            );
        }
        s.commit_directory();
    }
    fn extend_isolate_lifetime(&self, ttl: Duration) {
        if self.crashed() {
            return;
        }
        self.0.borrow_mut().effects.push(Effect {
            operation: "background.keep_alive".into(),
            value: json!(ttl.as_millis()),
        });
    }
}
impl RoomPorts for SimPorts {
    type Clock = Self;
    type Entropy = Self;
    type Connections = Self;
    type Storage = Self;
    type Snapshots = Self;
    type Alarm = Self;
    type Peers = Self;
    type CommentGate = Self;
    type Background = Self;
    fn clock(&self) -> &Self {
        self
    }
    fn entropy(&self) -> &Self {
        self
    }
    fn connections(&self) -> &Self {
        self
    }
    fn storage(&self) -> &Self {
        self
    }
    fn snapshots(&self) -> &Self {
        self
    }
    fn alarm(&self) -> &Self {
        self
    }
    fn peers(&self) -> &Self {
        self
    }
    fn comment_gate(&self) -> &Self {
        self
    }
    fn background(&self) -> &Self {
        self
    }
}
