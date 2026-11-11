use super::*;
use doc_sync_core::{AuthorizationState, ChatterMessage, HostSignal, Phase};
use futures::FutureExt;
use sync_server_sim::ports::{Fault, FaultSchedule};

impl Sim {
    pub(super) fn step(&mut self, step: Step) -> Result<(), Failure> {
        match step {
            Step::Open(spec) => self.open(spec)?,
            Step::Create(spec) => self.create(spec, false)?,
            Step::Run(duration) => self.advance(duration.0),
            Step::Settle => {
                let start = self.clock.now;
                self.settle()?;
                self.stats.settle_ms = self
                    .stats
                    .settle_ms
                    .saturating_add(self.clock.now.saturating_sub(start));
            }
            Step::Edit { client: name, op } => {
                if let AbstractOp::Editor(op) = op {
                    return self.editor_edit(&name, op);
                }
                let Some(client) = self.clients.get_mut(&name) else {
                    self.emit(Fact::OpSkipped {
                        client: name,
                        reason: "NoTarget".into(),
                    });
                    return Ok(());
                };
                if !client.alive
                    || client.frozen
                    || !matches!(client.core.phase(), Phase::Running | Phase::Resetting)
                    || (client.effective_access != Access::Edit
                        && !matches!(op, AbstractOp::Select(_)))
                {
                    self.emit(Fact::OpSkipped {
                        client: name,
                        reason: "ReadOnlyOrNotReady".into(),
                    });
                    return Ok(());
                }
                let session = client.session;
                if let AbstractOp::Select(selection) = op {
                    client.selection = selection.map(|field| field % self.config.fields.max(1));
                    let value = client.selection.map(loro::LoroValue::from);
                    self.emit(Fact::LocalOp {
                        client: name.clone(),
                        op: AbstractOp::Select(selection),
                        spans: Vec::new(),
                    });
                    self.input(&name, session, SyncInput::SetPresence(value))?;
                } else {
                    let before = client.core.version();
                    client.core.edit_generic(
                        &op,
                        self.config.fields,
                        self.clock.wall(client.skew),
                    )?;
                    let peer = client.core.peer_id();
                    let start = before.get(&peer).copied().unwrap_or(0);
                    let end = client.core.version().get(&peer).copied().unwrap_or(0);
                    let spans = if end > start {
                        vec![IdSpan { peer, start, end }]
                    } else {
                        Vec::new()
                    };
                    self.emit(Fact::LocalOp {
                        client: name.clone(),
                        op,
                        spans: spans.clone(),
                    });
                    if !spans.is_empty() {
                        self.emit(Fact::LocalCommit {
                            client: name.clone(),
                            spans,
                        });
                    }
                    self.input(&name, session, SyncInput::LocalChanged)?;
                }
            }
            Step::Net(fault) => {
                match &fault {
                    NetStep::Partition(client) => self.emit(Fact::Partition {
                        client: client.clone(),
                        partitioned: true,
                    }),
                    NetStep::Heal(client) => self.emit(Fact::Partition {
                        client: client.clone(),
                        partitioned: false,
                    }),
                    _ => {}
                }
                let fault = self.router_network_fault(fault);
                if let Some(name) = self.net.fault(fault) {
                    self.break_client(&name, 1006)?;
                }
            }
            Step::Crash { client } => self.crash_client(&client)?,
            Step::CrashProfile { profile, mode } => {
                let names = self
                    .clients
                    .iter()
                    .filter(|(_, client)| client.alive && client.spec.profile == profile)
                    .map(|(name, _)| name.clone())
                    .collect::<Vec<_>>();
                for name in names {
                    self.crash_client(&name)?;
                }
                if let Some(store) = self.profiles.get_mut(&profile) {
                    let facts = store.crash(&mode, &profile, self.clock.now);
                    for fact in facts {
                        self.emit(fact);
                    }
                }
                self.emit(Fact::ProfileCrashed { profile });
            }
            Step::Close { client } | Step::EditorError { client } => self.close(&client)?,
            Step::Reopen { client } => {
                let spec = self
                    .clients
                    .get(&client)
                    .map(|client| client.spec.clone())
                    .ok_or_else(|| Failure::new("reopen", "unknown client"))?;
                self.open(spec)?;
            }
            Step::ReopenCrashed => {
                let specs = self
                    .clients
                    .values()
                    .filter(|client| !client.alive && !client.stopped)
                    .map(|client| client.spec.clone())
                    .collect::<Vec<_>>();
                for spec in specs {
                    self.open(spec)?;
                }
            }
            Step::Host { client, signal } => {
                if let Some(profile) = self
                    .clients
                    .get(&client)
                    .filter(|client| client.routed)
                    .map(|client| client.spec.profile.clone())
                {
                    self.router_input(&profile, doc_sync_core::RouterInput::Host(signal))?;
                }
                if let Some(session) = self.clients.get(&client).map(|client| client.session) {
                    self.input(&client, session, SyncInput::Host(signal))?;
                }
            }
            Step::Offline { client, offline } => {
                let network = self.network_name(&client);
                if offline {
                    self.net.offline.insert(network);
                    self.net.offline.insert(client);
                } else {
                    self.net.offline.remove(&network);
                    self.net.offline.remove(&client);
                    if let Some(profile) = self
                        .clients
                        .get(&client)
                        .filter(|client| client.routed)
                        .map(|client| client.spec.profile.clone())
                    {
                        self.router_input(
                            &profile,
                            doc_sync_core::RouterInput::Host(HostSignal::Online),
                        )?;
                    }
                    if let Some(session) = self.clients.get(&client).map(|client| client.session) {
                        self.input(&client, session, SyncInput::Host(HostSignal::Online))?;
                    }
                }
            }
            Step::Freeze { client } => {
                if let Some(peer) = self.clients.get_mut(&client) {
                    peer.frozen = true;
                }
                self.emit(Fact::Frozen { client });
            }
            Step::Thaw { client } => self.thaw(&client)?,
            Step::Flush { client } => {
                if let Some(peer) = self.clients.get_mut(&client) {
                    let id = peer.request();
                    let session = peer.session;
                    self.input(&client, session, SyncInput::Flush(id))?;
                }
            }
            Step::Storage { profile, fault } => {
                self.profiles
                    .entry(profile.clone())
                    .or_insert_with(|| {
                        SimStorage::with_retention(
                            self.config.storage.clone(),
                            self.config.session.wal.ttl,
                        )
                    })
                    .fault(fault);
                let corruptions = self
                    .profiles
                    .get_mut(&profile)
                    .map(|store| std::mem::take(&mut store.corruptions))
                    .unwrap_or_default();
                for (doc, owner, seq) in corruptions {
                    self.emit(Fact::WalCorrupted {
                        profile: profile.clone(),
                        doc,
                        owner,
                        seq,
                    });
                }
            }
            Step::Server(step) => self.server_step(step)?,
            Step::Grant {
                client: name,
                access,
                force_reconnect,
            } => {
                if let Some(client) = self.clients.get_mut(&name) {
                    client.spec.access = access;
                    let session = client.session;
                    self.input(
                        &name,
                        session,
                        SyncInput::Authorization(AuthorizationState {
                            current: true,
                            can_write: access == Access::Edit,
                            can_comment: access != Access::Read,
                        }),
                    )?;
                    if force_reconnect {
                        self.break_client(&name, 1008)?;
                    }
                }
            }
            Step::TokenExpire { client } => {
                if let Some(client) = self.clients.get_mut(&client) {
                    client.expire_token = true;
                }
            }
            Step::TokenFetchFail { client, n } => {
                if let Some(client) = self.clients.get_mut(&client) {
                    client.token_failures = n;
                }
            }
            Step::ClockSkew {
                client,
                wall_offset_ms,
            } => {
                if let Some(peer) = self.clients.get_mut(&client) {
                    let bounded = self.config.session.presence_timeout.0.unsigned_abs() / 2;
                    if peer.skew.unsigned_abs() <= bounded
                        && wall_offset_ms.unsigned_abs() <= bounded
                    {
                        let backwards = peer.skew.saturating_sub(wall_offset_ms);
                        if backwards > 0 {
                            self.presence_clock_ready_at = self.presence_clock_ready_at.max(
                                self.clock
                                    .now
                                    .saturating_add(backwards.unsigned_abs())
                                    .saturating_add(1),
                            );
                        }
                    }
                    peer.skew = wall_offset_ms;
                    self.emit(Fact::ClockSkew {
                        client,
                        wall_offset_ms,
                    });
                }
            }
            Step::AssertProfileDrained { profile } => {
                let store = self
                    .profiles
                    .get(&profile)
                    .ok_or_else(|| Failure::new("account_switch_drained", "unknown profile"))?;
                let user = doc_sync_core::UserKey(store.user.clone());
                let pending = store
                    .durable
                    .entries
                    .iter()
                    .filter(|(_, row)| row.record.user == user && !row.delivered)
                    .map(|(key, _)| key.clone())
                    .collect::<Vec<_>>();
                if !pending.is_empty() {
                    return Err(Failure::new(
                        "account_switch_drained",
                        format!("{profile:?}: current-user undelivered rows {pending:?}"),
                    ));
                }
            }
            Step::SignIn { profile, user } => {
                if let Some(store) = self.profiles.get_mut(&profile) {
                    store.user = user;
                }
                let sessions = self
                    .clients
                    .iter()
                    .filter(|(_, client)| client.alive && client.spec.profile == profile)
                    .map(|(name, client)| (name.clone(), client.session))
                    .collect::<Vec<_>>();
                for (name, session) in sessions {
                    self.input(
                        &name,
                        session,
                        SyncInput::Authorization(AuthorizationState {
                            current: false,
                            can_write: false,
                            can_comment: false,
                        }),
                    )?;
                }
            }
            Step::AdvanceWall(duration) => {
                self.clock.wall_origin = self
                    .clock
                    .wall_origin
                    .saturating_add(i64::try_from(duration.0).unwrap_or(i64::MAX));
                let sessions = self
                    .clients
                    .iter()
                    .filter(|(_, client)| client.alive)
                    .map(|(name, client)| (name.clone(), client.session))
                    .collect::<Vec<_>>();
                for (name, session) in sessions {
                    self.input(&name, session, SyncInput::Tick)?;
                }
            }
        }
        Ok(())
    }
    pub(super) fn open(&mut self, spec: OpenSpec) -> Result<(), Failure> {
        self.create(spec, true)
    }
    fn create(&mut self, spec: OpenSpec, start: bool) -> Result<(), Failure> {
        if self
            .clients
            .get(&spec.client)
            .is_some_and(|client| client.alive)
        {
            return Err(Failure::new("open", "client is already alive"));
        }
        let doc_id = self
            .servers
            .get(&spec.doc)
            .ok_or_else(|| Failure::new("open", "unknown document"))?
            .key
            .as_str()
            .parse()
            .map_err(|e| Failure::new("document_id", e))?;
        let session = SessionId(self.uuid());
        let colors = [
            doc_sync_core::PaletteColor::Red,
            doc_sync_core::PaletteColor::Orange,
            doc_sync_core::PaletteColor::Yellow,
            doc_sync_core::PaletteColor::Lime,
            doc_sync_core::PaletteColor::Green,
            doc_sync_core::PaletteColor::Teal,
            doc_sync_core::PaletteColor::Cyan,
            doc_sync_core::PaletteColor::Blue,
            doc_sync_core::PaletteColor::Violet,
            doc_sync_core::PaletteColor::Purple,
            doc_sync_core::PaletteColor::Pink,
        ];
        let color = colors[self.rng.random_range(0..colors.len())];
        let peer = self.peer(spec.kind);
        let supply = (0..16).map(|_| self.peer(spec.kind)).collect::<Vec<_>>();
        let profile = self
            .profiles
            .entry(spec.profile.clone())
            .or_insert_with(|| {
                SimStorage::with_retention(self.config.storage.clone(), self.config.session.wal.ttl)
            });
        let user = profile.user.clone();
        let now = doc_sync_core::Now {
            mono: doc_sync_core::Millis(self.clock.now),
            wall: doc_sync_core::UnixMillis(self.clock.wall(0)),
        };
        let client = SimClient::new(
            spec.clone(),
            crate::client::Identity {
                doc: doc_id,
                session,
                peer,
                user: user.clone(),
                color,
            },
            supply,
            now,
            &self.config.session,
            matches!(
                self.config.seeds.get(&spec.doc),
                Some(SeedDocument::Editor(_) | SeedDocument::StoredEditor(_))
            ),
        )?;
        let server = self
            .servers
            .get(&spec.doc)
            .ok_or_else(|| Failure::new("open", "unknown server"))?;
        let seed = server
            .ports
            .snapshot_dump()
            .get(server.key.as_str())
            .cloned()
            .ok_or_else(|| Failure::new("open", "no seed snapshot"))?;
        let optimistic = server.optimistic_seed;
        let cached_s3 = server.s3_seed.clone();
        let cached_local = server.local_seed.clone();
        let store = self
            .profiles
            .get_mut(&spec.profile)
            .ok_or_else(|| Failure::new("profile", "missing profile"))?;
        if store.seeded_docs.insert(client.core_doc_id())
            && let Some(bytes) = cached_local
        {
            store
                .durable
                .snapshots
                .entry(client.core_doc_id())
                .or_insert(doc_sync_core::StoredSnapshot {
                    bytes,
                    covers: None,
                });
        }
        store.leases.insert((client.core_doc_id(), session));
        let name = spec.client.clone();
        self.clients.insert(name.clone(), client);
        self.emit(Fact::Opened {
            client: name.clone(),
            profile: spec.profile,
            doc: spec.doc,
            session,
            peer,
            user,
            access: spec.access,
            kind: spec.kind,
        });
        if !start {
            return Ok(());
        }
        self.input(&name, session, SyncInput::Start)?;
        if let Some((snapshot, after)) = cached_s3 {
            self.schedule(
                self.clock.now.saturating_add(after.0),
                Pending::Input(
                    name.clone(),
                    session,
                    SyncInput::Seed {
                        kind: doc_sync_core::SeedKind::CachedS3,
                        snapshot,
                    },
                ),
            );
        }
        if optimistic {
            self.input(
                &name,
                session,
                SyncInput::Seed {
                    kind: doc_sync_core::SeedKind::Optimistic,
                    snapshot: seed,
                },
            )?;
        }
        if self.clients.get(&name).is_some_and(|client| client.routed) {
            self.router_attach(&name)?;
        }
        Ok(())
    }

