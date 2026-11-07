use super::*;

const PUSH_BYTES: usize = 256 * 1024;
const PUSH_ROWS: usize = 64;

impl SyncCore {
    pub(super) fn append_local(&mut self, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        if self.config.access != Access::Edit || !self.seeded {
            return;
        }
        let failed = self.wal.entries.iter().find(|entry| {
            matches!(entry.state, EntryState::Unlogged { .. })
                && loro::LoroDoc::decode_import_blob_meta(&entry.bytes, true)
                    .is_ok_and(|meta| meta.partial_end_vv.get(&doc.peer_id()).is_some())
                && !entry.superseded
                && !self.is_delivered(entry.seq)
        });
        let since = failed
            .map(|e| e.vv_before.clone())
            .unwrap_or_else(|| self.wal.logged_vv.clone());
        let failed_seq = failed.map(|e| e.seq);
        if failed_seq.is_some_and(|seq| {
            self.wal
                .entries
                .iter()
                .any(|e| e.seq >= seq && matches!(e.state, EntryState::Writing(_)))
        }) {
            self.wal.append_due = Some(now.mono.after(self.config.wal.coalesce));
            return;
        }
        match doc.export_local(&since) {
            Ok(Some(bytes)) if !bytes.is_empty() => {
                let replaced: Vec<_> = self
                    .wal
                    .entries
                    .iter()
                    .filter(|e| {
                        failed_seq.is_some_and(|seq| e.seq >= seq)
                            && !e.foreign
                            && update_covers(&bytes, &e.bytes)
                            && !self.is_delivered(e.seq)
                    })
                    .map(|e| e.seq)
                    .collect();
                let seq = self.append_bytes(bytes, false, since, now, out);
                if !replaced.is_empty() {
                    if self.config.persistence == Persistence::Memory {
                        for e in &mut self.wal.entries {
                            if replaced.contains(&e.seq) {
                                e.superseded = true;
                            }
                        }
                    } else {
                        self.supersedes.insert(seq, replaced);
                    }
                }
                self.wal.logged_vv = doc.oplog_vv();
                self.wal.append_due = None;
                self.push_retry = None;
            }
            Ok(_) => {
                self.wal.append_due = None;
            }
            Err(error) => {
                self.event(
                    "wal.export.error",
                    vec![("error", AttrValue::String(error.to_string()))],
                    out,
                );
                self.wal.append_due = Some(now.mono.after(self.config.wal.coalesce));
            }
        }
    }

    pub(super) fn append_bytes(
        &mut self,
        bytes: Vec<u8>,
        foreign: bool,
        vv_before: loro::VersionVector,
        now: Now,
        out: &mut SyncOutput,
    ) -> WalSeq {
        let seq = self.wal.next_seq;
        self.wal.next_seq = WalSeq(seq.0.saturating_add(1));
        let record = WalRecord {
            seq,
            created_at: now.wall,
            user: self.config.user.clone(),
            foreign,
            quarantined: false,
            bytes: bytes.clone(),
        };
        let state = if self.config.persistence == Persistence::Durable {
            let id = self.issue(
                StorageOp::WalAppend {
                    doc: self.config.doc.clone(),
                    owner: self.config.session,
                    record,
                    retry: false,
                },
                StorageCompletion::Append { seq },
                now,
                out,
            );
            EntryState::Writing(id)
        } else {
            EntryState::Logged
        };
        if foreign && let Ok(meta) = loro::LoroDoc::decode_import_blob_meta(&bytes, true) {
            self.foreign_versions.insert(seq, meta.partial_end_vv);
        }
        self.wal.entries.push_back(WalEntry {
            seq,
            created_at: now.wall,
            foreign,
            bytes: Arc::from(bytes),
            state,
            not_acked: 0,
            vv_before,
            park: None,
            superseded: false,
        });
        seq
    }

    pub(super) fn push_rows(&mut self, now: Now, out: &mut SyncOutput) {
        if self.phase == Phase::Loading
            || self.phase == Phase::Created
            || self.push.is_some()
            || !self.can_push()
            || self.push_retry.is_some_and(|at| now.mono < at)
        {
            return;
        }
        let mut bytes = 0usize;
        let mut updates: Vec<Arc<[u8]>> = Vec::new();
        let mut rows = Vec::new();
        for entry in &self.wal.entries {
            if entry.superseded
                || self.is_delivered(entry.seq)
                || entry.park.is_some_and(|p| p != ParkReason::NeedsRebase)
            {
                continue;
            }
            if matches!(entry.state, EntryState::Writing(_)) {
                break;
            }
            if entry.foreign
                && now.wall.0.saturating_sub(entry.created_at.0)
                    < i64::try_from(self.config.wal.retry_unacked_after.0).unwrap_or(i64::MAX)
                && !self.foreign_writer_closed
            {
                break;
            }
            if !updates.is_empty()
                && (updates.len() >= PUSH_ROWS
                    || bytes.saturating_add(entry.bytes.len()) > PUSH_BYTES)
            {
                break;
            }
            bytes = bytes.saturating_add(entry.bytes.len());
            updates.push(entry.bytes.clone());
            rows.push(entry.seq);
        }
        if rows.is_empty() {
            return;
        }
        let id = self.message_id();
        let message = sync_protocol::FromPeer::PeerUpdate {
            updates: updates
                .iter()
                .map(|u| SliceWrapper::from_cooked(u))
                .collect(),
            id: id.as_str(),
        };
        self.send(message, out);
        self.push = Some(Push {
            id,
            rows,
            deadline: now.mono.after(self.config.timeouts.ack),
        });
        self.push_retry = None;
    }

