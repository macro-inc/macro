//! Worker implementations of the room capability boundaries.
use crate::error::ResultExt;
use std::time::Duration;
use sync_server_core::domain::ports::{Clock, UnixMillis};

use std::cell::Cell;
use web_time::Instant;
thread_local! {
    static MONOTONIC_ORIGIN: Cell<Option<Instant>> = const { Cell::new(None) };
}

pub(crate) fn monotonic() -> Duration {
    let instant = Instant::now();
    #[cfg(feature = "transcript")]
    let instant = crate::transcript::instant("state_instant", instant);
    MONOTONIC_ORIGIN.with(|origin| {
        let first = origin.get().unwrap_or(instant);
        origin.set(Some(first));
        instant.duration_since(first)
    })
}

/// The existing worker clocks, read only when the core requests them.
pub struct WorkerClock;
impl Clock for WorkerClock {
    fn monotonic(&self) -> Duration {
        monotonic()
    }
    fn unix_time(&self) -> UnixMillis {
        let now = worker::Date::now().as_millis();
        #[cfg(feature = "transcript")]
        crate::transcript::clock("presence", now);
        UnixMillis(now as i64)
    }
    fn unix_time_for(&self, purpose: sync_server_core::domain::ports::WallClock) -> UnixMillis {
        let now = worker::Date::now().as_millis();
        #[cfg(feature = "transcript")]
        crate::transcript::clock(purpose.tag(), now);
        #[cfg(not(feature = "transcript"))]
        let _ = purpose;
        UnixMillis(now as i64)
    }
    fn unix_nanos(&self) -> u128 {
        let nanos = web_time::SystemTime::now()
            .duration_since(web_time::SystemTime::UNIX_EPOCH)
            .unwrap_context("Time since unix epoch was negative...?")
            .as_nanos();
        #[cfg(feature = "transcript")]
        crate::transcript::clock("op_id_nanos", nanos);
        nanos
    }
}

use crate::storage::{backends::durable_kv::DurableKVStorage, room_snapshot::WorkerSnapshots};
use std::{cell::RefCell, rc::Rc};
use sync_server_core::domain::{
    models::{BlameRow, PeerWithUserId},
    ports::{
        AlarmScheduler, BackgroundEffects, CloseReason, CommentGate, Connections,
        DocumentPublication, Entropy, PeerDirectory, RoomPorts,
    },
    socket::{SocketTagError, WebSocketId},
    state::RootChange,
    types::{BlameEvent, PeerId, SessionKey},
};
use worker::{Env, State, WebSocket, WebSocketPair};

/// UUID generation remains in the runtime adapter.
pub struct WorkerEntropy;
impl Entropy for WorkerEntropy {
    fn socket_uuid(&self) -> uuid::Uuid {
        uuid::Uuid::new_v4()
    }
}

/// Cloudflare's ordered socket set and hibernation tags.
pub struct WorkerConnections {
    state: Rc<State>,
    accepted_client: RefCell<Option<WebSocket>>,
}
impl WorkerConnections {
    pub fn take_accepted_client(&self) -> Option<WebSocket> {
        self.accepted_client.borrow_mut().take()
    }
}
impl Connections for WorkerConnections {
    type Socket = WebSocket;
    type Error = worker::Error;
    fn all(&self) -> Vec<WebSocket> {
        self.state.get_websockets()
    }
    fn socket_id(&self, socket: &WebSocket) -> Result<WebSocketId, SocketTagError> {
        WebSocketId::from_tags(&self.state.get_tags(socket))
    }
    fn accept(&self, id: &WebSocketId) -> worker::Result<WebSocket> {
        let pair = WebSocketPair::new()?;
        self.state
            .accept_websocket_with_tags(&pair.server, &[id.as_str()]);
        *self.accepted_client.borrow_mut() = Some(pair.client);
        Ok(pair.server)
    }
    fn send_binary(&self, socket: &WebSocket, frame: &[u8]) -> worker::Result<()> {
        socket.send_with_bytes(frame)
    }
    fn send_text(&self, socket: &WebSocket, text: &str) -> worker::Result<()> {
        socket.send_with_str(text)
    }
    fn close(&self, socket: &WebSocket, reason: CloseReason) -> worker::Result<()> {
        socket.close(Some(CloseReason::CODE), Some(reason.as_str()))
    }
}

