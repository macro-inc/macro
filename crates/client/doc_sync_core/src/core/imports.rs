use super::*;

impl SyncCore {
    pub(super) fn socket(
        &mut self,
        conn: ConnId,
        event: SocketEvent,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        if self.config.transport != TransportKind::Direct || self.connection.conn() != Some(conn) {
            return;
        }
        let closed = matches!(event, SocketEvent::Closed { .. });
        if closed {
            self.disconnected(now, out);
        }
        self.connection.socket(conn, &event, now, &mut out.io);
        if matches!(
            self.connection.state,
            Connection::Closed(CloseReason::Unauthorized)
        ) {
            self.stop(now, doc, None, CloseReason::Unauthorized, out);
            return;
        }
        if let SocketEvent::Frame(frame) = event {
            self.frame(frame, now, doc, out);
        }
    }

    pub(super) fn route(
        &mut self,
        event: RouteEvent,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        if self.config.transport != TransportKind::Routed {
            return;
        }
        match event {
            RouteEvent::Subscribed { conn, access } => {
                if self
                    .connection
                    .conn()
                    .is_some_and(|current| current.0 > conn.0)
                {
                    return;
                }
                self.disconnected(now, out);
                self.connection.access = access;
                self.connection.state = Connection::AwaitingInitialSync {
                    conn,
                    deadline: now.mono.after(self.config.timeouts.initial_sync),
                    heartbeat: None,
                };
            }
            RouteEvent::Frame { conn, frame } if self.connection.conn() == Some(conn) => {
                self.frame(frame, now, doc, out)
            }
            RouteEvent::Closed { conn, code }
                if self
                    .connection
                    .conn()
                    .is_none_or(|current| conn.0 >= current.0) =>
            {
                self.disconnected(now, out);
                self.connection.state = Connection::Idle;
                if code == 4401 {
                    if self.route_denied {
                        self.stop(now, doc, None, CloseReason::Unauthorized, out);
                    } else {
                        self.route_denied = true;
                        out.io.push(IoEffect::RouteReconnect {
                            doc: self.config.doc.clone(),
                        });
                    }
                }
            }
            _ => {}
        }
    }

    fn frame(&mut self, frame: Vec<u8>, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        let bytes = match self.reassembler.push(&frame) {
            Ok(Some(bytes)) => bytes,
            Ok(None) => return,
            Err(_) => {
                self.protocol_error("frame", now, out);
                return;
            }
        };
        let message = match sync_protocol::FromRemote::deserialize(&bytes) {
            Ok(message) => message,
            Err(_) => {
                self.protocol_error("decode", now, out);
                return;
            }
        };
        match message {
            sync_protocol::FromRemote::Unknown => self.event("ws.message.unknown", Vec::new(), out),
            sync_protocol::FromRemote::RemoteInitialSync {
                snapshot,
                awareness,
            } => {
                let reconnect = self.connection.synced();
                if self.connection.initial(now) {
                    self.route_denied = false;
                    self.apply_presence(&awareness.iter().collect::<Vec<_>>(), now, out);
                    if !reconnect && !self.seeded {
                        self.seed(SeedKind::Remote, snapshot.iter().collect(), now, doc, out);
                    }
                    self.on_synced(now, doc, out);
                }
            }
            sync_protocol::FromRemote::RemoteUpdate { update } => {
                self.import(
                    &update.iter().collect::<Vec<_>>(),
                    ImportOrigin::Live,
                    now,
                    doc,
                    out,
                );
            }
            sync_protocol::FromRemote::RemoteUpdateSince { update, vv } => {
                self.since_reply(vv.iter().collect(), update.iter().collect(), now, doc, out)
            }
            sync_protocol::FromRemote::RemoteSnapshot { snapshot } => {
                self.snapshot_reply(snapshot.iter().collect(), now, doc, out)
            }
            sync_protocol::FromRemote::RemoteUpdateAck { id } => self.ack(id, now, doc, out),
            sync_protocol::FromRemote::RemoteAwareness { awareness } => {
                self.apply_presence(&awareness.iter().collect::<Vec<_>>(), now, out)
            }
        }
    }

