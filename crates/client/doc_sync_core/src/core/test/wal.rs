use super::*;

#[test]
fn s7_002_coalesces_and_gossips_only_after_durable_append() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.core.config.chatter = true;
    h.edit();
    h.edit();
    h.at(24, SyncInput::Tick);
    assert!(h.core.wal.entries.is_empty());
    h.at(25, SyncInput::Tick);
    assert_eq!(h.core.wal.entries.len(), 1);
    assert!(
        !h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::ChatterPost(_)))
    );
    let id = h.storage_id();
    h.done(id);
    assert!(
        h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::ChatterPost(ChatterMessage::Update(_))))
    );
}
#[test]
fn s7_024_wal_records_keep_identity_sequence_and_time() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.append();
    let Some(IoEffect::Storage {
        op: StorageOp::WalAppend { owner, record, .. },
        ..
    }) = h.out.io.iter().find(|e| {
        matches!(
            e,
            IoEffect::Storage {
                op: StorageOp::WalAppend { .. },
                ..
            }
        )
    })
    else {
        panic!()
    };
    assert_eq!(*owner, h.core.config.session);
    assert_eq!(record.seq, WalSeq(1));
    assert_eq!(record.user, h.core.config.user);
    assert_eq!(record.created_at, UnixMillis(25));
    assert!(!record.foreign);
}
#[test]
fn s7_025_ttl_drops_only_expired_undelivered_orphans() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.time = 8 * 24 * 60 * 60 * 1000;
    let mut delivered = row(2);
    delivered.delivered = true;
    load_rows(&mut h, vec![row(1), delivered]);
    assert!(h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::WalDropExpired { .. },
            ..
        }
    )));
    assert!(h.core.storage.values().any(|p|matches!(&p.completion,StorageCompletion::Adopt{records,..} if records.len()==1 && records[0].delivered)));
}
#[test]
fn s7_026_append_completion_precedes_push() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.append();
    assert!(h.core.push.is_none());
    let id = h.storage_id();
    h.done(id);
    assert!(h.core.push.is_some());
}
#[test]
fn s7_028_only_one_batch_inflight_and_late_rows_rerun() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    let first = h.core.push.as_ref().unwrap().id.clone();
    h.append();
    assert_eq!(h.core.push.as_ref().unwrap().id, first);
    h.ack();
    assert_eq!(h.core.push.as_ref().unwrap().rows, vec![WalSeq(2)]);
}
#[test]
fn s7_029_batches_limit_rows_and_allow_one_oversize() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.connection.state = Connection::Idle;
    for _ in 0..70 {
        h.core.append_bytes(
            vec![1],
            false,
            loro::VersionVector::default(),
            now(0),
            &mut h.out,
        );
    }
    h.core.connection.establish(ConnId(1), now(0));
    h.core.push_rows(now(0), &mut h.out);
    assert_eq!(h.core.push.as_ref().unwrap().rows.len(), 64);
    h.core.push = None;
    h.core.wal.entries.clear();
    h.core.append_bytes(
        vec![1; 300000],
        false,
        loro::VersionVector::default(),
        now(0),
        &mut h.out,
    );
    h.core.push_rows(now(0), &mut h.out);
    assert_eq!(h.core.push.as_ref().unwrap().rows.len(), 1);
}
#[test]
fn s7_030_missing_ack_retries_without_inferred_poison() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    for _ in 0..21 {
        h.core.push_failed(now(h.time), &mut h.out);
        let retry = h.core.push_retry.unwrap();
        h.time = retry.0;
        h.core.push_rows(now(h.time), &mut h.out);
    }
    assert_eq!(h.core.wal.entries[0].park, None);
    assert!(h.core.not_acked >= 20);
    assert!(h.core.suspect_delay.0 >= 10000);
}
#[test]
fn s7_031_ack_marks_only_contiguous_delivered_prefix() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.core.append_bytes(
        vec![1],
        false,
        loro::VersionVector::default(),
        now(0),
        &mut h.out,
    );
    h.core.wal.entries[0].park = Some(ParkReason::Poison);
    h.core.wal.entries[0].state = EntryState::Logged;
    h.core.append_bytes(
        vec![2],
        false,
        loro::VersionVector::default(),
        now(0),
        &mut h.out,
    );
    h.core.wal.entries[1].state = EntryState::Logged;
    h.core.push_rows(now(0), &mut h.out);
    h.ack();
    assert!(h.core.is_delivered(WalSeq(2)));
    assert!(!h.core.is_delivered(WalSeq(1)));
    assert_eq!(h.core.wal.delivered_through, None);
    assert!(!h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::WalMarkDelivered { .. },
            ..
        }
    )));
}
#[test]
fn s7_032_flush_waits_for_writing() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.edit();
    h.send(SyncInput::Flush(RequestId(1)));
    assert!(
        !h.out
            .events
            .iter()
            .any(|e| matches!(e, SyncEvent::Reply { .. }))
    );
    let id = h.storage_id();
    h.done(id);
    h.ack();
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            reply: Reply::Flush(FlushReply::Drained),
            ..
        }
    )));
}
#[test]
fn s7_033_storage_outage_telemetry_is_deduplicated() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.append();
    let id = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Done {
        id,
        result: Err(StorageFailure::QuotaExceeded),
    }));
    assert_eq!(outages(&h.out), 1);
    h.append();
    let id = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Done {
        id,
        result: Err(StorageFailure::QuotaExceeded),
    }));
    assert_eq!(outages(&h.out), 0);
}
#[test]
fn s7_034_failed_load_retries_on_deadline() {
    let mut h = Harness::new(TransportKind::None, Persistence::Durable);
    h.start();
    let id = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Loaded {
        id,
        result: Err(StorageFailure::Unavailable),
    }));
    assert_eq!(h.core.load_retry, Some(Millis(2000)));
    h.at(2000, SyncInput::Tick);
    assert!(h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::Load { .. },
            ..
        }
    )));
}
#[test]
fn s7_035_synced_retries_unacknowledged_wal() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    h.core.disconnected(now(0), &mut h.out);
    h.core.connection.establish(ConnId(2), now(0));
    h.core.on_synced(now(0), &mut h.doc, &mut h.out);
    assert!(h.core.push.is_some());
}
#[test]
fn s7_036_adoption_reserves_before_completion() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    load_rows(&mut h, vec![row(1), row(2)]);
    assert!(h.core.wal.entries.is_empty());
    assert_eq!(h.core.wal.next_seq, WalSeq(3));
    let id = h
        .core
        .storage
        .iter()
        .find_map(|(id, p)| matches!(p.completion, StorageCompletion::Adopt { .. }).then_some(*id))
        .unwrap();
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id,
        result: Ok(1),
    }));
    assert_eq!(h.core.wal.entries.len(), 1);
    assert_eq!(h.core.wal.entries[0].seq, WalSeq(1));
}
#[test]
fn s7_037_unlogged_rows_remain_in_memory_and_unsaved() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.append();
    let id = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Done {
        id,
        result: Err(StorageFailure::QuotaExceeded),
    }));
    assert!(matches!(
        h.core.wal.entries[0].state,
        EntryState::Unlogged { .. }
    ));
    assert_eq!(
        h.core.status.save,
        SaveState::Unsaved(UnsavedReason::Storage)
    );
}
#[test]
fn s7_095_chatter_closing_triggers_orphan_scan() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.core.config.chatter = true;
    h.core.storage.clear();
    h.send(SyncInput::Chatter(ChatterMessage::Closing(SessionId(
        uuid_value::Uuid::from_u128(2),
    ))));
    assert!(h.core.foreign_writer_closed);
    assert!(h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::LoadOrphans { .. },
            ..
        }
    )));
}
#[test]
fn s7_096_flush_reports_undrained_parked_rows() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    h.core.wal.entries[0].park = Some(ParkReason::Poison);
    h.send(SyncInput::Flush(RequestId(1)));
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            reply: Reply::Flush(FlushReply::NotDrained { undelivered: 1 }),
            ..
        }
    )));
}
#[test]
fn s7_099_stop_forces_append_and_waits_for_completion() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.edit();
    h.send(SyncInput::Stop(RequestId(5)));
    assert_eq!(h.core.wal.entries.len(), 1);
    assert!(!h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            reply: Reply::Stopped,
            ..
        }
    )));
    let id = h.storage_id();
    h.done(id);
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            reply: Reply::Stopped,
            ..
        }
    )));
}
#[test]
fn s7_105_saved_requires_all_unparked_and_parked_work_resolved() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    assert_eq!(h.core.status.save, SaveState::Saving);
    h.ack();
    assert_eq!(h.core.status.save, SaveState::Saved);
    h.core.pending_import = true;
    h.send(SyncInput::Tick);
    assert_ne!(h.core.status.save, SaveState::Saved);
}
#[test]
fn s7_121_assisted_batches_never_mark_or_adopt_foreign_owner() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.core.assist = (0..70).map(row).collect();
    h.send(SyncInput::Tick);
    let id = h.core.assist_push.as_ref().unwrap().id.as_str().to_owned();
    h.remote(sync_protocol::FromRemote::RemoteUpdateAck { id: &id });
    assert_eq!(h.core.assist.len(), 6);
    assert!(!h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::WalMarkDelivered { .. } | StorageOp::WalAdopt { .. },
            ..
        }
    )));
}
#[test]
fn s7_122_foreign_gossip_is_not_echoed_and_evidence_delivers() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.core.config.chatter = true;
    let bytes = row(1).record.bytes;
    h.send(SyncInput::Chatter(ChatterMessage::Update(bytes.clone())));
    assert!(h.core.wal.entries[0].foreign);
    let id = h.storage_id();
    h.done(id);
    assert!(
        !h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::ChatterPost(_)))
    );
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&bytes),
    });
    assert!(h.core.is_delivered(WalSeq(1)));
}
#[test]
fn uncertain_append_keeps_bytes_and_sequence_and_marks_retry() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.append();
    let id = h.storage_id();
    let before = h.core.wal.entries[0].bytes.clone();
    h.send(SyncInput::Storage(StorageEvent::Done {
        id,
        result: Err(StorageFailure::Uncertain),
    }));
    assert!(h.out.io.iter().any(|e|matches!(e,IoEffect::Storage{op:StorageOp::WalAppend{record,retry:true,..},..} if record.seq==WalSeq(1) && record.bytes.as_slice()==before.as_ref())));
}
#[test]
fn stopped_timer_retries_uncertain_append_without_spinning() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.edit();
    h.send(SyncInput::Stop(RequestId(1)));
    h.at(10000, SyncInput::Tick);
    assert_eq!(h.out.wake_at, Some(Millis(20000)));
    let id = h.storage_id();
    h.done(id);
    assert!(h.core.stop_barrier.is_empty());
}
fn outages(out: &SyncOutput) -> usize {
    out.io
        .iter()
        .filter(|e| {
            matches!(
                e,
                IoEffect::Telemetry(TelemetryRecord {
                    kind: TelemetryKind::Event {
                        name: "wal.storage.error"
                    },
                    ..
                })
            )
        })
        .count()
}

