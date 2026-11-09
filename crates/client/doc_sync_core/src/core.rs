//! Sans-I/O document synchronization and durable delivery policy.

use crate::connection::{ConnectionMachine, ConnectionSettings, ConnectionTarget};
use crate::*;
use bebop::{Record, SliceWrapper};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

mod assistance;
mod delivery;
mod imports;
mod lifecycle;
mod persistence;
mod presence;
mod requests;

/// Lifecycle of the document and its surface.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Start has not been requested.
    Created,
    /// Racing seeds, or waiting for the surface's `Ready` acknowledgement.
    Loading,
    /// Surface initialized and accepting imports and edits.
    Running,
    /// Preserving old edits and fetching a fresh server base.
    Resetting,
    /// Terminal; persistence completes and late Stop requests join its barrier.
    Stopped,
}

/// The first condition preventing quiescence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BusyReason {
    /// Dependencies are missing from the document.
    PendingImport,
    /// At least one unparked row has not been delivered.
    Undelivered,
    /// Persistence, a push, or a correlated request is outstanding.
    InFlight,
    /// No synchronized transport is available.
    NotConnected,
    /// A shallow-history rebase is due or active.
    Rebasing,
    /// Surface initialization has not completed.
    NotReady,
}

struct PendingStorage {
    op: StorageOp,
    deadline: Millis,
    completion: StorageCompletion,
}
enum StorageCompletion {
    Load,
    Orphans,
    Append {
        seq: WalSeq,
    },
    Adopt {
        first: WalSeq,
        records: Vec<StoredWalRecord>,
    },
    Snapshot {
        covers: Option<(SessionId, WalSeq)>,
        vv: loro::VersionVector,
    },
    Mark {
        through: WalSeq,
    },
    Prune {
        through: WalSeq,
    },
    Other,
}
struct Push {
    id: UpdateId,
    rows: Vec<WalSeq>,
    deadline: Millis,
}
struct AssistPush {
    id: UpdateId,
    count: usize,
    deadline: Millis,
}
struct Convergence {
    attempt: u8,
    deadline: Millis,
    rerun: bool,
}
struct SinceRequest {
    vv: Vec<u8>,
    expired: bool,
    recovery_deadline: Option<Millis>,
}
#[derive(Clone, Copy)]
enum SnapshotPurpose {
    Host(RequestId),
    Reset,
    Probe,
}
struct SnapshotRequest {
    purpose: SnapshotPurpose,
    deadline: Millis,
    expired: bool,
}
struct CommentRequest {
    id: UpdateId,
    request: RequestId,
    bytes: Vec<u8>,
    deadline: Millis,
}
enum ResetState {
    Flushing { deadline: Millis, rebase: bool },
    Awaiting { rebase: bool },
    AwaitingHistory { rebase: bool },
    WaitingPeer { rebase: bool, snapshot: Vec<u8> },
}

/// One document's deterministic synchronization state. Hosts supply time and execute effects.
pub struct SyncCore {
    config: SyncConfig,
    now: Now,
    rows_after_gap: BTreeSet<WalSeq>,
    reassembler: sync_protocol::framing::Reassembler,
    server_vv: loro::VersionVector,
    foreign_writer_closed: bool,
    route_denied: bool,
    has_converged: bool,
    phase: Phase,
    connection: ConnectionMachine,
    wal: Wal,
    delivered: BTreeSet<WalSeq>,
    storage: BTreeMap<StorageOpId, PendingStorage>,
    supersedes: BTreeMap<WalSeq, Vec<WalSeq>>,
    foreign_versions: BTreeMap<WalSeq, loro::VersionVector>,
    push: Option<Push>,
    push_retry: Option<Millis>,
    assist: Vec<StoredWalRecord>,
    assist_replay: Vec<Vec<u8>>,
    assist_push: Option<AssistPush>,
    assist_retry: Option<Millis>,
    convergence: Option<Convergence>,
    convergence_retry: Option<(u8, Millis)>,
    since: VecDeque<SinceRequest>,
    staged_comments: Vec<(RequestId, Millis)>,
    snapshots: VecDeque<SnapshotRequest>,
    comments: Vec<CommentRequest>,
    confirmed_base: loro::Frontiers,
    peers: PeerSupply,
    registered_peers: Vec<loro::PeerID>,
    auth: AuthorizationState,
    effective_access: Access,
    next_storage: u32,
    next_update: u64,
    next_span: u64,
    load_span: Option<SpanKey>,
    connect_span: Option<SpanKey>,
    catchup_span: Option<SpanKey>,
    outage_span: Option<SpanKey>,
    reset_span: Option<SpanKey>,
    snapshot_due: Option<Millis>,
    snapshot_dirty_since: Option<Millis>,
    snapshot_vv: loro::VersionVector,
    last_local: Option<Millis>,
    last_orphan_load: Option<Millis>,
    seen_foreign: bool,
    local_loading: bool,
    load_retry: Option<Millis>,
    seeded: bool,
    deferred_seed: Option<Vec<u8>>,
    seed_wait_deadline: Option<Millis>,
    reset_requested: bool,
    reset: Option<ResetState>,
    reset_times: VecDeque<Millis>,
    rebase_due: Option<Millis>,
    rebase_active: bool,
    rebase_rerun: bool,
    last_rebase: Option<Millis>,
    flushes: Vec<(RequestId, Millis)>,
    stop_requests: Vec<RequestId>,
    stop_barrier: BTreeSet<StorageOpId>,
    pending_import: bool,
    not_acked: u16,
    suspect_delay: Millis,
    last_probe: Option<Millis>,
    waiting_for_fresh_ack: bool,
    status: SyncStatus,
    presence: Option<Box<dyn PresenceBackend>>,
    local_presence: Option<loro::LoroValue>,
    presence_dirty: bool,
    presence_due: Option<Millis>,
    presence_refresh: Option<Millis>,
    presence_key: Option<String>,
}

