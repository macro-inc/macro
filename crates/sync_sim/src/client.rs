//! Real client core with a GenericSurface Loro document and an explicit executor boundary.
use crate::{
    document::{SimDoc, vv},
    *,
};
use doc_sync_core::*;
use std::collections::{BTreeMap, VecDeque};

/// A real client core and lending document; runtime effects are executed by the world.
pub struct SimClient {
    pub(crate) spec: OpenSpec,
    pub(crate) session: SessionId,
    pub(crate) doc_id: SyncDocId,
    pub(crate) user: String,
    pub(crate) core: SyncCore,
    pub(crate) doc: SimDoc,
    pub(crate) alive: bool,
    pub(crate) frozen: bool,
    pub(crate) deferred: VecDeque<SyncInput>,
    pub(crate) generation: u64,
    pub(crate) skew: i64,
    pub(crate) selection: Option<u16>,
    pub(crate) presence_key: String,
    pub(crate) remote: BTreeMap<String, serde_json::Value>,
    pub(crate) last_parked: Vec<(WalSeq, String)>,
    pub(crate) close_requested: bool,
    pub(crate) stopped: bool,
    pub(crate) token_failures: u8,
    pub(crate) expire_token: bool,
    pub(crate) next_request: u32,
}
impl SimClient {
    pub(crate) fn new(
        spec: OpenSpec,
        doc: SyncDocId,
        session: SessionId,
        peer: u64,
        supply: Vec<u64>,
        user: String,
        now: Now,
    ) -> Result<Self, Failure> {
        let ai = spec.kind == ClientKind::AiWorker;
        let presence_key = if ai {
            format!("ai-{}", session.0)
        } else {
            peer.to_string()
        };
        let config = SyncConfig {
            doc: doc.clone(),
            session,
            user: UserKey(user.clone()),
            transport: TransportKind::Direct,
            persistence: if ai {
                Persistence::Memory
            } else {
                Persistence::Durable
            },
            access: spec.access.core(),
            initial_token: None,
            traceparent: None,
            timeouts: Timeouts::default(),
            heartbeat: HeartbeatPolicy::default(),
            backoff: BackoffPolicy::default(),
            converge: ConvergePolicy::default(),
            wal: WalPolicy::default(),
            snapshot_interval: Some(doc_sync_core::Millis(5_000)),
            presence: PresencePolicy {
                timeout: WallDuration(5_000),
                refresh: Some(doc_sync_core::Millis(if ai { 2_000 } else { 3_000 })),
                user: PresenceUser {
                    user_id: None,
                    color: PaletteColor::Blue,
                },
                key: if ai {
                    PresenceKeyMode::Fixed(presence_key.clone())
                } else {
                    PresenceKeyMode::Peer
                },
            },
            chatter: !ai,
            reset_budget: ResetBudget::default(),
        };
        let mut peers = PeerSupply::new(if ai { PeerRange::Ai } else { PeerRange::User });
        peers
            .extend(supply)
            .map_err(|e| Failure::new("peer_supply", e))?;
        let core = SyncCore::with_peer_supply(config, now, peers)
            .map_err(|e| Failure::new("client_configuration", e))?;
        Ok(Self {
            spec,
            session,
            doc_id: doc,
            user,
            core,
            doc: SimDoc::new(peer)?,
            alive: true,
            frozen: false,
            deferred: VecDeque::new(),
            generation: 0,
            skew: 0,
            selection: None,
            presence_key,
            remote: BTreeMap::new(),
            last_parked: Vec::new(),
            close_requested: false,
            stopped: false,
            token_failures: 0,
            expire_token: false,
            next_request: 0,
        })
    }
    pub(crate) fn connection_id(&self) -> Option<ConnId> {
        match self.core.connection() {
            Connection::Authorizing { conn, .. }
            | Connection::Connecting { conn, .. }
            | Connection::AwaitingInitialSync { conn, .. }
            | Connection::Synced { conn, .. } => Some(*conn),
            _ => None,
        }
    }
    pub(crate) fn core_doc_id(&self) -> SyncDocId {
        self.doc_id.clone()
    }
    pub(crate) fn request(&mut self) -> RequestId {
        let id = RequestId(self.next_request);
        self.next_request = self.next_request.saturating_add(1);
        id
    }
    pub(crate) fn handle(&mut self, input: SyncInput, now: Now) -> (SyncOutput, Vec<Fact>) {
        let mut out = SyncOutput::default();
        let before = self.doc.oplog_vv();
        self.core.handle(now, &mut self.doc, input, &mut out);
        let peer = self.doc.peer_id();
        if self.spec.kind == ClientKind::Tab {
            self.presence_key = peer.to_string();
        }
        let start = before.get(&peer).copied().unwrap_or(0);
        let end = self.doc.oplog_vv().get(&peer).copied().unwrap_or(0);
        let mut facts = Vec::new();
        if end > start {
            facts.push(Fact::LocalCommit {
                client: self.spec.client.clone(),
                spans: vec![IdSpan { peer, start, end }],
            });
        }
        for (origin, pending, error) in self.doc.imports.drain(..) {
            facts.push(Fact::Imported {
                client: self.spec.client.clone(),
                origin,
                pending,
                error,
            });
        }
        let parked = self
            .core
            .parked()
            .into_iter()
            .map(|(seq, reason)| (seq, format!("{reason:?}")))
            .collect::<Vec<_>>();
        if parked != self.last_parked {
            self.last_parked = parked.clone();
            facts.push(Fact::RowsParked {
                client: self.spec.client.clone(),
                rows: parked,
            });
        }
        self.generation = self.generation.saturating_add(1);
        (out, facts)
    }
    pub(crate) fn final_state(&self) -> Result<ClientFinal, Failure> {
        let parked = self.core.parked();
        let total = self
            .core
            .wal()
            .entries
            .iter()
            .filter(|row| {
                !row.superseded
                    && self
                        .core
                        .wal()
                        .delivered_through
                        .is_none_or(|through| row.seq > through)
            })
            .count();
        let undelivered = total.saturating_sub(parked.len());
        let terminal = match &self.core.status().connection {
            ConnectionStatus::Closed(reason) => Some(format!("{reason:?}")),
            _ => None,
        };
        Ok(ClientFinal {
            alive: self.alive,
            terminal,
            session: self.session,
            profile: self.spec.profile.clone(),
            user: self.user.clone(),
            doc: self.spec.doc,
            access: self.spec.access,
            kind: self.spec.kind,
            peer: self.doc.peer_id(),
            oplog_vv: vv(&self.doc.oplog_vv()),
            deep_value: self.doc.value()?,
            wal_undelivered: undelivered,
            wal_total: total,
            parked: parked
                .into_iter()
                .map(|(seq, reason)| (seq, format!("{reason:?}")))
                .collect(),
            status: self.core.status().clone(),
            storage_healthy: matches!(self.core.wal().health, StorageHealth::Ok),
            pending_import: self.doc.pending || self.core.status().pending_import,
            selection: self.selection,
            presence_key: self.presence_key.clone(),
            skew: self.skew,
        })
    }
}