    fn break_client(&mut self, name: &ClientName, code: u16) -> Result<(), Failure> {
        if let Some(profile) = self
            .clients
            .get(name)
            .filter(|client| client.routed)
            .map(|client| client.spec.profile.clone())
        {
            return self.router_break(&profile, code);
        }
        let keys = self
            .net
            .links
            .keys()
            .filter(|(client, _, _)| client == name)
            .cloned()
            .collect::<Vec<_>>();
        for key in keys {
            self.break_link(&key, code)?;
        }
        Ok(())
    }
    fn crash_client(&mut self, name: &ClientName) -> Result<(), Failure> {
        let routed = self.clients.get(name).is_some_and(|client| client.routed);
        if routed {
            self.router_detach(name)?;
        }
        if let Some(client) = self.clients.get_mut(name) {
            client.alive = false;
            client.frozen = false;
            client.deferred.clear();
            if let Some(store) = self.profiles.get_mut(&client.spec.profile) {
                store.leases.remove(&(client.core_doc_id(), client.session));
            }
        }
        self.clock.clear_client_wakes(name);
        if !routed {
            self.break_client(name, 1006)?;
        }
        self.emit(Fact::Crashed {
            client: name.clone(),
        });
        Ok(())
    }
    pub(super) fn finish_close(&mut self, name: &ClientName) -> Result<(), Failure> {
        let Some(client) = self.clients.get(name) else {
            return Ok(());
        };
        if !client.alive || !client.stopped {
            return Ok(());
        }
        let session = client.session;
        let profile = client.spec.profile.clone();
        let doc = client.core_doc_id();
        if self.profiles.get(&profile).is_some_and(|store| {
            store
                .pending
                .values()
                .any(|pending| pending.session == session)
        }) {
            return Ok(());
        }
        if let Some(client) = self.clients.get_mut(name) {
            client.alive = false;
        }
        if let Some(store) = self.profiles.get_mut(&profile) {
            store.leases.remove(&(doc.clone(), session));
        }
        let targets = self
            .clients
            .iter()
            .filter(|(_, client)| {
                client.alive && client.spec.profile == profile && client.core_doc_id() == doc
            })
            .map(|(name, client)| (name.clone(), client.session))
            .collect::<Vec<_>>();
        for (target, owner) in targets {
            self.schedule(
                self.clock.now,
                Pending::Input(
                    target,
                    owner,
                    SyncInput::Chatter(ChatterMessage::Closing(session)),
                ),
            );
        }
        self.emit(Fact::Closed {
            client: name.clone(),
            session,
        });
        Ok(())
    }
    fn close(&mut self, name: &ClientName) -> Result<(), Failure> {
        let Some(client) = self.clients.get_mut(name) else {
            return Ok(());
        };
        if !client.alive {
            return Ok(());
        }
        let session = client.session;
        let flush_request = if client.spec.kind == ClientKind::AiWorker
            && !matches!(
                client.core.phase(),
                doc_sync_core::Phase::Created | doc_sync_core::Phase::Stopped
            ) {
            Some(client.request())
        } else {
            None
        };
        let stop_request = client.request();
        let opened = self.events.iter().rposition(|event| matches!(&event.fact, Fact::Opened { client, session: owner, .. } if client == name && *owner == session)).unwrap_or(self.events.len());
        let session_events = &self.events[opened..];
        let in_window = session_events.iter().rev().find_map(|event| match &event.fact {
            Fact::LocalOp { client, spans, .. } if client == name && !spans.is_empty() => Some((event.at, spans)),
            _ => None,
        }).is_some_and(|(at, spans)| self.clock.now.saturating_sub(at.0) < self.config.session.wal.coalesce.0 &&
            !session_events.iter().any(|event| matches!(&event.fact, Fact::WalAppendIssued { session: owner, spans: stored, .. } if *owner == session && spans.iter().all(|span| crate::invariants::ranges_cover(stored, span)))));
        if in_window {
            self.stats.close_in_window += 1;
        }
        self.emit(Fact::CloseRequested {
            client: name.clone(),
            session,
            request: stop_request.0,
            deadline: self.clock.now.saturating_add(if flush_request.is_some() {
                self.config
                    .budgets
                    .settle
                    .0
                    .saturating_mul(2)
                    .saturating_add(700)
            } else {
                self.config.budgets.settle.0
            }),
        });
        if let Some(request) = flush_request {
            self.input(name, session, SyncInput::Flush(request))?;
            let deadline = self.clock.now.saturating_add(self.config.budgets.settle.0);
            while self.clock.now < deadline && !self.events.iter().rev().any(|event| matches!(&event.fact, Fact::Reply { client, request: id, .. } if client == name && *id == request.0)) { self.advance_next(deadline); }
            let drained = self
                .events
                .iter()
                .rev()
                .find_map(|event| match &event.fact {
                    Fact::Reply {
                        client,
                        request: id,
                        reply,
                    } if client == name && *id == request.0 => Some(reply == "Flush(Drained)"),
                    _ => None,
                })
                .unwrap_or(false);
            if !drained {
                self.fail(Failure::new("ai_flush", "AI worker close did not drain"));
            }
            self.advance(700);
        }
        if let Some(client) = self.clients.get_mut(name) {
            client.close_requested = true;
            self.input(name, session, SyncInput::Stop(stop_request))?;
        }
        let deadline = self.clock.now.saturating_add(self.config.budgets.settle.0);
        while self.clock.now < deadline && self.clients.get(name).is_some_and(|client| client.alive)
        {
            self.advance_next(deadline);
        }
        if self.clients.get(name).is_some_and(|client| client.alive) {
            return Err(Failure::new(
                "graceful_close",
                "Stopped reply or outstanding writes never completed",
            ));
        }
        Ok(())
    }
    pub(super) fn thaw(&mut self, name: &ClientName) -> Result<(), Failure> {
        let Some(client) = self.clients.get_mut(name) else {
            return Ok(());
        };
        client.frozen = false;
        let session = client.session;
        let queued = std::mem::take(&mut client.deferred);
        self.emit(Fact::Thawed {
            client: name.clone(),
        });
        for input in queued {
            self.input(name, session, input)?;
        }
        self.input(name, session, SyncInput::Tick)
    }
    pub(super) fn server_step(&mut self, step: ServerStep) -> Result<(), Failure> {
        let documents = self.servers.keys().copied().collect::<Vec<_>>();
        for doc in documents {
            match &step {
                ServerStep::Evict { close_sockets } => {
                    if *close_sockets {
                        let keys = self
                            .net
                            .links
                            .iter()
                            .filter(|(_, link)| link.doc == doc && link.open)
                            .map(|(key, _)| key.clone())
                            .collect::<Vec<_>>();
                        for key in keys {
                            self.break_link(&key, 1000)?;
                        }
                    }
                    if let Some(server) = self.servers.get_mut(&doc) {
                        server.evict();
                    }
                }
                ServerStep::Restart => {
                    let keys = self
                        .net
                        .links
                        .iter()
                        .filter(|(_, link)| link.doc == doc && link.open)
                        .map(|(key, _)| key.clone())
                        .collect::<Vec<_>>();
                    for key in keys {
                        self.break_link(&key, 1000)?;
                    }
                    if let Some(server) = self.servers.get_mut(&doc) {
                        server.evict();
                    }
                }
                ServerStep::Hibernate => {
                    if let Some(server) = self.servers.get_mut(&doc) {
                        server.evict();
                    }
                }
                ServerStep::Crash { after_port_calls } => {
                    if let Some(server) = self.servers.get(&doc) {
                        server
                            .ports
                            .fault_after_calls(usize::from(*after_port_calls), Fault::Crash);
                    }
                }
                ServerStep::DelayStorage(latency) => {
                    if let Some(server) = self.servers.get_mut(&doc) {
                        server.storage_latency = *latency;
                    }
                }
                ServerStep::D1Outage { ms } => {
                    if let Some(server) = self.servers.get(&doc) {
                        for operation in ["peers.map_unowned", "peers.claim"] {
                            server.ports.set_operation_error(
                                operation,
                                Some("simulated directory outage".into()),
                            );
                        }
                    }
                    self.schedule(
                        self.clock.now.saturating_add(ms.0),
                        Pending::HealDirectory(doc),
                    );
                }
                ServerStep::StorageErrors { n } => {
                    if let Some(server) = self.servers.get(&doc) {
                        let start = server.ports.call_count("storage.put");
                        let faults: FaultSchedule = (0..usize::from(*n))
                            .map(|index| {
                                (
                                    ("storage.put".into(), start + index),
                                    Fault::Error("simulated storage error".into()),
                                )
                            })
                            .collect();
                        server.ports.set_faults(faults);
                    }
                }
                ServerStep::SurfaceRevoke => {
                    if self.config.surfaces.contains(&doc) {
                        self.server_input(doc, Input::SurfaceRevoke)?;
                    }
                }
                ServerStep::FreezeSource => {
                    // Source migration belongs to the legacy document route group.
                    if self.config.surfaces.contains(&doc) {
                        continue;
                    }
                    let operation = self.uuid();
                    let body =
                        serde_json::to_vec(&serde_json::json!({ "operation_id": operation }))
                            .map_err(|error| Failure::new("freeze_request", error))?;
                    self.server_input(doc, Input::FreezeSource(body))?;
                }
                ServerStep::HttpFormUpdate { field, value } => {
                    let peer = self.peer(ClientKind::AiWorker);
                    self.server_input(
                        doc,
                        Input::HttpFormUpdate {
                            peer,
                            field: *field,
                            value: *value,
                            fields: self.config.fields,
                        },
                    )?;
                }
                ServerStep::ExistsProbe => self.server_input(doc, Input::Exists)?,
                ServerStep::CorruptSnapshot => {
                    if let Some(server) = self.servers.get_mut(&doc) {
                        use sync_server_core::domain::ports::SnapshotStore;
                        server
                            .ports
                            .put(&server.key, &[0])
                            .now_or_never()
                            .ok_or_else(|| {
                                Failure::new("server_stalled", "corrupt snapshot write stalled")
                            })?
                            .map_err(|e| Failure::new("server_corruption", e))?;
                        server
                            .ports
                            .confirm_through(server.ports.write_generation());
                        server.evict();
                    }
                }
                ServerStep::Heal => {
                    self.clock.clear_directory_heals(doc);
                    if let Some(server) = self.servers.get_mut(&doc) {
                        server.storage_latency = self.config.server_storage_latency;
                        server.ports.set_faults(FaultSchedule::new());
                        for op in ["peers.map_unowned", "peers.claim"] {
                            server.ports.set_operation_error(op, None);
                        }
                    }
                }
            }
        }
        self.emit(Fact::Server {
            operation: format!("{step:?}"),
        });
        Ok(())
    }
}
