use super::*;

impl SyncCore {
    pub(super) fn issue(
        &mut self,
        op: StorageOp,
        completion: StorageCompletion,
        now: Now,
        out: &mut SyncOutput,
    ) -> StorageOpId {
        self.next_storage = self.next_storage.saturating_add(1);
        let id = StorageOpId(self.next_storage);
        self.storage.insert(
            id,
            PendingStorage {
                op: op.clone(),
                deadline: now.mono.after(self.config.timeouts.storage),
                completion,
            },
        );
        out.io.push(IoEffect::Storage { id, op });
        id
    }

    pub(super) fn load_orphans(&mut self, now: Now, out: &mut SyncOutput) {
        if self.config.persistence != Persistence::Durable
            || self.phase == Phase::Created
            || self.phase == Phase::Stopped
            || self
                .storage
                .values()
                .any(|p| matches!(p.completion, StorageCompletion::Orphans))
        {
            return;
        }
        self.last_orphan_load = Some(now.mono);
        self.issue(
            StorageOp::LoadOrphans {
                doc: self.config.doc.clone(),
                owner: self.config.session,
                user: self.config.user.clone(),
            },
            StorageCompletion::Orphans,
            now,
            out,
        );
    }

    pub(super) fn storage_event(
        &mut self,
        event: StorageEvent,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        let id = match &event {
            StorageEvent::Loaded { id, .. }
            | StorageEvent::Done { id, .. }
            | StorageEvent::Adopted { id, .. } => *id,
        };
        let valid = self.storage.get(&id).is_some_and(|p| {
            matches!(
                (&p.completion, &event),
                (
                    StorageCompletion::Load | StorageCompletion::Orphans,
                    StorageEvent::Loaded { .. }
                ) | (
                    StorageCompletion::Adopt { .. },
                    StorageEvent::Adopted { .. }
                )
            ) || (!matches!(
                p.completion,
                StorageCompletion::Load
                    | StorageCompletion::Orphans
                    | StorageCompletion::Adopt { .. }
            ) && matches!(event, StorageEvent::Done { .. }))
        });
        if !valid {
            return;
        }
        let Some(pending) = self.storage.remove(&id) else {
            return;
        };
        let was_stop = self.stop_barrier.remove(&id);
        match event {
            StorageEvent::Loaded {
                result: Ok(local), ..
            } => {
                if matches!(pending.completion, StorageCompletion::Load) {
                    self.local_loading = false;
                }
                self.load_retry = None;
                if !self
                    .wal
                    .entries
                    .iter()
                    .any(|e| matches!(e.state, EntryState::Unlogged { .. }))
                {
                    self.wal.health = StorageHealth::Ok;
                }
                if self.phase != Phase::Stopped {
                    self.loaded(local, now, doc, out);
                }
            }
            StorageEvent::Adopted {
                result: Ok(count), ..
            } => {
                if let StorageCompletion::Adopt { first, records } = pending.completion {
                    for (offset, stored) in records
                        .into_iter()
                        .take(usize::try_from(count).unwrap_or(usize::MAX))
                        .enumerate()
                    {
                        let seq = WalSeq(
                            first
                                .0
                                .saturating_add(u64::try_from(offset).unwrap_or(u64::MAX)),
                        );
                        if stored.delivered {
                            self.delivered.insert(seq);
                        }
                        let quarantined = stored.record.quarantined;
                        self.wal.entries.push_back(WalEntry {
                            seq,
                            created_at: stored.record.created_at,
                            foreign: stored.record.foreign,
                            bytes: Arc::from(stored.record.bytes),
                            state: EntryState::Logged,
                            not_acked: 0,
                            vv_before: loro::VersionVector::default(),
                            park: quarantined.then_some(ParkReason::Poison),
                            superseded: false,
                        });
                    }
                    self.wal.entries.make_contiguous().sort_by_key(|e| e.seq);
                    if self.seeded && self.phase != Phase::Stopped {
                        self.replay(now, doc, out);
                    }
                }
            }
            StorageEvent::Done { result: Ok(()), .. } => match pending.completion {
                StorageCompletion::Append { seq } => {
                    let mut chatter = None;
                    if let Some(entry) = self.wal.entries.iter_mut().find(|e| e.seq == seq) {
                        entry.state = EntryState::Logged;
                        if !entry.foreign && self.config.chatter && self.auth.current {
                            chatter = Some(entry.bytes.to_vec());
                        }
                    }
                    if let Some(bytes) = chatter {
                        out.io
                            .push(IoEffect::ChatterPost(ChatterMessage::Update(bytes)));
                    }
                    if let Some(replaced) = self.supersedes.remove(&seq) {
                        for entry in &mut self.wal.entries {
                            if replaced.contains(&entry.seq) {
                                entry.superseded = true;
                            }
                        }
                    }
                    if !self.wal.entries.iter().any(|e| {
                        !e.superseded
                            && !self.delivered.contains(&e.seq)
                            && matches!(e.state, EntryState::Unlogged { .. })
                    }) {
                        self.wal.health = StorageHealth::Ok;
                    }
                    self.push_retry = None;
                }
                StorageCompletion::Snapshot { covers, vv } => {
                    self.snapshot_vv = vv;
                    self.snapshot_dirty_since = None;
                    if let (Some((_, cover)), Some(delivered)) =
                        (covers, self.wal.delivered_through)
                    {
                        let through = cover.min(delivered);
                        self.issue(
                            StorageOp::WalPrune {
                                doc: self.config.doc.clone(),
                                owner: self.config.session,
                                through,
                            },
                            StorageCompletion::Prune { through },
                            now,
                            out,
                        );
                    }
                }
                StorageCompletion::Prune { through } => {
                    self.wal.entries.retain(|e| {
                        e.seq > through || e.park.is_some() || !self.delivered.contains(&e.seq)
                    });
                    self.delivered.retain(|seq| *seq > through);
                    self.foreign_versions.retain(|seq, _| *seq > through);
                }
                StorageCompletion::Mark { through } => {
                    let _ = through;
                }
                _ => {}
            },
            StorageEvent::Done {
                result: Err(error), ..
            }
            | StorageEvent::Loaded {
                result: Err(error), ..
            }
            | StorageEvent::Adopted {
                result: Err(error), ..
            } => {
                if matches!(pending.completion, StorageCompletion::Load) {
                    self.local_loading = false;
                    self.load_retry = Some(now.mono.after(self.config.converge.retry_delay));
                    if let Some(bytes) = self.deferred_seed.take() {
                        self.seed_wait_deadline = None;
                        self.seed(SeedKind::Remote, bytes, now, doc, out);
                    }
                }
                if error == StorageFailure::Uncertain
                    && matches!(pending.completion, StorageCompletion::Append { .. })
                {
                    if let StorageOp::WalAppend {
                        mut record,
                        doc,
                        owner,
                        ..
                    } = pending.op
                    {
                        let seq = record.seq;
                        record.quarantined = self
                            .wal
                            .entries
                            .iter()
                            .find(|e| e.seq == seq)
                            .is_some_and(|e| e.park == Some(ParkReason::Poison));
                        let next = self.issue(
                            StorageOp::WalAppend {
                                doc,
                                owner,
                                record,
                                retry: true,
                            },
                            StorageCompletion::Append { seq },
                            now,
                            out,
                        );
                        if let Some(entry) = self.wal.entries.iter_mut().find(|e| e.seq == seq) {
                            entry.state = EntryState::Writing(next);
                        }
                        if was_stop {
                            self.stop_barrier.insert(next);
                        }
                    }
                } else {
                    if let StorageCompletion::Append { seq } = pending.completion
                        && let Some(entry) = self.wal.entries.iter_mut().find(|e| e.seq == seq)
                    {
                        let failures = match entry.state {
                            EntryState::Unlogged { failures } => failures.saturating_add(1),
                            _ => 1,
                        };
                        entry.state = EntryState::Unlogged { failures };
                    }
                    if matches!(self.wal.health, StorageHealth::Ok) {
                        self.event(
                            "wal.storage.error",
                            vec![("reason", AttrValue::String(error.to_string()))],
                            out,
                        );
                    }
                    self.wal.health = StorageHealth::Failed { since: now.mono };
                }
            }
        }
    }