fn load_rows(h: &mut Harness, records: Vec<StoredWalRecord>) {
    h.core.loaded(
        LocalState {
            snapshot: None,
            orphans: vec![OrphanWal {
                owner: WalOwner::Legacy,
                records,
            }],
            assist: vec![],
        },
        now(h.time),
        &mut h.doc,
        &mut h.out,
    );
}

#[test]
fn delayed_adoption_completion_still_restores_moved_rows() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    load_rows(&mut h, vec![row(1)]);
    let id = h
        .core
        .storage
        .iter()
        .find_map(|(id, p)| matches!(p.completion, StorageCompletion::Adopt { .. }).then_some(*id))
        .unwrap();
    h.at(10000, SyncInput::Tick);
    assert!(h.core.storage.contains_key(&id));
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id,
        result: Ok(1),
    }));
    assert_eq!(h.core.wal.entries.len(), 1);
}

#[test]
fn no_old_user_gossip_after_authorization_revocation() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.core.config.chatter = true;
    h.append();
    let id = h.storage_id();
    h.send(SyncInput::Authorization(AuthorizationState {
        current: false,
        can_write: false,
        can_comment: false,
    }));
    h.done(id);
    assert!(
        !h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::ChatterPost(_)))
    );
    assert!(matches!(h.core.wal.entries[0].state, EntryState::Logged));
}
#[test]
fn late_adoption_does_not_replay_after_stop() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    load_rows(&mut h, vec![row(1)]);
    let id = h
        .core
        .storage
        .iter()
        .find_map(|(id, p)| matches!(p.completion, StorageCompletion::Adopt { .. }).then_some(*id))
        .unwrap();
    h.send(SyncInput::Stop(RequestId(1)));
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id,
        result: Ok(1),
    }));
    assert!(h.doc.calls.borrow().imports.is_empty());
    assert!(!h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::SnapshotSave { .. },
            ..
        }
    )));
}
#[test]
fn pending_adopted_row_after_missing_sequence_is_parked_as_gap() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.doc.faults.push_back(Ok(Imported {
        changed: false,
        new_ops: true,
        pending: true,
    }));
    load_rows(&mut h, vec![row(2)]);
    let id = h
        .core
        .storage
        .iter()
        .find_map(|(id, p)| matches!(p.completion, StorageCompletion::Adopt { .. }).then_some(*id))
        .unwrap();
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id,
        result: Ok(1),
    }));
    assert_eq!(h.core.wal.entries[0].park, Some(ParkReason::Gap));
    assert_eq!(h.core.status.save, SaveState::Unsaved(UnsavedReason::Gap));
}

