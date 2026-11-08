use super::*;

impl SyncCore {
    pub(super) fn request_since(
        &mut self,
        attempt: u8,
        now: Now,
        doc: &impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        if self.phase != Phase::Running || !self.connection.synced() {
            return;
        }
        if let Some(request) = &mut self.convergence {
            request.rerun = true;
            return;
        }
        if attempt > self.config.converge.max_attempts {
            return;
        }
        let vv = doc.oplog_vv().encode();
        self.since.push_back(SinceRequest {
            vv: vv.clone(),
            expired: false,
        });
        self.convergence = Some(Convergence {
            attempt,
            deadline: now.mono.after(self.config.timeouts.request_since),
            rerun: false,
        });
        let parent = if self.has_converged {
            self.connect_span
        } else {
            self.load_span
        };
        self.catchup_span = Some(self.span("doc.sync.catchup", parent, out));
        self.send(
            sync_protocol::FromPeer::PeerRequestSince {
                vv: SliceWrapper::from_cooked(&vv),
            },
            out,
        );
    }

    pub(super) fn since_reply(
        &mut self,
        vv: Vec<u8>,
        update: Vec<u8>,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        let Some(index) = self.since.iter().position(|request| request.vv == vv) else {
            self.event("doc.sync.reply.unmatched", Vec::new(), out);
            return;
        };
        for _ in 0..index {
            self.since.pop_front();
        }
        let Some(request) = self.since.pop_front() else {
            return;
        };
        if request.expired {
            return;
        }
        let Some(convergence) = self.convergence.take() else {
            return;
        };
        let imported = if update.is_empty() {
            Some(Imported {
                changed: false,
                pending: false,
                new_ops: false,
            })
        } else {
            self.import(&update, ImportOrigin::Catchup, now, doc, out)
        };
        let Some(imported) = imported else {
            if let Some(span) = self.catchup_span.take() {
                self.end_span(span, "failed", true, out);
            }
            return;
        };
        if let Some(span) = self.catchup_span.take() {
            self.end_span(
                span,
                if imported.pending {
                    "pending"
                } else {
                    "settled"
                },
                false,
                out,
            );
        }
        if imported.pending {
            if convergence.attempt < self.config.converge.max_attempts {
                self.convergence_retry = Some((
                    convergence.attempt + 1,
                    now.mono.after(self.config.converge.retry_delay),
                ));
            } else {
                self.load_orphans(now, out);
            }
        } else {
            self.has_converged = true;
            self.confirmed_base = doc.oplog_vv().get_frontiers();
            if convergence.rerun {
                self.request_since(1, now, doc, out);
            }
        }
    }

    pub(super) fn request_snapshot(
        &mut self,
        purpose: SnapshotPurpose,
        now: Now,
        out: &mut SyncOutput,
    ) {
        if !self.connection.synced() {
            if let SnapshotPurpose::Host(request) = purpose {
                out.events.push(SyncEvent::Reply {
                    request,
                    reply: Reply::Snapshot(Err(RequestFailure::Disconnected)),
                });
            }
            return;
        }
        if matches!(purpose, SnapshotPurpose::Reset)
            && self
                .snapshots
                .iter()
                .any(|r| !r.expired && matches!(r.purpose, SnapshotPurpose::Reset))
        {
            return;
        }
        self.snapshots.push_back(SnapshotRequest {
            purpose,
            deadline: now.mono.after(self.config.timeouts.snapshot),
            expired: false,
        });
        self.send(sync_protocol::FromPeer::PeerRequestSnapshot {}, out);
    }

    pub(super) fn snapshot_reply(
        &mut self,
        bytes: Vec<u8>,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        let Some(head) = self.snapshots.pop_front() else {
            return;
        };
        if head.expired {
            return;
        }
        let mut waiters = vec![head];
        for pending in &mut self.snapshots {
            if !pending.expired {
                waiters.push(SnapshotRequest {
                    purpose: pending.purpose,
                    deadline: pending.deadline,
                    expired: false,
                });
                // Keep the issued wire slot so its late reply cannot satisfy a new waiter.
                pending.expired = true;
            }
        }
        for waiter in waiters.into_iter().filter(|w| !w.expired) {
            match waiter.purpose {
                SnapshotPurpose::Host(request) => out.events.push(SyncEvent::Reply {
                    request,
                    reply: Reply::Snapshot(Ok(bytes.clone())),
                }),
                SnapshotPurpose::Reset => self.reset_snapshot(bytes.clone(), now, doc, out),
                SnapshotPurpose::Probe => self.probe(&bytes, now, doc, out),
            }
        }
    }