    pub(super) fn loaded(
        &mut self,
        mut local: LocalState,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        let snapshot = local.snapshot.take().filter(|s| !s.bytes.is_empty());
        if !self.seeded {
            if let Some(snapshot) = &snapshot {
                self.seed(SeedKind::Local, snapshot.bytes.clone(), now, doc, out);
            }
            if !self.seeded
                && let Some(bytes) = self.deferred_seed.take()
            {
                self.seed_wait_deadline = None;
                self.seed(SeedKind::Remote, bytes, now, doc, out);
            }
        }
        let before = UnixMillis(
            now.wall
                .0
                .saturating_sub(i64::try_from(self.config.wal.ttl.0).unwrap_or(i64::MAX)),
        );
        for mut orphan in local.orphans {
            orphan.records.sort_by_key(|r| r.record.seq);
            let expired = orphan
                .records
                .iter()
                .any(|r| !r.delivered && r.record.created_at < before);
            if expired {
                self.issue(
                    StorageOp::WalDropExpired {
                        doc: self.config.doc.clone(),
                        from: orphan.owner,
                        before,
                    },
                    StorageCompletion::Other,
                    now,
                    out,
                );
                self.event(
                    "wal.expired",
                    vec![("reason", AttrValue::String("ttl".into()))],
                    out,
                );
            }
            let covers = snapshot
                .as_ref()
                .and_then(|s| s.covers)
                .filter(|(owner, _)| orphan.owner == WalOwner::Session(*owner))
                .map(|(_, seq)| seq)
                .unwrap_or(WalSeq(0));
            orphan.records.retain(|r| {
                r.record.user == self.config.user
                    && (r.delivered || r.record.created_at >= before)
                    && (!r.delivered || r.record.seq > covers)
            });
            if orphan.records.is_empty() {
                continue;
            }
            let first = self.wal.next_seq;
            self.wal.next_seq = WalSeq(
                first
                    .0
                    .saturating_add(u64::try_from(orphan.records.len()).unwrap_or(u64::MAX)),
            );
            let mut previous = covers;
            for (offset, stored) in orphan.records.iter().enumerate() {
                if stored.record.seq.0 > previous.0.saturating_add(1) && !stored.delivered {
                    self.rows_after_gap.insert(WalSeq(
                        first
                            .0
                            .saturating_add(u64::try_from(offset).unwrap_or(u64::MAX)),
                    ));
                }
                previous = stored.record.seq;
            }
            self.issue(
                StorageOp::WalAdopt {
                    doc: self.config.doc.clone(),
                    from: orphan.owner,
                    to: self.config.session,
                    first_seq: first,
                    covers,
                },
                StorageCompletion::Adopt {
                    first,
                    records: orphan.records,
                },
                now,
                out,
            );
        }
        for owner in local.assist {
            for row in owner.records {
                if self.effective_access == Access::Edit
                    && row.record.user == self.config.user
                    && !row.delivered
                    && !row.record.quarantined
                    && !loro::LoroDoc::decode_import_blob_meta(&row.record.bytes, true)
                        .is_ok_and(|meta| self.server_vv.includes_vv(&meta.partial_end_vv))
                    && !self.assist.iter().any(|r| {
                        r.record.seq == row.record.seq && r.record.bytes == row.record.bytes
                    })
                {
                    self.assist.push(row);
                }
            }
        }
        self.seen_foreign |= !self.assist.is_empty();
    }