#[test]
fn current_peer_superset_does_not_supersede_later_adopted_peer() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.append();
    let id = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Done {
        id,
        result: Err(StorageFailure::QuotaExceeded),
    }));
    load_rows(&mut h, vec![row(1)]);
    let id = h
        .core
        .storage
        .iter()
        .find_map(|(id, p)| matches!(p.completion, StorageCompletion::Adopt { .. }).then_some(*id))
        .unwrap();
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id,
        result: Ok(1),
    }));
    h.append();
    let id = h.storage_id();
    h.done(id);
    assert!(h.core.wal.entries[0].superseded);
    assert!(!h.core.wal.entries[1].superseded);
}

#[test]
fn expired_push_retry_does_not_spin_while_a_reconnect_is_pending() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    h.close(1006);
    let retry = h.core.push_retry.unwrap();
    h.at(1_000, SyncInput::Tick);
    assert!(!h.core.connection.synced());
    h.at(retry.0, SyncInput::Tick);
    assert!(h.out.wake_at.is_none_or(|at| at > retry));
    assert!(!h.core.wal.entries.is_empty());
}

#[test]
fn expired_push_retry_does_not_spin_while_rows_are_read_only() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    h.core.push_failed(now(h.time), &mut h.out);
    let retry = h.core.push_retry.unwrap();
    h.send(SyncInput::Authorization(AuthorizationState {
        current: true,
        can_write: false,
        can_comment: false,
    }));
    h.at(retry.0, SyncInput::Tick);
    assert!(h.out.wake_at.is_none_or(|at| at > retry));
    assert_eq!(h.core.parked()[0].1, ParkReason::ReadOnly);
}