impl SyncCore {
    /// Construct a core without performing I/O. Supply unused peers before a reset.
    pub fn new(config: SyncConfig, now: Now) -> Result<Self, SyncError> {
        Self::with_peer_supply(config, now, PeerSupply::new(PeerRange::User))
    }

    /// Construct a core with a host-populated peer supply, including AI-range sessions.
    pub fn with_peer_supply(
        config: SyncConfig,
        now: Now,
        peers: PeerSupply,
    ) -> Result<Self, SyncError> {
        if config.chatter && config.persistence == Persistence::Memory {
            return Err(SyncError::ChatterWithoutStorage);
        }
        let initial_access = match config.access {
            Access::Edit => WriteAccess::Full,
            Access::CommentOnly => WriteAccess::CommentMarks,
            Access::Read => WriteAccess::None,
        };
        let connection = ConnectionMachine::new(ConnectionSettings {
            target: ConnectionTarget::Document(config.doc.clone()),
            timeouts: config.timeouts,
            heartbeat: config.heartbeat,
            backoff: config.backoff,
            initial_token: config.initial_token.clone(),
            initial_access,
            traceparent: config.traceparent.clone(),
        });
        let effective_access = config.access;
        let presence = ProtocolPresence::new(config.presence.timeout);
        Ok(Self {
            now,
            rows_after_gap: BTreeSet::new(),
            reassembler: sync_protocol::framing::Reassembler::default(),
            server_vv: loro::VersionVector::default(),
            foreign_writer_closed: false,
            route_denied: false,
            has_converged: false,
            config,
            phase: Phase::Created,
            connection,
            wal: Wal {
                entries: VecDeque::new(),
                delivered_through: None,
                next_seq: WalSeq(1),
                logged_vv: loro::VersionVector::default(),
                append_due: None,
                health: StorageHealth::Ok,
            },
            delivered: BTreeSet::new(),
            storage: BTreeMap::new(),
            supersedes: BTreeMap::new(),
            foreign_versions: BTreeMap::new(),
            push: None,
            push_retry: None,
            assist: Vec::new(),
            assist_replay: Vec::new(),
            assist_push: None,
            assist_retry: None,
            convergence: None,
            convergence_retry: None,
            since: VecDeque::new(),
            staged_comments: Vec::new(),
            snapshots: VecDeque::new(),
            comments: Vec::new(),
            confirmed_base: loro::Frontiers::default(),
            peers,
            registered_peers: Vec::new(),
            auth: AuthorizationState {
                current: true,
                can_write: effective_access == Access::Edit,
                can_comment: effective_access != Access::Read,
            },
            effective_access,
            next_storage: 0,
            next_update: 0,
            next_span: 0,
            load_span: None,
            connect_span: None,
            catchup_span: None,
            outage_span: None,
            reset_span: None,
            snapshot_due: None,
            snapshot_dirty_since: None,
            snapshot_vv: loro::VersionVector::default(),
            last_local: None,
            last_orphan_load: None,
            seen_foreign: false,
            local_loading: false,
            load_retry: None,
            seeded: false,
            deferred_seed: None,
            seed_wait_deadline: None,
            reset_requested: false,
            reset: None,
            reset_times: VecDeque::new(),
            rebase_due: None,
            rebase_active: false,
            rebase_rerun: false,
            last_rebase: None,
            flushes: Vec::new(),
            stop_requests: Vec::new(),
            stop_barrier: BTreeSet::new(),
            pending_import: false,
            not_acked: 0,
            suspect_delay: Millis(5_000),
            last_probe: None,
            waiting_for_fresh_ack: false,
            status: SyncStatus {
                connection: ConnectionStatus::Disconnected,
                save: SaveState::Saved,
                pending_import: false,
            },
            presence: Some(Box::new(presence)),
            local_presence: None,
            presence_dirty: false,
            presence_due: None,
            presence_refresh: None,
            presence_key: None,
        })
    }