/// Durable Object alarm operations with the original relative scheduling.
pub struct WorkerAlarm {
    state: Rc<State>,
}
impl AlarmScheduler for WorkerAlarm {
    type Error = worker::Error;
    async fn scheduled(&self) -> worker::Result<Option<UnixMillis>> {
        Ok(self.state.storage().get_alarm().await?.map(UnixMillis))
    }
    async fn schedule_in(&self, delay: Duration) -> worker::Result<()> {
        #[cfg(feature = "transcript")]
        let scheduled = {
            let now = worker::Date::now().as_millis();
            crate::transcript::clock("alarm_set_ms", now);
            worker::ScheduledTime::new(worker::js_sys::Date::new(
                &((now as f64 + delay.as_millis() as f64).into()),
            ))
        };
        #[cfg(not(feature = "transcript"))]
        let scheduled = worker::ScheduledTime::from(delay);
        self.state.storage().set_alarm(scheduled).await
    }
    async fn cancel(&self) -> worker::Result<()> {
        self.state.storage().delete_alarm().await
    }
}

/// D1 peer identity and last-edit attribution.
pub struct WorkerPeers {
    env: Env,
}
impl PeerDirectory for WorkerPeers {
    type Error = worker::Error;
    async fn claim_peer(
        &self,
        document: &SessionKey,
        user: &str,
        actor: Option<&str>,
        peer: PeerId,
    ) -> worker::Result<()> {
        crate::d1::insert_user_mapping(
            self.env.d1(crate::constants::USER_PEER_D1_BINDING)?,
            user,
            actor,
            peer.0,
            document.as_str(),
        )
        .await
    }
    async fn map_unowned_peers(
        &self,
        document: &SessionKey,
        user: &str,
        actor: Option<&str>,
        peers: &[PeerId],
    ) -> worker::Result<()> {
        let ids: Vec<_> = peers.iter().map(|peer| peer.0).collect();
        crate::d1::insert_missing_user_mappings(
            &self.env.d1(crate::constants::USER_PEER_D1_BINDING)?,
            document.as_str(),
            user,
            actor,
            &ids,
        )
        .await
    }
    async fn user_for_peer(
        &self,
        document: &SessionKey,
        peer: PeerId,
    ) -> worker::Result<Option<String>> {
        crate::d1::get_user_id_from_peer_id(
            self.env.d1(crate::constants::USER_PEER_D1_BINDING)?,
            document.as_str(),
            &peer.0,
        )
        .await
    }
    async fn peers(&self, document: &SessionKey) -> worker::Result<Vec<PeerWithUserId>> {
        crate::d1::get_peers_for_document_id(
            self.env.d1(crate::constants::USER_PEER_D1_BINDING)?,
            document.as_str(),
        )
        .await
    }
    async fn blame_for_node(
        &self,
        document: &SessionKey,
        node: &str,
    ) -> worker::Result<Option<BlameRow>> {
        crate::d1::get_blame_for_node(
            self.env.d1(crate::constants::USER_PEER_D1_BINDING)?,
            document.as_str(),
            node,
        )
        .await
    }
    async fn delete_document(&self, document: &SessionKey) -> worker::Result<()> {
        crate::d1::delete_document_rows(
            self.env.d1(crate::constants::USER_PEER_D1_BINDING)?,
            document.as_str(),
        )
        .await
    }
}