#[test]
fn assisted_retry_schedules_only_the_new_ack_deadline() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.assist.push(row(1));
    h.core.push_assist(now(h.time), &mut h.out);
    let timeout = h.core.assist_push.as_ref().unwrap().deadline;
    h.at(timeout.0, SyncInput::Tick);
    let retry = h.core.assist_retry.unwrap();
    h.at(retry.0, SyncInput::Tick);
    assert!(h.core.assist_push.is_some());
    assert!(h.out.wake_at.is_none_or(|at| at > retry));
}

#[test]
fn adoption_inside_coalesce_window_keeps_local_edit_for_append() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    load_rows(&mut h, vec![row(1)]);
    let id = h
        .core
        .storage
        .iter()
        .find_map(|(id, pending)| {
            matches!(pending.completion, StorageCompletion::Adopt { .. }).then_some(*id)
        })
        .unwrap();
    h.edit();
    let peer = h.doc.peer_id();
    let local_end = h.doc.oplog_vv().get(&peer).copied().unwrap();
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id,
        result: Ok(1),
    }));
    h.at(25, SyncInput::Tick);
    let record = h
        .out
        .io
        .iter()
        .find_map(|effect| match effect {
            IoEffect::Storage {
                op: StorageOp::WalAppend { record, .. },
                ..
            } => Some(record),
            _ => None,
        })
        .expect("the local edit must still be appended after adoption replay");
    let meta = loro::LoroDoc::decode_import_blob_meta(&record.bytes, true).unwrap();
    assert_eq!(meta.partial_end_vv.get(&peer).copied(), Some(local_end));
}