    fn probe(&mut self, snapshot: &[u8], now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        let Some((seq, bytes)) = self
            .wal
            .entries
            .iter()
            .find(|e| !e.superseded && e.park.is_none() && !self.is_delivered(e.seq))
            .map(|e| (e.seq, e.bytes.clone()))
        else {
            return;
        };
        let Ok(peer) = self.peers.take() else {
            return;
        };
        self.event(
            "peer.assigned",
            vec![
                ("peer", AttrValue::U64(peer)),
                ("purpose", AttrValue::String("probe".into())),
            ],
            out,
        );
        match doc.probe_import(snapshot, &bytes, peer) {
            Err(ImportFailure::Loro(_)) => {
                if let Some(entry) = self.wal.entries.iter_mut().find(|e| e.seq == seq) {
                    entry.park = Some(ParkReason::Poison);
                }
                if self.config.persistence == Persistence::Durable {
                    self.issue(
                        StorageOp::WalQuarantine {
                            doc: self.config.doc.clone(),
                            owner: self.config.session,
                            seq,
                        },
                        StorageCompletion::Other,
                        now,
                        out,
                    );
                }
                self.event(
                    "wal.poison",
                    vec![
                        ("seq", AttrValue::U64(seq.0)),
                        (
                            "bytes",
                            AttrValue::U64(u64::try_from(bytes.len()).unwrap_or(u64::MAX)),
                        ),
                    ],
                    out,
                );
                self.waiting_for_fresh_ack = true;
                self.begin_reset(now, doc, false, true, out);
            }
            Ok(Imported { pending: true, .. }) => self.load_orphans(now, out),
            _ => {}
        }
    }

    pub(super) fn publish_comment(
        &mut self,
        request: RequestId,
        update: Vec<u8>,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        let refusal = if !self.auth.current || !(self.auth.can_comment || self.auth.can_write) {
            Some(CommentRefusal::Unauthorized)
        } else if !self.connection.synced() {
            Some(CommentRefusal::CatchupFailed)
        } else {
            None
        };
        if let Some(reason) = refusal {
            out.events.push(SyncEvent::Reply {
                request,
                reply: Reply::Comment(CommentReply::Refused(reason)),
            });
            return;
        }
        self.append_local(now, doc, out);
        if doc.oplog_vv() != self.wal.logged_vv
            || self
                .wal
                .entries
                .iter()
                .any(|e| !e.foreign && !e.superseded && !self.is_delivered(e.seq))
        {
            out.events.push(SyncEvent::Reply {
                request,
                reply: Reply::Comment(CommentReply::Refused(CommentRefusal::LocalChangesPending)),
            });
            return;
        }
        let id = self.message_id();
        self.send(
            sync_protocol::FromPeer::PeerCommentUpdate {
                updates: vec![SliceWrapper::from_cooked(&update)],
                id: id.as_str(),
            },
            out,
        );
        self.comments.push(CommentRequest {
            id,
            request,
            bytes: update,
            deadline: now.mono.after(self.config.timeouts.ack),
        });
    }

    pub(super) fn expire_requests(
        &mut self,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        if self.push.as_ref().is_some_and(|p| p.deadline <= now.mono) {
            self.push_failed(now, out);
        }
        if self
            .convergence
            .as_ref()
            .is_some_and(|p| p.deadline <= now.mono)
        {
            if let Some(request) = self.convergence.take() {
                if let Some(entry) = self.since.iter_mut().rev().find(|e| !e.expired) {
                    entry.expired = true;
                }
                if request.attempt < self.config.converge.max_attempts {
                    self.convergence_retry = Some((
                        request.attempt + 1,
                        now.mono.after(self.config.converge.retry_delay),
                    ));
                }
            }
            if let Some(span) = self.catchup_span.take() {
                self.end_span(span, "timeout", true, out);
            }
        }
        let mut reset_timed_out = false;
        for waiter in &mut self.snapshots {
            if !waiter.expired && waiter.deadline <= now.mono {
                waiter.expired = true;
                match waiter.purpose {
                    SnapshotPurpose::Host(request) => out.events.push(SyncEvent::Reply {
                        request,
                        reply: Reply::Snapshot(Err(RequestFailure::Timeout)),
                    }),
                    SnapshotPurpose::Reset => reset_timed_out = true,
                    SnapshotPurpose::Probe => {}
                }
            }
        }
        if reset_timed_out {
            self.finish_reset(false, self.rebase_active, now, out);
        }
        let mut pending = Vec::new();
        for comment in self.comments.drain(..) {
            if comment.deadline <= now.mono {
                out.events.push(SyncEvent::Reply {
                    request: comment.request,
                    reply: Reply::Comment(CommentReply::NotAcked),
                });
            } else {
                pending.push(comment);
            }
        }
        self.comments = pending;
        let _ = doc;
    }
}