/// Comment-only execution selection loaded once for this room.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum CommentGateMode {
    Http,
    InProcess,
    Shadow,
}
/// Worker selection preserves the HTTP result in shadow and never falls back.
pub struct WorkerCommentGate {
    env: Env,
    mode: worker::Result<CommentGateMode>,
}
impl WorkerCommentGate {
    fn new(env: Env) -> Self {
        let mode = env.var("COMMENT_GATE_MODE").and_then(|value| {
            value
                .to_string()
                .parse()
                .map_err(|_| worker::Error::from("invalid COMMENT_GATE_MODE"))
        });
        Self { env, mode }
    }
}
impl CommentGate for WorkerCommentGate {
    type Error = worker::Error;
    #[tracing::instrument(name = "lexical.comment_only_change", skip_all, err, fields(
        route = "gate", mode = tracing::field::Empty,
        bytes_in = tracing::field::Empty, bytes_out = tracing::field::Empty,
        outcome = tracing::field::Empty, error.kind = tracing::field::Empty,
        ms = tracing::field::Empty
    ))]
    async fn is_comment_only_change(&self, change: &RootChange) -> worker::Result<bool> {
        let started = web_time::Instant::now();
        let span = tracing::Span::current();
        if let Ok(mode) = &self.mode {
            span.record("mode", mode.as_ref());
        }
        let input = serde_json::to_vec(&serde_json::json!({
            "before": {"root": change.before}, "after": {"root": change.after}
        }))
        .map_err(|_| worker::Error::from("cannot encode gate roots"));
        if let Ok(bytes) = &input {
            if let Ok(length) = i64::try_from(bytes.len()) {
                span.record("bytes_in", length);
            }
        }
        let result = match input {
            Ok(_) => self.check(change).await,
            Err(error) => Err(error),
        };
        span.record("ms", started.elapsed().as_millis() as i64);
        span.record("outcome", if result.is_ok() { "ok" } else { "error" });
        match &result {
            Ok(value) => {
                span.record("bytes_out", if *value { 4_i64 } else { 5_i64 });
            }
            Err(_) => {
                span.record(
                    "error.kind",
                    if self.mode.is_err() {
                        "configuration"
                    } else {
                        "backend"
                    },
                );
            }
        }
        result
    }
}
impl WorkerCommentGate {
    async fn check(&self, change: &RootChange) -> worker::Result<bool> {
        let mode = self
            .mode
            .as_ref()
            .map_err(|_| worker::Error::from("missing or invalid COMMENT_GATE_MODE"))?;
        tracing::Span::current().record("mode", mode.as_ref());
        let local = async {
            sync_server_core::comment_gate::InProcessCommentGate::new(
                macro_document_model::DocumentContext {
                    clock: macro_document_model::NodeClock(std::sync::Arc::new(|| {
                        worker::Date::now().as_millis()
                    })),
                    random: macro_document_model::NodeRandom(std::sync::Arc::new(|length| {
                        let mut bytes = vec![0; length];
                        if getrandom::fill(&mut bytes).is_err() {
                            bytes.clear();
                        }
                        bytes
                    })),
                    host: Default::default(),
                    keys: Default::default(),
                    editor_created: None,
                },
            )
            .is_comment_only_change(change)
            .await
            .map_err(|_| worker::Error::from("in-process comment gate rejected invalid state"))
        };
        let http = crate::lexical_service::LexicalServiceClient::new(&self.env);
        match mode {
            CommentGateMode::Http => http.is_comment_only_change(change).await,
            CommentGateMode::InProcess => local.await,
            CommentGateMode::Shadow => {
                use tracing::Instrument;
                async {
                    let (http, local) = futures::join!(http.is_comment_only_change(change), local);
                    let equal = matches!((&http, &local), (Ok(left), Ok(right)) if left == right);
                    tracing::Span::current().record("equal", equal);
                    tracing::Span::current()
                        .record("outcome", if equal { "equal" } else { "mismatch" });
                    if local.is_err() {
                        tracing::Span::current().record("error.kind", "backend");
                    }
                    if !equal {
                        tracing::warn!(route = "gate", "lexical shadow mismatch");
                    }
                    http
                }
                .instrument(tracing::info_span!(
                    "lexical.shadow",
                    route = "gate",
                    equal = tracing::field::Empty,
                    outcome = tracing::field::Empty,
                    error.kind = tracing::field::Empty
                ))
                .await
            }
        }
    }
}