#[test]
fn server_evidence_retires_only_the_confirmed_part_of_an_own_push() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.config.chatter = true;
    let bytes = row(1).record.bytes;
    h.send(SyncInput::Chatter(ChatterMessage::Update(bytes.clone())));
    h.edit();
    h.core.foreign_writer_closed = true;
    h.at(25, SyncInput::Tick);
    let push = h.core.push.as_ref().unwrap();
    let id = push.id.as_str().to_owned();
    assert_eq!(push.rows, vec![WalSeq(1), WalSeq(2)]);
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&bytes),
    });
    assert_eq!(h.core.wal.delivered_through, Some(WalSeq(1)));
    assert_eq!(h.core.push.as_ref().unwrap().rows, vec![WalSeq(2)]);
    assert_eq!(h.core.push.as_ref().unwrap().id.as_str(), id);
    h.ack();
    assert_eq!(h.core.wal.delivered_through, Some(WalSeq(2)));
    assert!(h.core.push.is_none());
}

#[test]
fn server_evidence_retires_an_entire_foreign_push_before_its_ack() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.config.chatter = true;
    let bytes = row(1).record.bytes;
    h.send(SyncInput::Chatter(ChatterMessage::Update(bytes.clone())));
    h.send(SyncInput::Chatter(ChatterMessage::Closing(SessionId(
        uuid_value::Uuid::from_u128(99),
    ))));
    assert_eq!(h.core.push.as_ref().unwrap().rows, vec![WalSeq(1)]);
    let id = h.core.push.as_ref().unwrap().id.as_str().to_owned();
    h.core.not_acked = 20;
    h.core.suspect_delay = Millis(60_000);
    h.core.waiting_for_fresh_ack = true;
    let span = h.core.span("wal.delivery_outage", None, &mut h.out);
    h.core.outage_span = Some(span);
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&bytes),
    });
    assert!(h.core.is_delivered(WalSeq(1)));
    assert!(h.core.push.is_none());
    assert!(h.core.push_retry.is_none());
    assert_eq!(h.core.not_acked, 0);
    assert_eq!(h.core.suspect_delay, Millis(5_000));
    assert!(!h.core.waiting_for_fresh_ack);
    assert!(h.core.outage_span.is_none());
    h.remote(sync_protocol::FromRemote::RemoteUpdateAck { id: &id });
    assert!(!h.core.waiting_for_fresh_ack);
    assert_eq!(h.core.status().save, SaveState::Saved);
}