    fn protocol_error(&mut self, stage: &'static str, now: Now, out: &mut SyncOutput) {
        self.event(
            "ws.message.error",
            vec![("stage", AttrValue::String(stage.into()))],
            out,
        );
        self.disconnected(now, out);
        if self.config.transport == TransportKind::Routed {
            self.connection.state = Connection::Idle;
            out.io.push(IoEffect::RouteReconnect {
                doc: self.config.doc.clone(),
            });
        } else {
            self.connection
                .fail(now, CloseCause::ProtocolError, &mut out.io);
        }
    }

    pub(super) fn on_synced(&mut self, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        for peer in self.registered_peers.clone() {
            self.send(
                sync_protocol::FromPeer::PeerRegisterId { peerid: peer },
                out,
            );
        }
        self.push_retry = None;
        self.assist_retry = None;
        if self.phase == Phase::Running {
            self.request_since(1, now, doc, out);
        }
        self.push_rows(now, out);
        self.presence_dirty = true;
        self.presence_due = Some(now.mono);
        self.flush_presence(now, doc, out);
        self.load_orphans(now, out);
        if matches!(self.reset, Some(ResetState::Awaiting { .. })) {
            self.request_snapshot(SnapshotPurpose::Reset, now, out);
        }
    }

    pub(super) fn disconnected(&mut self, now: Now, out: &mut SyncOutput) {
        self.push_failed(now, out);
        self.assist_push = None;
        self.reassembler = sync_protocol::framing::Reassembler::default();
        self.since.clear();
        self.convergence = None;
        self.convergence_retry = None;
        if let Some(span) = self.catchup_span.take() {
            self.end_span(span, "disconnected", true, out);
        }
        for request in self.snapshots.drain(..) {
            if request.expired {
                continue;
            }
            if let SnapshotPurpose::Host(id) = request.purpose {
                out.events.push(SyncEvent::Reply {
                    request: id,
                    reply: Reply::Snapshot(Err(RequestFailure::Disconnected)),
                });
            }
        }
        for comment in self.comments.drain(..) {
            out.events.push(SyncEvent::Reply {
                request: comment.request,
                reply: Reply::Comment(CommentReply::NotAcked),
            });
        }
        if let Some(span) = self.connect_span.take() {
            self.end_span(span, "disconnected", false, out);
        }
    }

    pub(super) fn seed(
        &mut self,
        kind: SeedKind,
        snapshot: Vec<u8>,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        if self.phase != Phase::Loading || self.seeded {
            self.event(
                "doc.seed",
                vec![("outcome", AttrValue::String("discarded".into()))],
                out,
            );
            return;
        }
        if kind == SeedKind::Remote && self.local_loading {
            self.deferred_seed = Some(snapshot);
            self.seed_wait_deadline
                .get_or_insert(now.mono.after(self.config.timeouts.storage));
            return;
        }
        match doc.seed(&snapshot, kind) {
            Ok(()) => {
                self.seeded = true;
                self.seed_wait_deadline = None;
                self.deferred_seed = None;
                self.confirmed_base = doc.oplog_vv().get_frontiers();
                self.wal.logged_vv = doc.oplog_vv();
                self.snapshot_vv = doc.oplog_vv();
                let replayed = self.replay(now, doc, out);
                out.events.push(SyncEvent::Seeded {
                    kind,
                    replayed_wal: replayed,
                });
                self.event(
                    "doc.seed",
                    vec![("outcome", AttrValue::String("applied".into()))],
                    out,
                );
                if let Some(span) = self.load_span {
                    self.end_span(span, "seeded", false, out);
                }
            }
            Err(_) => {
                self.event(
                    "doc.seed",
                    vec![("outcome", AttrValue::String("failed".into()))],
                    out,
                );
                if kind == SeedKind::Local {
                    self.issue(
                        StorageOp::SnapshotDelete {
                            doc: self.config.doc.clone(),
                        },
                        StorageCompletion::Other,
                        now,
                        out,
                    );
                }
            }
        }
    }

