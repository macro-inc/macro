//! Script inputs, immutable observations and deterministic configuration.
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

/// Virtual milliseconds from the world's origin.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Millis(pub u64);
/// A script-owned client name; independent of session identity across reopens.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct ClientName(pub String);
/// A browser/device storage and chatter namespace.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct ProfileName(pub String);
/// A document within the world.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct DocIx(pub u8);
/// Canonical ordered representation of a Loro version vector.
pub type Vv = BTreeMap<u64, i32>;
/// One contiguous range of Loro operations.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct IdSpan {
    /// Creating peer.
    pub peer: u64,
    /// Inclusive counter.
    pub start: i32,
    /// Exclusive counter.
    pub end: i32,
}
/// Explicit invariant failure; never a panic for a synchronization failure.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{invariant} at {at:?}: {detail}")]
pub struct Failure {
    /// Check that failed.
    pub invariant: String,
    /// Virtual occurrence time, if known.
    pub at: Option<Millis>,
    /// Reproduction evidence.
    pub detail: String,
}
impl Failure {
    pub(crate) fn new(check: &str, detail: impl ToString) -> Self {
        Self {
            invariant: check.into(),
            at: None,
            detail: detail.to_string(),
        }
    }
}
/// A tab or the production AI-worker lifecycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum ClientKind {
    /// Durable browser tab.
    Tab,
    /// Direct, memory-only AI peer with fixed-key presence.
    AiWorker,
}
/// Authority issued by the simulated token front door.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Access {
    /// Ordinary edits.
    Edit,
    /// Comment-only capability; form mutations are skipped.
    CommentOnly,
    /// Receives changes only.
    Read,
}
impl Access {
    pub(crate) fn core(self) -> doc_sync_core::Access {
        match self {
            Self::Edit => doc_sync_core::Access::Edit,
            Self::CommentOnly => doc_sync_core::Access::CommentOnly,
            Self::Read => doc_sync_core::Access::Read,
        }
    }
}
/// Literal open configuration for the GenericSurface client.
#[derive(Clone, Debug)]
pub struct OpenSpec {
    /// Reusable name within the script.
    pub client: ClientName,
    /// Shared durable browser storage.
    pub profile: ProfileName,
    /// Document route.
    pub doc: DocIx,
    /// Initial grant.
    pub access: Access,
    /// Tab or AI lifecycle.
    pub kind: ClientKind,
}
impl OpenSpec {
    /// Open a writable GenericSurface tab on document zero.
    pub fn form(client: &str, profile: &str) -> Self {
        Self {
            client: ClientName(client.into()),
            profile: ProfileName(profile.into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }
    }
}
/// Shrinkable GenericSurface operations. Indices resolve modulo current content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum AbstractOp {
    /// Write a field in the shared form map.
    FormSet {
        /// Field index.
        field: u16,
        /// New integer value.
        value: u16,
    },
    /// Move one element in the form's ordered field list.
    FormMove {
        /// Source index.
        from: u16,
        /// Destination index.
        to: u16,
    },
    /// Advertise a GenericSurface field selection; None clears it.
    Select(Option<u16>),
}
/// Same-time event ordering.
#[derive(Clone, Copy, Debug)]
pub enum TieMode {
    /// Issue order.
    Fifo,
    /// Seeded equal-time perturbation.
    Perturb,
}
/// Network latency and break probabilities; FIFO is always preserved per direction.
#[derive(Clone, Debug)]
pub struct NetProfile {
    /// Inclusive one-way latency range.
    pub latency: (Millis, Millis),
    /// Inclusive handshake latency range.
    pub connect_latency: (Millis, Millis),
    /// Probability of an abrupt socket break per frame.
    pub break_per_frame: f64,
    /// Adversarial message scheduling; each link direction still preserves FIFO.
    pub hostile: Option<Hostile>,
}
impl NetProfile {
    /// Reliable, low-latency network.
    pub fn calm() -> Self {
        Self {
            latency: (Millis(5), Millis(20)),
            connect_latency: (Millis(10), Millis(30)),
            break_per_frame: 0.0,
            hostile: None,
        }
    }
}
/// Adversarial whole-message faults; these runs assert the S8 safety subset.
#[derive(Clone, Debug, Default)]
pub struct Hostile {
    /// Chance of adding a whole-message delay, changing only inter-connection order.
    pub reorder: f64,
    /// Chance of duplicating a complete idempotent message.
    pub duplicate: f64,
    /// Chance of dropping one chunk of a fragmented logical message.
    pub drop_frame: f64,
}
/// Browser write completion latency.
#[derive(Clone, Debug)]
pub struct StorageProfile {
    /// Inclusive latency range.
    pub latency: (Millis, Millis),
}
impl StorageProfile {
    /// Fast but asynchronous durable writes.
    pub fn fast() -> Self {
        Self {
            latency: (Millis(1), Millis(5)),
        }
    }
}
/// Bounded execution prevents failed convergence from hanging a shrinker.
#[derive(Clone, Debug)]
pub struct Budgets {
    /// Healing/liveness budget.
    pub settle: Millis,
    /// Additional stability observation window.
    pub quiet: Millis,
    /// Maximum processed events in a run.
    pub max_events: u64,
}
impl Default for Budgets {
    fn default() -> Self {
        Self {
            settle: Millis(180_000),
            quiet: Millis(60_000),
            max_events: 2_000_000,
        }
    }
}
/// Initial GenericSurface field history; cached snapshots are ancestors of the server state.
#[derive(Clone, Debug, Default)]
pub enum SeedDocument {
    /// Empty fields and the configured ordered field list.
    #[default]
    Empty,
    /// Field writes applied before clients open.
    Form(Vec<(u16, u16)>),
    /// Old local and S3 snapshots racing current server state, all from one real history.
    Cached {
        /// Field writes producing the authoritative server version.
        server: Vec<(u16, u16)>,
        /// Earlier cache writes and its injected host delivery delay.
        s3: Option<(Vec<(u16, u16)>, Millis)>,
        /// Earliest profile-local snapshot writes; load uses storage latency.
        local: Option<Vec<(u16, u16)>>,
    },
}
/// Deterministic whole-world configuration.
#[derive(Clone, Debug)]
pub struct SimConfig {
    /// The only source of random choices.
    pub seed: u64,
    /// Form field count in each document (at least one).
    pub fields: u16,
    /// Number of independent documents (at least one).
    pub documents: u8,
    /// Rooms using isolated collaborative-surface identity and lifecycle.
    pub surfaces: BTreeSet<DocIx>,
    /// Share one real RouterCore socket per profile for tab sessions (requires two documents).
    pub routed: bool,
    /// Per-document seed histories; omitted documents start empty.
    pub seeds: BTreeMap<DocIx, SeedDocument>,
    /// Network conditions.
    pub net: NetProfile,
    /// Storage conditions.
    pub storage: StorageProfile,
    /// Run bounds.
    pub budgets: Budgets,
    /// Same-time scheduling.
    pub ties: TieMode,
    /// Server storage completion latency.
    pub server_storage_latency: Millis,
    /// Run all applicable per-step checks.
    pub per_step: bool,
}
impl SimConfig {
    /// One empty eight-field form, production core policies and calm adapters.
    pub fn calm(seed: u64) -> Self {
        Self {
            seed,
            fields: 8,
            documents: 1,
            seeds: BTreeMap::new(),
            surfaces: BTreeSet::new(),
            routed: false,
            net: NetProfile::calm(),
            storage: StorageProfile::fast(),
            budgets: Budgets::default(),
            ties: TieMode::Fifo,
            server_storage_latency: Millis(2),
            per_step: true,
        }
    }
}
/// One direction on a physical connection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum Direction {
    /// Client to server.
    ToServer,
    /// Server to client.
    ToClient,
}
/// Whole protocol message category.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum FrameKind {
    /// Peer registration.
    RegisterId,
    /// Ordinary update.
    Update,
    /// Comment write.
    CommentUpdate,
    /// Presence.
    Awareness,
    /// Incremental request.
    RequestSince,
    /// Snapshot request.
    RequestSnapshot,
    /// Initial seed.
    InitialSync,
    /// Broadcast update.
    RemoteUpdate,
    /// Durable acknowledgment.
    Ack,
    /// Catchup response.
    UpdateSince,
    /// Snapshot response.
    Snapshot,
    /// Heartbeat request.
    Ping,
    /// Heartbeat response.
    Pong,
    /// Unrecognized payload.
    Unknown,
}
/// Network faults are applied to actual frames.
#[derive(Clone, Debug)]
pub enum NetStep {
    /// Black-hole traffic and connects, leaving sockets open.
    Partition(ClientName),
    /// Restore one client's traffic.
    Heal(ClientName),
    /// Close the current socket abruptly.
    Break(ClientName),
    /// Drop acknowledgments after durability.
    LoseAcks {
        /// Target client.
        client: ClientName,
        /// Number of acks.
        count: u8,
    },
    /// Drop a bounded number of matching frames.
    DropNext {
        /// Target client.
        client: ClientName,
        /// Direction.
        direction: Direction,
        /// Optional category filter.
        kind: Option<FrameKind>,
        /// Number of frames.
        frames: u8,
    },
    /// Replace the next Loro payload with corrupt bytes.
    CorruptNext {
        /// Target client.
        client: ClientName,
        /// Direction.
        direction: Direction,
    },
    /// Replace latency/break/duplication probabilities.
    Profile(NetProfile),
}
/// Browser storage failures.
#[derive(Clone, Debug)]
pub enum StorageFault {
    /// Refuse future writes.
    FailWrites,
    /// Restore normal operation.
    Heal,
    /// Change completion delay.
    Latency(Millis, Millis),
    /// Refuse after a cumulative byte budget.
    Quota {
        /// Byte allowance.
        after_bytes: u64,
    },
    /// Fail one read.
    FailLoad,
    /// Damage a saved snapshot.
    CorruptSnapshot,
    /// Damage one WAL row.
    CorruptRow,
    /// Commit appends but report uncertain outcomes.
    Uncertain {
        /// Number of appends.
        next: u8,
    },
}
/// Browser crash scope.
#[derive(Clone, Debug)]
pub enum CrashMode {
    /// Lose only unfinished writes.
    ProcessDeath,
    /// Also roll back recently completed writes.
    PowerLoss {
        /// Durability window.
        window: Millis,
    },
}
/// Deterministic server faults and real room use cases.
#[derive(Clone, Debug)]
pub enum ServerStep {
    /// Drop room memory, optionally closing sockets.
    Evict {
        /// Whether sockets also close.
        close_sockets: bool,
    },
    /// Close all sockets and rebuild rooms.
    Restart,
    /// Crash the next callback at a numbered port boundary.
    Crash {
        /// Number of preceding port calls.
        after_port_calls: u16,
    },
    /// Socket-preserving eviction between fragments.
    Hibernate,
    /// Hold durable completion and gated output.
    DelayStorage(Millis),
    /// Fail directory mapping for this duration.
    D1Outage {
        /// Outage length.
        ms: Millis,
    },
    /// Fail upcoming operation-log writes.
    StorageErrors {
        /// Put count.
        n: u8,
    },
    /// Permanently revoke configured collaborative-surface rooms.
    SurfaceRevoke,
    /// Freeze the document through the real source-migration use case.
    FreezeSource,
    /// An AI-range fork changes a GenericSurface field through the atomic HTTP use case.
    HttpFormUpdate {
        /// Field index, resolved modulo the configured field count.
        field: u16,
        /// New integer field value.
        value: u16,
    },
    /// Execute the real exists check.
    ExistsProbe,
    /// Damage saved snapshots and evict memory.
    CorruptSnapshot,
    /// Remove transient faults.
    Heal,
}
/// Script transition. Unsupported editor operations have no placeholder success path.
#[derive(Clone, Debug)]
pub enum Step {
    /// Create a session.
    Open(OpenSpec),
    /// Perform one valid-or-skipped form operation.
    Edit {
        /// Client.
        client: ClientName,
        /// Abstract operation.
        op: AbstractOp,
    },
    /// Process virtual events through a deadline.
    Run(Millis),
    /// Heal, then hold quiescence for a heartbeat interval.
    Settle,
    /// Change the network.
    Net(NetStep),
    /// Kill a tab; issued browser transactions still finish.
    Crash {
        /// Client.
        client: ClientName,
    },
    /// Kill every session in a browser process.
    CrashProfile {
        /// Browser.
        profile: ProfileName,
        /// Durability model.
        mode: CrashMode,
    },
    /// Stop and await the real Stopped reply.
    Close {
        /// Client.
        client: ClientName,
    },
    /// New peer/session over the same browser storage.
    Reopen {
        /// Client.
        client: ClientName,
    },
    /// Reopen every crashed session.
    ReopenCrashed,
    /// Forward a real host lifecycle signal.
    Host {
        /// Client.
        client: ClientName,
        /// Core signal.
        signal: doc_sync_core::HostSignal,
    },
    /// Simulate navigator.onLine, with fast connect failure only while offline.
    Offline {
        /// Client.
        client: ClientName,
        /// Offline flag.
        offline: bool,
    },
    /// Suspend every input while retaining the lease.
    Freeze {
        /// Client.
        client: ClientName,
    },
    /// Deliver all queued inputs in order.
    Thaw {
        /// Client.
        client: ClientName,
    },
    /// Issue a real Flush request.
    Flush {
        /// Client.
        client: ClientName,
    },
    /// Stop after a host editor error.
    EditorError {
        /// Client.
        client: ClientName,
    },
    /// Change one browser's storage.
    Storage {
        /// Browser.
        profile: ProfileName,
        /// Fault.
        fault: StorageFault,
    },
    /// Change real server behavior.
    Server(ServerStep),
    /// Change the front-door grant and notify the core.
    Grant {
        /// Client.
        client: ClientName,
        /// New grant.
        access: Access,
        /// Also close the existing connection.
        force_reconnect: bool,
    },
    /// Reject token validation on the next connect.
    TokenExpire {
        /// Client.
        client: ClientName,
    },
    /// Fail future permission-token fetches.
    TokenFetchFail {
        /// Client.
        client: ClientName,
        /// Attempts.
        n: u8,
    },
    /// Offset just this client's wall clock.
    ClockSkew {
        /// Client.
        client: ClientName,
        /// Signed offset.
        wall_offset_ms: i64,
    },
    /// Change browser user; subsequent opens use that user.
    SignIn {
        /// Browser.
        profile: ProfileName,
        /// Opaque user label.
        user: String,
    },
    /// Advance wall time without changing monotonic deadlines.
    AdvanceWall(Millis),
}

#[derive(Clone)]
pub(crate) struct TokenGrant {
    pub access: Access,
    pub user: String,
    pub doc: doc_sync_core::SyncDocId,
    pub issued_by: doc_sync_core::SessionId,
    pub expires_at: Option<usize>,
}
impl TokenGrant {
    pub fn issue(client: &crate::SimClient, wall: i64) -> Self {
        Self {
            access: client.spec.access,
            user: client.user.clone(),
            doc: client.doc_id.clone(),
            issued_by: client.session,
            expires_at: client.doc_id.as_str().starts_with("surface:").then(|| {
                usize::try_from(wall.saturating_div(1000).saturating_add(3600)).unwrap_or(0)
            }),
        }
    }
    pub fn expired(&self, wall: i64) -> bool {
        self.expires_at.is_some_and(|expiry| {
            i64::try_from(expiry).unwrap_or(i64::MAX) <= wall.saturating_div(1000)
        })
    }
}
