use super::*;

impl SyncCore {
    pub(super) fn drive(&mut self, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        if let Some(ResetState::WaitingPeer { .. }) = &self.reset
            && !self.peers.is_empty()
        {
            self.resume_reset(now, doc, out);
        }
        self.replay_assistance(now, doc, out);
        self.resume_server_backed_gaps(doc, out);
        self.push_rows(now, out);
        self.push_assist(now, out);
        self.advance_reset(now, out);
        self.finish_flushes(now, out);
        self.flush_presence(now, doc, out);
    }

    pub(super) fn tick(&mut self, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        let was_live = self.connection.opened();
        if self.config.transport == TransportKind::Direct {
            self.connection.tick(now, &mut out.io);
        }
        if self.connect_span.is_none()
            && matches!(
                self.connection.state,
                Connection::Authorizing { .. } | Connection::Connecting { .. }
            )
        {
            self.connect_span = Some(self.span("doc.sync.connect", self.load_span, out));
        }
        if was_live && !self.connection.opened() {
            self.disconnected(now, out);
        }
        self.expire_storage(now, doc, out);
        self.expire_requests(now, doc, out);
        if self.wal.append_due.is_some_and(|at| at <= now.mono) {
            self.append_local(now, doc, out);
        }
        if self.load_retry.is_some_and(|at| at <= now.mono) {
            self.load_retry = None;
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
        if self.seed_wait_deadline.is_some_and(|at| at <= now.mono) {
            self.seed_wait_deadline = None;
            if let Some(bytes) = self.deferred_seed.take() {
                self.seed(SeedKind::Remote, bytes, now, doc, out);
            }
        }
        if let Some((attempt, at)) = self.convergence_retry
            && at <= now.mono
        {
            self.convergence_retry = None;
            self.request_since(attempt, now, doc, out);
        }
        if self.rebase_due.is_some_and(|at| at <= now.mono)
            && self.phase == Phase::Running
            && self.connection.synced()
            && self.push.is_none()
        {
            self.rebase_due = None;
            self.begin_reset(now, doc, true, false, out);
        }
        self.snapshot_tick(now, doc, out);
        if self.not_acked >= 20
            && self.push_retry.is_some_and(|at| at <= now.mono)
            && self
                .last_probe
                .is_none_or(|at| now.mono.0.saturating_sub(at.0) >= 600_000)
        {
            self.last_probe = Some(now.mono);
            self.request_snapshot(SnapshotPurpose::Probe, now, out);
        }
        if self
            .assist_push
            .as_ref()
            .is_some_and(|p| p.deadline <= now.mono)
        {
            self.assist_push = None;
            self.assist_retry = Some(now.mono.after(self.config.wal.retry_unacked_after));
        }
        // A due retry is a one-shot trigger. If transport or authorization still
        // blocks the push, the next host/socket input drives it; keeping this
        // expired deadline would make the executor schedule Tick forever at now.
        if self.push_retry.is_some_and(|at| at <= now.mono) {
            self.push_retry = None;
        }
        if self.assist_retry.is_some_and(|at| at <= now.mono) {
            self.assist_retry = None;
        }
        if self.presence_refresh.is_some_and(|at| at <= now.mono) {
            self.presence_dirty = true;
            self.presence_due = Some(now.mono);
        }
        self.expire_presence(now, out);
    }

    pub(super) fn authorize(
        &mut self,
        auth: AuthorizationState,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        self.auth = auth;
        if !auth.current {
            self.stop(now, doc, None, CloseReason::Unauthorized, out);
            return;
        }
        let access = match self.config.access {
            Access::Read => Access::Read,
            Access::CommentOnly => {
                if auth.can_comment || auth.can_write {
                    Access::CommentOnly
                } else {
                    Access::Read
                }
            }
            Access::Edit if auth.can_write => Access::Edit,
            Access::Edit if auth.can_comment => Access::CommentOnly,
            Access::Edit => Access::Read,
        };
        if access != self.effective_access {
            self.effective_access = access;
            out.events.push(SyncEvent::AccessChanged(access));
        }
        if auth.can_write
            && access == Access::Edit
            && self.connection.synced()
            && self.connection.access != WriteAccess::Full
        {
            if self.config.transport == TransportKind::Routed {
                out.io.push(IoEffect::RouteReconnect {
                    doc: self.config.doc.clone(),
                });
            } else if let Some(conn) = self.connection.conn() {
                out.io.push(IoEffect::SocketClose {
                    conn,
                    code: 1000,
                    reason: CloseCause::Superseded,
                });
            }
            self.disconnected(now, out);
            if self.config.transport == TransportKind::Direct {
                self.connection.start(now, true, &mut out.io);
            }
        }
    }

    pub(super) fn stop(
        &mut self,
        now: Now,
        doc: &mut impl SyncDoc,
        request: Option<RequestId>,
        reason: CloseReason,
        out: &mut SyncOutput,
    ) {
        self.append_local(now, doc, out);
        self.local_presence = None;
        self.presence_dirty = true;
        self.presence_due = Some(now.mono);
        self.flush_presence(now, doc, out);
        self.stop_barrier
            .extend(self.storage.iter().filter_map(|(id, p)| {
                matches!(p.completion, StorageCompletion::Append { .. }).then_some(*id)
            }));
        self.stop_request = request;
        self.disconnected(now, out);
        if self.config.transport == TransportKind::Routed {
            out.io.push(IoEffect::RouteDetach {
                doc: self.config.doc.clone(),
            });
            self.connection.state = Connection::Closed(reason.clone());
        } else {
            self.connection.close(reason.clone(), &mut out.io);
        }
        self.phase = Phase::Stopped;
        if reason != CloseReason::Stopped {
            self.effective_access = Access::Read;
            out.events.push(SyncEvent::AccessChanged(Access::Read));
        }
    }

    pub(super) fn finish_stop(&mut self, out: &mut SyncOutput) {
        if self.phase == Phase::Stopped
            && self.stop_barrier.is_empty()
            && let Some(request) = self.stop_request.take()
        {
            out.events.push(SyncEvent::Reply {
                request,
                reply: Reply::Stopped,
            });
        }
    }

    /// Whether a retained WAL row has received an acknowledgement, including rows
    /// above a prefix blocked by another parked row. Pruned rows are no longer retained.
    pub fn is_delivered(&self, seq: WalSeq) -> bool {
        self.delivered.contains(&seq)
    }
    pub(super) fn park_reason(&self, entry: &WalEntry) -> Option<ParkReason> {
        entry
            .park
            .or_else(|| (self.effective_access != Access::Edit).then_some(ParkReason::ReadOnly))
    }

    pub(super) fn update_status(&mut self, out: &mut SyncOutput) {
        let connection = match &self.connection.state {
            Connection::Synced { .. } => ConnectionStatus::Connected,
            Connection::Authorizing { .. }
            | Connection::Connecting { .. }
            | Connection::AwaitingInitialSync { .. } => ConnectionStatus::Connecting,
            Connection::GaveUp { .. } => ConnectionStatus::Offline,
            Connection::Closed(reason) => ConnectionStatus::Closed(reason.clone()),
            _ => ConnectionStatus::Disconnected,
        };
        let parked = self.parked();
        let save = if parked.iter().any(|(_, r)| *r == ParkReason::Poison) {
            SaveState::Unsaved(UnsavedReason::Poison)
        } else if parked.iter().any(|(_, r)| *r == ParkReason::Gap) {
            SaveState::Unsaved(UnsavedReason::Gap)
        } else if self.rebase_due.is_some()
            || self.rebase_active
            || parked.iter().any(|(_, r)| *r == ParkReason::NeedsRebase)
        {
            SaveState::Unsaved(UnsavedReason::Rebasing)
        } else if !parked.is_empty() {
            SaveState::Unsaved(UnsavedReason::ReadOnly)
        } else if matches!(self.wal.health, StorageHealth::Failed { .. }) {
            SaveState::Unsaved(UnsavedReason::Storage)
        } else if self
            .wal
            .entries
            .iter()
            .any(|e| !self.is_delivered(e.seq) && !e.superseded)
            || self.wal.append_due.is_some()
            || self.pending_import
            || !self.assist_replay.is_empty()
            || self.waiting_for_fresh_ack
            || (!self.assist.is_empty() && self.effective_access == Access::Edit)
        {
            if self.push.is_some()
                || self
                    .wal
                    .entries
                    .iter()
                    .any(|e| matches!(e.state, EntryState::Writing(_)))
            {
                SaveState::Saving
            } else {
                SaveState::Unsaved(UnsavedReason::Undelivered)
            }
        } else {
            SaveState::Saved
        };
        let status = SyncStatus {
            connection,
            save,
            pending_import: self.pending_import,
        };
        if status != self.status {
            self.status = status.clone();
            out.events.push(SyncEvent::Status(status));
        }
    }

    pub(super) fn wake_at(&self) -> Option<Millis> {
        if self.phase == Phase::Stopped {
            return self.storage.values().map(|p| p.deadline).min();
        }
        let mut deadlines = vec![
            if self.config.transport == TransportKind::Direct {
                self.connection.wake_at()
            } else {
                None
            },
            self.wal.append_due,
            self.push.as_ref().map(|p| p.deadline),
            self.push_retry,
            self.assist_push.as_ref().map(|p| p.deadline),
            self.assist_retry,
            self.convergence.as_ref().map(|p| p.deadline),
            self.convergence_retry.map(|(_, at)| at),
            self.snapshot_due,
            self.load_retry,
            self.seed_wait_deadline,
            self.rebase_due.filter(|_| {
                self.phase == Phase::Running && self.connection.synced() && self.push.is_none()
            }),
        ];
        if self.presence.is_some() {
            deadlines.extend([
                self.presence_due,
                self.presence_refresh,
                self.presence
                    .as_ref()
                    .and_then(|p| p.next_expiry())
                    .map(|wall| {
                        self.now.mono.after(Millis(
                            u64::try_from(wall.0.saturating_sub(self.now.wall.0)).unwrap_or(0),
                        ))
                    }),
            ]);
        }
        deadlines.extend(self.storage.values().map(|p| Some(p.deadline)));
        deadlines.extend(
            self.snapshots
                .iter()
                .filter(|p| !p.expired)
                .map(|p| Some(p.deadline)),
        );
        deadlines.extend(self.comments.iter().map(|p| Some(p.deadline)));
        deadlines.extend(self.flushes.iter().map(|(_, at)| Some(*at)));
        if let Some(ResetState::Flushing { deadline, .. }) = self.reset {
            deadlines.push(Some(deadline));
        }
        deadlines.into_iter().flatten().min()
    }
}