    pub(super) fn expire_storage(
        &mut self,
        now: Now,
        doc: &mut impl SyncDoc,
        out: &mut SyncOutput,
    ) {
        let timed_out: Vec<_> = self
            .storage
            .iter()
            .filter(|(_, p)| p.deadline <= now.mono)
            .map(|(id, p)| {
                (
                    *id,
                    matches!(p.completion, StorageCompletion::Append { .. }),
                    matches!(
                        p.completion,
                        StorageCompletion::Load | StorageCompletion::Orphans
                    ),
                    matches!(p.completion, StorageCompletion::Adopt { .. }),
                )
            })
            .collect();
        for (id, append, load, adopt) in timed_out {
            if adopt {
                // A timeout does not prove the ownership transaction rolled back.
                // Keep its correlation so a late commit can still restore every moved row.
                if let Some(pending) = self.storage.get_mut(&id) {
                    pending.deadline = now.mono.after(self.config.timeouts.storage);
                }
                self.wal.health = StorageHealth::Failed { since: now.mono };
                continue;
            }
            let error = if append {
                StorageFailure::Uncertain
            } else {
                StorageFailure::Unavailable
            };
            let event = if load {
                StorageEvent::Loaded {
                    id,
                    result: Err(error),
                }
            } else if adopt {
                StorageEvent::Adopted {
                    id,
                    result: Err(error),
                }
            } else {
                StorageEvent::Done {
                    id,
                    result: Err(error),
                }
            };
            self.storage_event(event, now, doc, out);
        }
    }
}