    pub(super) fn can_push(&self) -> bool {
        self.connection.synced()
            && self.connection.access == WriteAccess::Full
            && self.auth.current
            && self.auth.can_write
            && self.effective_access == Access::Edit
    }

    pub(super) fn ack(&mut self, id: &str, now: Now, doc: &mut impl SyncDoc, out: &mut SyncOutput) {
        if self
            .assist_push
            .as_ref()
            .is_some_and(|p| p.id.as_str() == id)
        {
            if let Some(push) = self.assist_push.take() {
                self.assist.drain(..push.count);
            }
            self.assist_retry = None;
            return;
        }
        if let Some(index) = self.comments.iter().position(|p| p.id.as_str() == id) {
            let comment = self.comments.remove(index);
            if self
                .import(&comment.bytes, ImportOrigin::CommentEcho, now, doc, out)
                .is_some()
            {
                out.events.push(SyncEvent::Reply {
                    request: comment.request,
                    reply: Reply::Comment(CommentReply::Accepted),
                });
            } else {
                out.events.push(SyncEvent::Reply {
                    request: comment.request,
                    reply: Reply::Comment(CommentReply::NotAcked),
                });
            }
            return;
        }
        if self.push.as_ref().is_none_or(|p| p.id.as_str() != id) {
            return;
        }
        let Some(push) = self.push.take() else {
            return;
        };
        for entry in &mut self.wal.entries {
            if push.rows.contains(&entry.seq)
                && entry.park.is_none_or(|p| p == ParkReason::NeedsRebase)
            {
                self.delivered.insert(entry.seq);
                entry.not_acked = 0;
                if entry.park == Some(ParkReason::NeedsRebase) {
                    entry.park = None;
                }
            }
        }
        self.mark_delivered_prefix(now, out);
        self.delivery_confirmed(out);
    }

    fn delivery_confirmed(&mut self, out: &mut SyncOutput) {
        self.not_acked = 0;
        self.suspect_delay = Millis(5_000);
        self.waiting_for_fresh_ack = false;
        self.push_retry = None;
        if let Some(span) = self.outage_span.take() {
            self.end_span(span, "delivered", false, out);
        }
    }

    pub(super) fn push_failed(&mut self, now: Now, out: &mut SyncOutput) {
        let Some(push) = self.push.take() else {
            return;
        };
        for entry in &mut self.wal.entries {
            if push.rows.contains(&entry.seq) && !self.delivered.contains(&entry.seq) {
                entry.not_acked = entry.not_acked.saturating_add(1);
            }
        }
        self.not_acked = self.not_acked.saturating_add(1);
        if self.outage_span.is_none() {
            self.outage_span = Some(self.span("wal.delivery_outage", self.connect_span, out));
        }
        let delay = if self.not_acked >= 20 {
            self.event(
                "wal.delivery_outage.suspect",
                vec![("attempts", AttrValue::U64(u64::from(self.not_acked)))],
                out,
            );
            let delay = self.suspect_delay;
            self.suspect_delay = Millis(self.suspect_delay.0.saturating_mul(2).min(300_000));
            delay
        } else {
            self.config.wal.retry_unacked_after
        };
        self.push_retry = Some(now.mono.after(delay));
    }

    pub(super) fn server_evidence(&mut self, bytes: &[u8], now: Now, out: &mut SyncOutput) {
        let Ok(meta) = loro::LoroDoc::decode_import_blob_meta(bytes, true) else {
            return;
        };
        self.server_vv.merge(&meta.partial_end_vv);
        for (seq, vv) in &self.foreign_versions {
            if self.server_vv.includes_vv(vv) {
                self.delivered.insert(*seq);
            }
        }
        self.mark_delivered_prefix(now, out);
        // A broadcast/catchup can prove a foreign row delivered before this
        // socket receives its push ack. Keep only still-unconfirmed rows in
        // flight, so retries and diagnostics cannot cross the delivered prefix.
        if let Some(mut push) = self.push.take() {
            push.rows.retain(|seq| !self.is_delivered(*seq));
            if push.rows.is_empty() {
                // Server evidence proves every row in this push persisted,
                // completing delivery even if its redundant ack was lost.
                self.delivery_confirmed(out);
            } else {
                self.push = Some(push);
            }
        }
    }