    /// Add unused host-generated peers atomically. Previously used peers are never recycled.
    pub fn add_peer_ids(&mut self, peers: impl IntoIterator<Item = u64>) -> Result<(), SyncError> {
        self.peers.extend(peers)
    }

    /// Allocate the staged comment fork's peer, reserve it permanently, and register it.
    /// The session sets this id immediately after forking and before applying comment edits.
    pub fn allocate_comment_peer(
        &mut self,
        out: &mut SyncOutput,
    ) -> Result<loro::PeerID, SyncError> {
        let peer = self.peers.take()?;
        self.registered_peers.push(peer);
        self.event(
            "peer.assigned",
            vec![
                ("peer", AttrValue::U64(peer)),
                ("purpose", AttrValue::String("comment_fork".into())),
            ],
            out,
        );
        self.send(
            sync_protocol::FromPeer::PeerRegisterId { peerid: peer },
            out,
        );
        Ok(peer)
    }

    /// Install the clock-injected presence port. WP-42 supplies its production adapter.
    pub fn set_presence_backend(&mut self, backend: Box<dyn PresenceBackend>) {
        self.presence = Some(backend);
    }

    /// Current surface lifecycle.
    pub fn phase(&self) -> Phase {
        self.phase
    }
    /// Current physical connection state.
    pub fn connection(&self) -> &Connection {
        &self.connection.state
    }
    /// Current derived user-visible status.
    pub fn status(&self) -> &SyncStatus {
        &self.status
    }
    /// Read-only WAL diagnostics; no host may mutate the core's durability bookkeeping.
    pub fn wal(&self) -> &Wal {
        &self.wal
    }
    /// Current own-WAL push identity and exact ordered row range, if one is outstanding.
    /// Assist pushes are independent and retain their original durable owners.
    pub fn push_in_flight(&self) -> Option<(&UpdateId, &[WalSeq])> {
        self.push
            .as_ref()
            .map(|push| (&push.id, push.rows.as_slice()))
    }
    /// Whether the host should provide additional unused peer ids.
    pub fn needs_peer_ids(&self) -> bool {
        self.peers.needs_refill()
    }
    /// Whether there is no unparked work or outstanding operation.
    pub fn is_idle(&self) -> bool {
        self.busy().is_none()
    }
    /// Explain why the session is not quiescent. Parked rows remain visible via `parked`.
    pub fn busy(&self) -> Option<BusyReason> {
        if self.phase == Phase::Stopped {
            return Some(BusyReason::NotConnected);
        }
        if self.phase != Phase::Running {
            return Some(BusyReason::NotReady);
        }
        if self.rebase_due.is_some() || self.rebase_active {
            return Some(BusyReason::Rebasing);
        }
        if self.pending_import || !self.assist_replay.is_empty() {
            return Some(BusyReason::PendingImport);
        }
        if self.push.is_some()
            || self.assist_push.is_some()
            || !self.storage.is_empty()
            || self.convergence.is_some()
            || self.convergence_retry.is_some()
            || self.load_retry.is_some()
            || self.snapshots.iter().any(|r| !r.expired)
            || !self.comments.is_empty()
            || self.wal.append_due.is_some()
        {
            return Some(BusyReason::InFlight);
        }
        if self
            .wal
            .entries
            .iter()
            .any(|e| !self.is_delivered(e.seq) && !e.superseded && self.park_reason(e).is_none())
            || (!self.assist.is_empty() && self.effective_access == Access::Edit)
        {
            return Some(BusyReason::Undelivered);
        }
        if self.config.transport != TransportKind::None && !self.connection.synced() {
            return Some(BusyReason::NotConnected);
        }
        None
    }
    /// Retained rows which cannot currently be pushed.
    pub fn parked(&self) -> Vec<(WalSeq, ParkReason)> {
        self.wal
            .entries
            .iter()
            .filter(|e| !self.is_delivered(e.seq) && !e.superseded)
            .filter_map(|e| self.park_reason(e).map(|reason| (e.seq, reason)))
            .collect()
    }