    pub(super) fn replay(&mut self, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) -> u32 {
        let rows: Vec<_> = self
            .wal
            .entries
            .iter()
            .filter(|e| e.park.is_none() && !e.superseded)
            .map(|e| (e.seq, e.bytes.clone()))
            .collect();
        let mut replayed = 0u32;
        for (seq, bytes) in rows {
            // A shallow snapshot already contains these acknowledged operations.
            // Re-importing their collected history can return Outdated forever;
            // checksum-verified metadata and the snapshot VV prove this is an
            // idempotent replay, without exempting any unacknowledged row.
            if self.is_delivered(seq)
                && loro::LoroDoc::decode_import_blob_meta(&bytes, true)
                    .is_ok_and(|meta| doc.oplog_vv().includes_vv(&meta.partial_end_vv))
            {
                replayed = replayed.saturating_add(1);
                continue;
            }
            match doc.import_remote(&bytes, ImportOrigin::WalReplay) {
                Ok(imported) => {
                    replayed = replayed.saturating_add(1);
                    self.pending_import = imported.pending;
                    if imported.pending
                        && (self.rows_after_gap.contains(&seq)
                            || self.wal.entries.iter().any(|e| {
                                e.seq < seq && matches!(e.state, EntryState::Unlogged { .. })
                            }))
                    {
                        if let Some(entry) = self.wal.entries.iter_mut().find(|e| e.seq == seq) {
                            entry.park = Some(ParkReason::Gap);
                        }
                        self.event("wal.gap", vec![("seq", AttrValue::U64(seq.0))], out);
                    }
                }
                Err(ImportFailure::Outdated) => {
                    if let Some(entry) = self.wal.entries.iter_mut().find(|e| e.seq == seq) {
                        entry.park = Some(ParkReason::NeedsRebase);
                    }
                    self.schedule_rebase(now, out);
                }
                Err(_) => self.event(
                    "wal.replay.error",
                    vec![("seq", AttrValue::U64(seq.0))],
                    out,
                ),
            }
        }
        // Adoption may finish inside the current peer's coalesce window.
        // Importing another owner's rows cannot make that local edit logged.
        if self.wal.append_due.is_none() {
            self.wal.logged_vv = doc.oplog_vv();
        }
        if replayed > 0 {
            self.save_snapshot(now, doc, out);
        }
        replayed
    }

    pub(super) fn resume_server_backed_gaps(&mut self, doc: &impl SyncDoc, out: &mut SyncOutput) {
        if self.phase != Phase::Running || self.reset.is_some() || self.rebase_due.is_some() {
            return;
        }
        let local = doc.oplog_vv();
        let mut resumed = Vec::new();
        for entry in &mut self.wal.entries {
            if entry.park != Some(ParkReason::Gap) {
                continue;
            }
            let Ok(meta) = loro::LoroDoc::decode_import_blob_meta(&entry.bytes, true) else {
                continue;
            };
            // W-2's permanent Gap requires parents that no store holds. A
            // successful server import/ACK can disprove that early inference.
            // Require both actual local row coverage and server-held parents;
            // local history alone is never server delivery proof for this row.
            if local.includes_vv(&meta.partial_end_vv)
                && meta
                    .start_frontiers
                    .iter()
                    .all(|id| self.server_vv.get(&id.peer).copied().unwrap_or(0) > id.counter)
            {
                entry.park = None;
                self.rows_after_gap.remove(&entry.seq);
                resumed.push(entry.seq);
            }
        }
        for seq in resumed {
            self.event(
                "wal.gap.resolved",
                vec![("seq", AttrValue::U64(seq.0))],
                out,
            );
        }
    }

    pub(super) fn import(
        &mut self,
        bytes: &[u8],
        origin: ImportOrigin,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) -> Option<Imported> {
        if self.phase != Phase::Running || bytes.is_empty() {
            return None;
        }
        let span = self.span("edit.apply", self.catchup_span.or(self.connect_span), out);
        match doc.import_remote(bytes, origin) {
            Ok(imported) => {
                self.pending_import = imported.pending;
                self.end_span(
                    span,
                    if imported.pending {
                        "pending"
                    } else {
                        "applied"
                    },
                    false,
                    out,
                );
                if matches!(origin, ImportOrigin::Live | ImportOrigin::Catchup) {
                    self.server_evidence(bytes, now, out);
                }
                if imported.pending && origin != ImportOrigin::Catchup {
                    self.request_since(1, now, doc, out);
                }
                Some(imported)
            }
            Err(error) => {
                self.end_span(span, "failed", true, out);
                self.import_failure(error, now, doc, out);
                None
            }
        }
    }