    fn mark_delivered_prefix(&mut self, now: Now, out: &mut SyncOutput) {
        // Persist only a contiguous prefix; never claim an omitted foreign row was delivered.
        let mut through = self.wal.delivered_through;
        for entry in &self.wal.entries {
            if entry.superseded {
                continue;
            }
            if !self.is_delivered(entry.seq) {
                break;
            }
            through = Some(entry.seq);
        }
        if through != self.wal.delivered_through {
            self.wal.delivered_through = through;
            if let Some(through) =
                through.filter(|_| self.config.persistence == Persistence::Durable)
            {
                self.issue(
                    StorageOp::WalMarkDelivered {
                        doc: self.config.doc.clone(),
                        owner: self.config.session,
                        through,
                    },
                    StorageCompletion::Mark { through },
                    now,
                    out,
                );
            }
        }
    }

    pub(super) fn push_assist(&mut self, now: Now, out: &mut SyncOutput) {
        if !self.can_push()
            || self.assist.is_empty()
            || self.assist_push.is_some()
            || self.assist_retry.is_some_and(|at| at > now.mono)
        {
            return;
        }
        let id = self.message_id();
        let mut bytes = 0usize;
        let updates: Vec<_> = self
            .assist
            .iter()
            .take(PUSH_ROWS)
            .take_while(|r| {
                let accept = bytes == 0 || bytes.saturating_add(r.record.bytes.len()) <= PUSH_BYTES;
                if accept {
                    bytes = bytes.saturating_add(r.record.bytes.len());
                }
                accept
            })
            .map(|r| SliceWrapper::from_cooked(r.record.bytes.as_slice()))
            .collect();
        let count = updates.len();
        let message = sync_protocol::FromPeer::PeerUpdate {
            updates,
            id: id.as_str(),
        };
        let mut encoded = Vec::new();
        if message.serialize(&mut encoded).is_ok()
            && let Some(conn) = self.connection.conn()
        {
            for frame in sync_protocol::framing::into_frames(
                &encoded,
                sync_protocol::framing::MAX_CHUNK_SIZE,
            ) {
                out.io.push(IoEffect::SocketSend { conn, frame });
            }
            self.assist_push = Some(AssistPush {
                id,
                count,
                deadline: now.mono.after(self.config.timeouts.ack),
            });
        }
    }

    pub(super) fn finish_flushes(&mut self, now: Now, out: &mut SyncOutput) {
        let undelivered = self
            .wal
            .entries
            .iter()
            .filter(|e| !self.is_delivered(e.seq) && !e.superseded)
            .count();
        let writing = self
            .wal
            .entries
            .iter()
            .any(|e| matches!(e.state, EntryState::Writing(_)));
        let all_parked = undelivered > 0
            && self
                .wal
                .entries
                .iter()
                .filter(|e| !self.is_delivered(e.seq) && !e.superseded)
                .all(|e| self.park_reason(e).is_some());
        let mut pending = Vec::new();
        for (request, deadline) in std::mem::take(&mut self.flushes) {
            let reply = if all_parked {
                Some(FlushReply::NotDrained {
                    undelivered: u32::try_from(undelivered).unwrap_or(u32::MAX),
                })
            } else if self.effective_access != Access::Edit {
                Some(FlushReply::ReadOnly)
            } else if self.config.transport == TransportKind::None
                && !writing
                && self.wal.append_due.is_none()
            {
                Some(FlushReply::Drained)
            } else if self.config.transport != TransportKind::None && !self.connection.synced() {
                Some(FlushReply::Offline)
            } else if undelivered == 0
                && !writing
                && self.wal.append_due.is_none()
                && !self.pending_import
                && !self.rebase_active
                && self.rebase_due.is_none()
            {
                Some(FlushReply::Drained)
            } else if now.mono >= deadline {
                Some(FlushReply::NotDrained {
                    undelivered: u32::try_from(undelivered).unwrap_or(u32::MAX),
                })
            } else {
                None
            };
            if let Some(reply) = reply {
                out.events.push(SyncEvent::Reply {
                    request,
                    reply: Reply::Flush(reply),
                });
            } else {
                pending.push((request, deadline));
            }
        }
        self.flushes = pending;
    }
}

// A newer current-peer export cannot supersede adopted bytes from another peer.
fn update_covers(new: &[u8], old: &[u8]) -> bool {
    let Ok(new) = loro::LoroDoc::decode_import_blob_meta(new, true) else {
        return false;
    };
    let Ok(old) = loro::LoroDoc::decode_import_blob_meta(old, true) else {
        return false;
    };
    old.partial_end_vv.iter().all(|(peer, end)| {
        new.partial_end_vv
            .get(peer)
            .is_some_and(|new_end| new_end >= end)
            && new.partial_start_vv.get(peer).copied().unwrap_or(0)
                <= old.partial_start_vv.get(peer).copied().unwrap_or(0)
    })
}