    /// Process one host input. The output buffers are cleared, then filled in effect order.
    pub fn handle(
        &mut self,
        now: Now,
        doc: &mut impl SyncDoc,
        input: SyncInput,
        out: &mut SyncOutput,
    ) {
        self.now = now;
        out.io.clear();
        out.events.clear();
        out.wake_at = None;
        if self.phase == Phase::Stopped {
            match input {
                SyncInput::Stop(request) => {
                    if !self.stop_requests.contains(&request) {
                        self.stop_requests.push(request);
                    }
                }
                SyncInput::Storage(event) => self.storage_event(event, now, doc, out),
                SyncInput::Tick => self.expire_storage(now, doc, out),
                _ => {}
            }
            self.finish_stop(out);
            self.update_status(out);
            out.wake_at = self.wake_at();
            return;
        }
        match input {
            SyncInput::Start => self.start(now, doc, out),
            SyncInput::Ready => {
                if self.phase == Phase::Loading && self.seeded {
                    self.phase = Phase::Running;
                    if self.reset_requested {
                        self.begin_reset(now, doc, false, false, out);
                    } else if self.connection.synced() {
                        self.request_since(1, now, doc, out);
                    }
                }
            }
            SyncInput::Stop(request) => {
                self.stop(now, doc, Some(request), CloseReason::Stopped, out)
            }
            SyncInput::Seed { kind, snapshot } => self.seed(kind, snapshot, now, doc, out),
            SyncInput::LocalChanged => {
                if matches!(self.phase, Phase::Running | Phase::Resetting)
                    && self.effective_access == Access::Edit
                {
                    self.last_local = Some(now.mono);
                    self.snapshot_dirty_since.get_or_insert(now.mono);
                    self.wal
                        .append_due
                        .get_or_insert(now.mono.after(self.config.wal.coalesce));
                    if self.phase == Phase::Resetting {
                        self.append_local(now, doc, out);
                    }
                    if matches!(self.connection.state, Connection::GaveUp { .. }) {
                        self.start_connection(now, out);
                    }
                }
            }
            SyncInput::SetPresence(selection) => self.set_presence(selection, now),
            SyncInput::Flush(request) => {
                self.append_local(now, doc, out);
                self.flushes.push((
                    request,
                    now.mono.after(Millis(
                        self.config
                            .timeouts
                            .storage
                            .0
                            .saturating_add(self.config.timeouts.ack.0),
                    )),
                ));
                if matches!(self.connection.state, Connection::GaveUp { .. }) {
                    self.start_connection(now, out);
                }
                self.push_retry = None;
            }
            SyncInput::PrepareComment(request) => {
                self.prepare_comment(request, now, doc, out);
            }
            SyncInput::PublishComment { request, update } => {
                self.publish_comment(request, update, now, doc, out)
            }
            SyncInput::RequestSnapshot(request) => {
                self.request_snapshot(SnapshotPurpose::Host(request), now, out)
            }
            SyncInput::Reset => {
                if self.phase == Phase::Loading || self.phase == Phase::Created {
                    self.reset_requested = true;
                } else {
                    self.begin_reset(now, doc, false, false, out);
                }
            }
            SyncInput::ImportFailed(error) => self.import_failure(error, now, doc, out),
            SyncInput::ProjectionResynced => {
                self.charge_recovery(now, doc, out);
            }
            SyncInput::Storage(event) => self.storage_event(event, now, doc, out),
            SyncInput::Token(event) => {
                self.connection.token(event, now, &mut out.io);
            }
            SyncInput::Socket { conn, event } => self.socket(conn, event, now, doc, out),
            SyncInput::Route(event) => self.route(event, now, doc, out),
            SyncInput::Chatter(message) => self.chatter(message, now, doc, out),
            SyncInput::Host(signal) => match signal {
                HostSignal::Hidden | HostSignal::PageHide => {
                    self.append_local(now, doc, out);
                    self.flush_presence(now, doc, out);
                }
                HostSignal::Online | HostSignal::Visible => {
                    if matches!(
                        self.connection.state,
                        Connection::Backoff { .. } | Connection::GaveUp { .. } | Connection::Idle
                    ) {
                        self.start_connection(now, out);
                    }
                    if signal == HostSignal::Visible {
                        self.load_orphans(now, out);
                    }
                }
            },
            SyncInput::Authorization(auth) => self.authorize(auth, now, doc, out),
            SyncInput::Tick => self.tick(now, doc, out),
        }
        if self.phase != Phase::Stopped {
            self.drive(now, doc, out);
        }
        self.finish_stop(out);
        self.update_status(out);
        out.wake_at = self.wake_at();
    }