/// Detached work stays attached to the originating runtime callback.
pub struct WorkerBackground {
    state: Rc<State>,
    env: Env,
}
impl BackgroundEffects for WorkerBackground {
    fn publish(&self, publication: DocumentPublication) {
        let env = self.env.clone();
        self.state.wait_until(crate::background(async move {
            match publication {
                DocumentPublication::Noop => {}
                DocumentPublication::Snapshot {
                    document,
                    snapshot,
                    editors,
                    interaction,
                } => {
                    super::document_publication::report_new_doc_state(
                        document.as_str(),
                        &snapshot,
                        &env,
                        editors,
                    )
                    .await;
                    if let Some(reason) = interaction {
                        super::document_publication::report_interaction(
                            document.as_str(),
                            &env,
                            reason,
                        )
                        .await;
                    }
                }
                DocumentPublication::Interaction { document, reason } => {
                    super::document_publication::report_interaction(
                        document.as_str(),
                        &env,
                        reason,
                    )
                    .await;
                }
            }
        }));
    }
    fn record_blame(&self, events: Vec<BlameEvent>) {
        if events.is_empty() {
            return;
        }
        let env = self.env.clone();
        self.state.wait_until(crate::background(async move {
            if let Err(error) = crate::d1::insert_blame_many(&env, &events).await {
                tracing::warn!(error = ?error, "failed to flush pending blame");
            }
        }));
    }
    fn extend_isolate_lifetime(&self, ttl: Duration) {
        crate::keepalive::keepalive(ttl);
    }
}

/// Concrete worker capabilities; no IO is performed by construction.
pub struct WorkerPorts {
    clock: WorkerClock,
    entropy: WorkerEntropy,
    connections: WorkerConnections,
    storage: DurableKVStorage,
    snapshots: WorkerSnapshots,
    alarm: WorkerAlarm,
    peers: WorkerPeers,
    comment_gate: WorkerCommentGate,
    background: WorkerBackground,
}
impl WorkerPorts {
    pub fn new(state: Rc<State>, env: Env) -> Self {
        Self {
            clock: WorkerClock,
            entropy: WorkerEntropy,
            connections: WorkerConnections {
                state: state.clone(),
                accepted_client: RefCell::new(None),
            },
            storage: DurableKVStorage::new(state.storage()),
            snapshots: WorkerSnapshots::new(env.clone(), state.clone()),
            alarm: WorkerAlarm {
                state: state.clone(),
            },
            peers: WorkerPeers { env: env.clone() },
            comment_gate: WorkerCommentGate::new(env.clone()),
            background: WorkerBackground { state, env },
        }
    }
}
impl RoomPorts for WorkerPorts {
    type Clock = WorkerClock;
    type Entropy = WorkerEntropy;
    type Connections = WorkerConnections;
    type Storage = DurableKVStorage;
    type Snapshots = WorkerSnapshots;
    type Alarm = WorkerAlarm;
    type Peers = WorkerPeers;
    type CommentGate = WorkerCommentGate;
    type Background = WorkerBackground;
    fn clock(&self) -> &WorkerClock {
        &self.clock
    }
    fn entropy(&self) -> &WorkerEntropy {
        &self.entropy
    }
    fn connections(&self) -> &WorkerConnections {
        &self.connections
    }
    fn storage(&self) -> &DurableKVStorage {
        &self.storage
    }
    fn snapshots(&self) -> &WorkerSnapshots {
        &self.snapshots
    }
    fn alarm(&self) -> &WorkerAlarm {
        &self.alarm
    }
    fn peers(&self) -> &WorkerPeers {
        &self.peers
    }
    fn comment_gate(&self) -> &WorkerCommentGate {
        &self.comment_gate
    }
    fn background(&self) -> &WorkerBackground {
        &self.background
    }
}