    pub(super) fn import_failure(
        &mut self,
        error: ImportFailure,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        match error {
            ImportFailure::Outdated => self.schedule_rebase(now, out),
            _ => self.begin_reset(now, doc, false, true, out),
        }
    }

    pub(super) fn chatter(
        &mut self,
        message: ChatterMessage,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        if !self.config.chatter || !self.auth.current {
            return;
        }
        match message {
            ChatterMessage::Update(bytes) => {
                if self
                    .import(&bytes, ImportOrigin::Chatter, now, doc, out)
                    .is_some_and(|i| i.new_ops)
                    && self.effective_access == Access::Edit
                {
                    self.seen_foreign = true;
                    self.append_bytes(bytes, true, doc.oplog_vv(), now, out);
                }
            }
            ChatterMessage::Awareness(bytes) => self.apply_presence(&bytes, now, out),
            ChatterMessage::Closing(_) => {
                self.foreign_writer_closed = true;
                self.load_orphans(now, out);
                self.push_retry = None;
            }
        }
    }

    pub(super) fn schedule_rebase(&mut self, now: Now, out: &mut SyncOutput) {
        if self.rebase_active {
            self.rebase_rerun = true;
            return;
        }
        let earliest = self
            .last_rebase
            .map(|last| last.after(Millis(10_000)))
            .unwrap_or(now.mono);
        self.rebase_due.get_or_insert(earliest.max(now.mono));
        self.event(
            "doc.sync.rebase",
            vec![("cause", AttrValue::String("outdated".into()))],
            out,
        );
    }

    pub(super) fn begin_reset(
        &mut self,
        now: Now,
        doc: &mut impl SyncDoc,
        rebase: bool,
        charged: bool,
        out: &mut SyncOutput,
    ) {
        if self.phase == Phase::Stopped {
            return;
        }
        if self.phase != Phase::Running {
            if self.phase == Phase::Resetting && rebase {
                self.rebase_rerun = true;
            } else {
                self.reset_requested = true;
            }
            return;
        }
        self.append_local(now, doc, out);
        if charged {
            self.reset_times
                .retain(|at| now.mono.0.saturating_sub(at.0) < self.config.reset_budget.window.0);
            if self.reset_times.len() >= usize::from(self.config.reset_budget.max) {
                self.stop(now, doc, None, CloseReason::Corrupt, out);
                return;
            }
            self.reset_times.push_back(now.mono);
        }
        self.reset_requested = false;
        self.rebase_active = rebase;
        if rebase {
            self.last_rebase = Some(now.mono);
            self.rebase_due = None;
        }
        self.reset_span = Some(self.span(
            if rebase {
                "doc.sync.rebase"
            } else {
                "doc.sync.reset"
            },
            None,
            out,
        ));
        self.phase = Phase::Resetting;
        self.reset = Some(ResetState::Flushing {
            deadline: now.mono.after(self.config.timeouts.ack),
            rebase,
        });
        self.push_retry = None;
    }

    pub(super) fn advance_reset(&mut self, now: Now, out: &mut SyncOutput) {
        let Some(ResetState::Flushing { deadline, rebase }) = self.reset else {
            return;
        };
        if self.push.is_some() && now.mono < deadline {
            return;
        }
        if self
            .wal
            .entries
            .iter()
            .any(|e| matches!(e.state, EntryState::Writing(_)))
            && now.mono < deadline
        {
            return;
        }
        self.reset = Some(ResetState::Awaiting { rebase });
        if self.connection.synced() {
            self.request_snapshot(SnapshotPurpose::Reset, now, out);
        }
    }

    pub(super) fn reset_snapshot(
        &mut self,
        snapshot: Vec<u8>,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        let Some(ResetState::Awaiting { rebase }) = self.reset else {
            return;
        };
        self.reset = Some(ResetState::WaitingPeer { rebase, snapshot });
        self.resume_reset(now, doc, out);
    }