    fn start(&mut self, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        if self.phase != Phase::Created {
            return;
        }
        if let Err(error) = self.peers.register(doc.peer_id()) {
            self.event(
                "peer.rejected",
                vec![("reason", AttrValue::String(error.to_string()))],
                out,
            );
            self.stop(now, doc, None, CloseReason::Corrupt, out);
            return;
        }
        self.registered_peers.push(doc.peer_id());
        self.event(
            "peer.assigned",
            vec![
                ("peer", AttrValue::U64(doc.peer_id())),
                ("purpose", AttrValue::String("initial".into())),
            ],
            out,
        );
        self.phase = Phase::Loading;
        self.load_span = Some(self.span("doc.load", None, out));
        self.wal.logged_vv = doc.oplog_vv();
        self.presence_key = Some(self.local_presence_key(doc.peer_id()));
        self.snapshot_due = self.config.snapshot_interval.map(|i| now.mono.after(i));
        if self.config.persistence == Persistence::Durable {
            self.local_loading = true;
            self.issue(
                StorageOp::Load {
                    doc: self.config.doc.clone(),
                    owner: self.config.session,
                    user: self.config.user.clone(),
                },
                StorageCompletion::Load,
                now,
                out,
            );
        }
        if self.config.transport == TransportKind::Direct {
            self.start_connection(now, out);
        }
    }

    fn start_connection(&mut self, now: Now, out: &mut SyncOutput) {
        if self.config.transport != TransportKind::Direct {
            return;
        }
        if let Some(span) = self.connect_span.take() {
            self.end_span(span, "superseded", false, out);
        }
        self.connect_span = Some(self.span("doc.sync.connect", self.load_span, out));
        self.connection.start(now, false, &mut out.io);
    }

    fn message_id(&mut self) -> UpdateId {
        self.next_update = self.next_update.saturating_add(1);
        UpdateId::new(self.config.session, self.next_update)
    }
    fn send(&mut self, message: sync_protocol::FromPeer<'_>, out: &mut SyncOutput) {
        let Some(conn) = self.connection.conn().filter(|_| self.connection.opened()) else {
            return;
        };
        let mut bytes = Vec::new();
        match message.serialize(&mut bytes) {
            Ok(_) => {
                for frame in sync_protocol::framing::into_frames(
                    &bytes,
                    sync_protocol::framing::MAX_CHUNK_SIZE,
                ) {
                    out.io.push(IoEffect::SocketSend { conn, frame });
                }
            }
            Err(error) => self.event(
                "ws.message.error",
                vec![("stage", AttrValue::String(format!("encode: {error}")))],
                out,
            ),
        }
    }
    fn span(
        &mut self,
        name: &'static str,
        parent: Option<SpanKey>,
        out: &mut SyncOutput,
    ) -> SpanKey {
        self.next_span = self.next_span.saturating_add(1);
        let span = SpanKey(self.next_span);
        let mut attrs = vec![("doc", AttrValue::String(self.config.doc.to_string()))];
        if let Some(parent) = parent {
            attrs.push(("parent_span", AttrValue::U64(parent.0)));
        }
        out.io.push(IoEffect::Telemetry(TelemetryRecord {
            span,
            kind: TelemetryKind::Start { name },
            attrs,
        }));
        span
    }
    fn end_span(&self, span: SpanKey, outcome: &'static str, error: bool, out: &mut SyncOutput) {
        out.io.push(IoEffect::Telemetry(TelemetryRecord {
            span,
            kind: TelemetryKind::End { outcome, error },
            attrs: Vec::new(),
        }));
    }
    fn event(
        &mut self,
        name: &'static str,
        attrs: Vec<(&'static str, AttrValue)>,
        out: &mut SyncOutput,
    ) {
        out.io.push(IoEffect::Telemetry(TelemetryRecord {
            span: self.connect_span.or(self.load_span).unwrap_or(SpanKey(0)),
            kind: TelemetryKind::Event { name },
            attrs,
        }));
    }
}

#[cfg(test)]
mod test;