    pub(super) fn resume_reset(&mut self, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        let Some(ResetState::WaitingPeer { rebase, .. }) = &self.reset else {
            return;
        };
        let rebase = *rebase;
        let Ok(peer) = self.peers.take() else {
            return;
        };
        let Some(ResetState::WaitingPeer { snapshot, .. }) = self.reset.take() else {
            return;
        };
        self.clear_presence(now, out);
        match doc.replace(&snapshot, peer) {
            Ok(()) => {
                // The old document's dependency queue was replaced. WAL replay
                // below can introduce pending history belonging to the new one.
                self.pending_import = false;
                self.confirmed_base = doc.oplog_vv().get_frontiers();
                self.registered_peers.retain(|p| *p != peer);
                self.registered_peers.insert(0, peer);
                self.presence_key = Some(self.local_presence_key(peer));
                self.event(
                    "peer.assigned",
                    vec![
                        ("peer", AttrValue::U64(peer)),
                        ("purpose", AttrValue::String("reset".into())),
                    ],
                    out,
                );
                self.phase = Phase::Running;
                for entry in &mut self.wal.entries {
                    if entry.park == Some(ParkReason::NeedsRebase) {
                        entry.park = None;
                    }
                }
                self.replay(now, doc, out);
                self.wal.logged_vv = doc.oplog_vv();
                if self.connection.synced() {
                    self.send(
                        sync_protocol::FromPeer::PeerRegisterId { peerid: peer },
                        out,
                    );
                }
                out.events.push(SyncEvent::Replaced);
                self.finish_reset(true, rebase, now, out);
            }
            Err(_) => {
                self.phase = Phase::Running;
                self.finish_reset(false, rebase, now, out);
            }
        }
    }

    pub(super) fn finish_reset(&mut self, ok: bool, rebase: bool, now: Now, out: &mut SyncOutput) {
        self.reset = None;
        self.phase = Phase::Running;
        self.rebase_active = false;
        if let Some(span) = self.reset_span.take() {
            self.end_span(span, if ok { "replaced" } else { "failed" }, !ok, out);
        }
        if rebase && self.rebase_rerun {
            self.rebase_rerun = false;
            self.schedule_rebase(now, out);
        }
    }

    pub(super) fn snapshot_tick(&mut self, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        if self.snapshot_due.is_none_or(|at| at > now.mono) {
            return;
        }
        self.snapshot_due = self.config.snapshot_interval.map(|i| now.mono.after(i));
        if self.seen_foreign
            && self
                .last_orphan_load
                .is_none_or(|at| now.mono.0.saturating_sub(at.0) >= 30_000)
        {
            self.load_orphans(now, out);
        }
        self.append_local(now, doc, out);
        if self.phase != Phase::Running || doc.oplog_vv() == self.snapshot_vv {
            return;
        }
        let dirty_since = *self.snapshot_dirty_since.get_or_insert(now.mono);
        if self
            .last_local
            .is_some_and(|at| now.mono.0.saturating_sub(at.0) < 1_000)
            && now.mono.0.saturating_sub(dirty_since.0) < 30_000
        {
            self.snapshot_due = Some(now.mono.after(Millis(1_000)));
            return;
        }
        self.save_snapshot(now, doc, out);
    }

    pub(super) fn save_snapshot(&mut self, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        if self.config.persistence != Persistence::Durable
            || matches!(self.wal.health, StorageHealth::Failed { .. })
            || self.wal.entries.iter().any(|e| {
                !e.foreign
                    && !e.superseded
                    && !self.is_delivered(e.seq)
                    && !matches!(e.state, EntryState::Logged)
            })
            || self
                .storage
                .values()
                .any(|p| matches!(p.completion, StorageCompletion::Snapshot { .. }))
        {
            return;
        }
        match doc.export_shallow_snapshot(&self.confirmed_base) {
            Ok(bytes) => {
                let span = self.span("doc.snapshot.save", self.load_span, out);
                let covers = self
                    .wal
                    .entries
                    .back()
                    .map(|e| (self.config.session, e.seq));
                self.issue(
                    StorageOp::SnapshotSave {
                        doc: self.config.doc.clone(),
                        bytes,
                        covers,
                    },
                    StorageCompletion::Snapshot {
                        covers,
                        vv: doc.oplog_vv(),
                    },
                    now,
                    out,
                );
                self.end_span(span, "issued", false, out);
            }
            Err(error) => self.event(
                "doc.snapshot.error",
                vec![("error", AttrValue::String(error.to_string()))],
                out,
            ),
        }
    }
}
