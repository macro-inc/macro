use super::*;

#[test]
fn imported_shallow_history_can_persist_at_its_confirmed_causal_frontier() {
    let ancestor = Doc::new(9);
    ancestor.edit("base");
    let server = Doc::new(10);
    server.loro.import(&ancestor.snapshot()).unwrap();
    server.edit("head");
    let confirmed = server.loro.oplog_frontiers();
    let shallow = server
        .loro
        .export(loro::ExportMode::shallow_snapshot(&confirmed))
        .unwrap();
    let loaded = Doc::new(11);
    loaded.loro.import(&shallow).unwrap();
    assert!(
        loaded
            .loro
            .export(loro::ExportMode::shallow_snapshot(
                &loaded.oplog_vv().get_frontiers()
            ))
            .is_err()
    );

    let mut h = Harness::new(TransportKind::None, Persistence::Durable);
    h.start();
    let load = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Loaded {
        id: load,
        result: Ok(empty()),
    }));
    h.send(SyncInput::Seed {
        kind: SeedKind::Remote,
        snapshot: shallow,
    });
    h.send(SyncInput::Ready);
    h.append();
    let append = h.storage_id();
    h.done(append);
    h.at(5000, SyncInput::Tick);
    let bytes = h
        .out
        .io
        .iter()
        .find_map(|effect| match effect {
            IoEffect::Storage {
                op: StorageOp::SnapshotSave { bytes, .. },
                ..
            } => Some(bytes),
            _ => None,
        })
        .expect("a shallow server seed must remain persistable after local typing");
    assert_eq!(h.doc.calls.borrow().snapshots.last(), Some(&confirmed));
    let reopened = Doc::new(12);
    reopened.loro.import(bytes).unwrap();
    assert_eq!(reopened.loro.get_text("text").to_string(), "baseheadx");
    let base = server.oplog_vv();
    server.edit("remote");
    let remote = server
        .loro
        .export(loro::ExportMode::updates(&base))
        .unwrap();
    let imported = reopened.loro.import(&remote).unwrap();
    assert!(
        imported.pending.is_none(),
        "concurrent remote history remains readable above the confirmed root"
    );
    let reference = Doc::new(13);
    reference.loro.import(&h.doc.snapshot()).unwrap();
    reference.loro.import(&remote).unwrap();
    assert_eq!(
        reopened.loro.get_text("text").to_string(),
        reference.loro.get_text("text").to_string()
    );
    assert_eq!(reopened.oplog_vv(), reference.oplog_vv());
}

#[test]
fn s7_006_snapshot_runs_only_for_changed_vector() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.at(5000, SyncInput::Tick);
    assert!(!h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::SnapshotSave { .. },
            ..
        }
    )));
    h.append();
    let id = h.storage_id();
    h.done(id);
    h.at(10000, SyncInput::Tick);
    assert!(h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::SnapshotSave { .. },
            ..
        }
    )));
}
#[test]
fn s7_009_projection_failure_starts_budgeted_reset() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::ImportFailed(ImportFailure::Projection(
        rootcause::report!("test projection error"),
    )));
    assert_eq!(h.core.phase, Phase::Resetting);
    assert_eq!(h.core.reset_times.len(), 1);
}
#[test]
fn s7_011_reset_preserves_old_edits_and_uses_new_peer() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.add_peer_ids([2]).unwrap();
    h.edit();
    h.send(SyncInput::Reset);
    assert_eq!(h.core.wal.entries.len(), 1);
    h.ack();
    let remote = Doc::new(9).snapshot();
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&remote),
    });
    assert_eq!(h.doc.peer_id(), 2);
    assert_eq!(h.doc.loro.get_text("text").to_string(), "x");
    assert_eq!(h.core.phase, Phase::Running);
}
#[test]
fn s7_012_failed_reset_preserves_old_document() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.core.add_peer_ids([2]).unwrap();
    h.doc.edit("keep");
    let vv = h.doc.oplog_vv();
    h.doc.replace_fails = true;
    h.send(SyncInput::Reset);
    h.at(5000, SyncInput::Tick);
    let request_vv = h.core.since.back().unwrap().vv.clone();
    h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&request_vv),
        update: SliceWrapper::from_cooked(&[]),
    });
    assert_eq!(h.doc.peer_id(), 1);
    assert_eq!(h.doc.oplog_vv(), vv);
    assert_eq!(h.core.phase, Phase::Running);
}
#[test]
fn s7_013_fourth_corruption_reset_closes_session() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    for _ in 0..3 {
        h.send(SyncInput::ImportFailed(corrupt()));
        h.core.finish_reset(false, false, now(0), &mut h.out);
    }
    h.send(SyncInput::ImportFailed(corrupt()));
    assert!(matches!(
        h.core.connection(),
        Connection::Closed(CloseReason::Corrupt)
    ));
}
#[test]
fn s7_016_outdated_rebase_is_unbudgeted_and_rate_limited() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::ImportFailed(ImportFailure::Outdated));
    assert_eq!(h.core.rebase_due, Some(Millis(0)));
    h.send(SyncInput::Tick);
    assert!(h.core.rebase_active);
    assert!(h.core.reset_times.is_empty());
    h.core.finish_reset(true, true, now(0), &mut h.out);
    h.at(1, SyncInput::ImportFailed(ImportFailure::Outdated));
    assert_eq!(h.core.rebase_due, Some(Millis(10000)));
}
#[test]
fn s7_017_unsolicited_snapshot_never_imports() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    let remote = Doc::new(9);
    remote.edit("other");
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&remote.snapshot()),
    });
    assert!(h.doc.oplog_vv().is_empty());
    assert!(h.doc.calls.borrow().imports.is_empty());
}
#[test]
fn s7_038_snapshot_prune_requires_durable_cover() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.append();
    let id = h.storage_id();
    h.done(id);
    h.ack();
    h.core.save_snapshot(now(25), &mut h.doc, &mut h.out);
    let id = h
        .core
        .storage
        .iter()
        .find_map(|(id, p)| {
            matches!(p.completion, StorageCompletion::Snapshot { .. }).then_some(*id)
        })
        .unwrap();
    assert!(!h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::WalPrune { .. },
            ..
        }
    )));
    h.done(id);
    assert!(h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::WalPrune {
                through: WalSeq(1),
                ..
            },
            ..
        }
    )));
}
#[test]
fn s7_039_corrupt_local_snapshot_deleted() {
    let mut h = Harness::new(TransportKind::None, Persistence::Durable);
    h.start();
    let id = h.storage_id();
    let mut state = empty();
    state.snapshot = Some(StoredSnapshot {
        bytes: vec![255],
        covers: None,
    });
    h.send(SyncInput::Storage(StorageEvent::Loaded {
        id,
        result: Ok(state),
    }));
    assert!(!h.core.seeded);
    assert!(h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::SnapshotDelete { .. },
            ..
        }
    )));
}
#[test]
fn s7_040_replay_continues_after_error_and_pending() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    for _ in 0..3 {
        h.core.append_bytes(
            vec![1],
            false,
            loro::VersionVector::default(),
            now(0),
            &mut h.out,
        );
    }
    h.doc.faults.push_back(Err(corrupt()));
    h.doc.faults.push_back(Ok(Imported {
        changed: false,
        new_ops: true,
        pending: true,
    }));
    h.doc.faults.push_back(Ok(Imported {
        changed: true,
        new_ops: true,
        pending: false,
    }));
    assert_eq!(h.core.replay(now(0), &mut h.doc, &mut h.out), 2);
    assert_eq!(h.doc.calls.borrow().imports.len(), 3);
}
#[test]
fn s7_041_first_seed_wins() {
    let mut h = Harness::new(TransportKind::None, Persistence::Memory);
    h.start();
    let d = Doc::new(2);
    d.edit("first");
    h.send(SyncInput::Seed {
        kind: SeedKind::Optimistic,
        snapshot: d.snapshot(),
    });
    h.send(SyncInput::Seed {
        kind: SeedKind::CachedS3,
        snapshot: vec![255],
    });
    assert_eq!(h.doc.loro.get_text("text").to_string(), "first");
}
#[test]
fn s7_042_replays_wal_after_remote_seed() {
    let mut h = Harness::new(TransportKind::None, Persistence::Memory);
    h.start();
    let r = row(1);
    h.core.append_bytes(
        r.record.bytes,
        false,
        loro::VersionVector::default(),
        now(0),
        &mut h.out,
    );
    h.send(SyncInput::Seed {
        kind: SeedKind::Remote,
        snapshot: vec![],
    });
    assert_eq!(h.doc.loro.get_text("text").to_string(), "foreign");
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Seeded {
            replayed_wal: 1,
            ..
        }
    )));
}
#[test]
fn s7_043_resaves_after_replaying_local_wal() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    let r = row(1);
    h.core.wal.entries.clear();
    h.core.append_bytes(
        r.record.bytes,
        false,
        loro::VersionVector::default(),
        now(0),
        &mut h.out,
    );
    h.core.wal.entries[0].state = EntryState::Logged;
    h.out.io.clear();
    h.core.replay(now(0), &mut h.doc, &mut h.out);
    assert!(h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::SnapshotSave { .. },
            ..
        }
    )));
}
#[test]
fn s7_045_host_peer_supply_rejects_reuse_and_reserved_ranges() {
    let mut p = PeerSupply::new(PeerRange::User);
    p.register(1).unwrap();
    assert_eq!(p.extend([2, 2]), Err(SyncError::PeerReused));
    assert!(p.is_empty());
    assert_eq!(p.extend([AI_PEER_BASE]), Err(SyncError::PeerOutOfRange));
    p.extend([3]).unwrap();
    assert_eq!(p.take(), Ok(3));
    assert_eq!(p.extend([3]), Err(SyncError::PeerReused));
}
#[test]
fn s7_046_export_contains_only_local_spans() {
    let mut d = Doc::new(1);
    let other = Doc::new(2);
    other.edit("remote");
    d.import_remote(&other.snapshot(), ImportOrigin::Live)
        .unwrap();
    d.edit("own");
    let bytes = d
        .export_local(&loro::VersionVector::default())
        .unwrap()
        .unwrap();
    let meta = loro::LoroDoc::decode_import_blob_meta(&bytes, true).unwrap();
    assert!(meta.partial_end_vv.get(&1).is_some());
    assert!(meta.partial_end_vv.get(&2).is_none());
}
#[test]
fn s7_047_bad_replace_does_not_discard_original_doc() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.add_peer_ids([2]).unwrap();
    h.send(SyncInput::Reset);
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&[255]),
    });
    assert_eq!(h.doc.peer_id(), 1);
    assert_eq!(h.core.phase, Phase::Running);
}
#[test]
fn s7_055_comment_update_is_separate_from_wal() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::PublishComment {
        request: RequestId(4),
        update: row(1).record.bytes,
    });
    assert_eq!(h.core.comments.len(), 1);
    assert!(h.core.wal.entries.is_empty());
    let id = h.core.comments[0].id.as_str().to_owned();
    h.remote(sync_protocol::FromRemote::RemoteUpdateAck { id: &id });
    assert_eq!(h.doc.loro.get_text("text").to_string(), "foreign");
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            reply: Reply::Comment(CommentReply::Accepted),
            ..
        }
    )));
}
#[test]
fn s7_103_comment_refuses_local_unacknowledged_changes() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.edit();
    h.send(SyncInput::PublishComment {
        request: RequestId(4),
        update: vec![1],
    });
    assert!(h.core.comments.is_empty());
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            reply: Reply::Comment(CommentReply::Refused(CommentRefusal::LocalChangesPending)),
            ..
        }
    )));
}
#[test]
fn s7_109_cached_s3_seed_is_supported() {
    let mut h = Harness::new(TransportKind::None, Persistence::Memory);
    h.start();
    let d = Doc::new(7);
    d.edit("cached");
    h.send(SyncInput::Seed {
        kind: SeedKind::CachedS3,
        snapshot: d.snapshot(),
    });
    assert_eq!(h.doc.loro.get_text("text").to_string(), "cached");
}
#[test]
fn s7_116_empty_local_snapshot_does_not_seed() {
    let mut h = Harness::new(TransportKind::None, Persistence::Durable);
    h.start();
    let id = h.storage_id();
    let mut state = empty();
    state.snapshot = Some(StoredSnapshot {
        bytes: vec![],
        covers: None,
    });
    h.send(SyncInput::Storage(StorageEvent::Loaded {
        id,
        result: Ok(state),
    }));
    assert!(!h.core.seeded);
}
#[test]
fn s7_123_snapshot_uses_confirmed_base_and_waits_for_typing() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.settle();
    let confirmed = h.core.confirmed_base.clone();
    h.at(4900, SyncInput::Tick);
    h.append();
    let id = h.storage_id();
    h.done(id);
    h.at(5000, SyncInput::Tick);
    assert!(h.doc.calls.borrow().snapshots.is_empty());
    h.at(6000, SyncInput::Tick);
    assert_eq!(h.doc.calls.borrow().snapshots.last(), Some(&confirmed));
}
#[test]
fn answered_snapshot_slots_remain_tombstones() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::RequestSnapshot(RequestId(1)));
    h.send(SyncInput::RequestSnapshot(RequestId(2)));
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&[1]),
    });
    assert_eq!(
        h.out
            .events
            .iter()
            .filter(|e| matches!(
                e,
                SyncEvent::Reply {
                    reply: Reply::Snapshot(Ok(_)),
                    ..
                }
            ))
            .count(),
        2
    );
    h.send(SyncInput::RequestSnapshot(RequestId(3)));
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&[2]),
    });
    assert!(!h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            request: RequestId(3),
            ..
        }
    )));
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&[3]),
    });
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Reply {
            request: RequestId(3),
            ..
        }
    )));
}
#[test]
fn one_supplied_peer_unblocks_waiting_reset() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.send(SyncInput::Reset);
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&[]),
    });
    assert!(matches!(h.core.reset, Some(ResetState::WaitingPeer { .. })));
    h.core.add_peer_ids([2]).unwrap();
    h.send(SyncInput::Tick);
    assert_eq!(h.doc.peer_id(), 2);
    assert_eq!(h.core.phase, Phase::Running);
}

#[test]
fn failed_old_peer_append_is_not_superseded_by_new_peer_export() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.append();
    let id = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Done {
        id,
        result: Err(StorageFailure::QuotaExceeded),
    }));
    h.doc.loro.set_peer_id(2).unwrap();
    h.edit();
    h.at(50, SyncInput::Tick);
    let id = h.storage_id();
    h.done(id);
    assert!(!h.core.wal.entries[0].superseded);
}
#[test]
fn poison_requires_failed_local_probe_and_is_never_deleted() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.append();
    let id = h.storage_id();
    h.done(id);
    h.core.add_peer_ids([2]).unwrap();
    h.doc.probe_result = Some(Err(corrupt()));
    h.core
        .request_snapshot(SnapshotPurpose::Probe, now(25), &mut h.out);
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&[]),
    });
    assert_eq!(h.core.wal.entries[0].park, Some(ParkReason::Poison));
    assert!(h.core.waiting_for_fresh_ack);
    assert!(h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::WalQuarantine { seq: WalSeq(1), .. },
            ..
        }
    )));
    assert!(!h.out.io.iter().any(|e| matches!(
        e,
        IoEffect::Storage {
            op: StorageOp::WalPrune { .. },
            ..
        }
    )));
}
#[test]
fn routed_first_handshake_seeds_and_permission_upgrade_reconnects_route() {
    let mut h = Harness::new(TransportKind::Routed, Persistence::Memory);
    h.start();
    h.send(SyncInput::Route(RouteEvent::Subscribed {
        conn: ConnId(1),
        access: WriteAccess::None,
    }));
    assert!(!h.core.connection.synced());
    let mut bytes = vec![];
    sync_protocol::FromRemote::RemoteInitialSync {
        snapshot: SliceWrapper::from_cooked(&[]),
        awareness: SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)
    .unwrap();
    let frame = sync_protocol::framing::into_frames(&bytes, 900000).remove(0);
    h.send(SyncInput::Route(RouteEvent::Frame {
        conn: ConnId(1),
        frame,
    }));
    assert!(h.core.seeded);
    h.send(SyncInput::Ready);
    h.send(SyncInput::Authorization(AuthorizationState {
        current: true,
        can_write: true,
        can_comment: true,
    }));
    assert!(
        h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::RouteReconnect { .. }))
    );
    assert!(
        !h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::SocketClose { .. }))
    );
}

#[test]
fn corrupt_local_seed_releases_waiting_remote_even_with_orphans() {
    let mut h = Harness::new(TransportKind::None, Persistence::Durable);
    h.start();
    let id = h.storage_id();
    h.send(SyncInput::Seed {
        kind: SeedKind::Remote,
        snapshot: vec![],
    });
    h.send(SyncInput::Storage(StorageEvent::Loaded {
        id,
        result: Ok(LocalState {
            snapshot: Some(StoredSnapshot {
                bytes: vec![255],
                covers: None,
            }),
            orphans: vec![OrphanWal {
                owner: WalOwner::Legacy,
                records: vec![row(1)],
            }],
            assist: vec![],
        }),
    }));
    assert!(!h.core.seeded);
    let adopt = h
        .out
        .io
        .iter()
        .find_map(|effect| match effect {
            IoEffect::Storage {
                id,
                op: StorageOp::WalAdopt { .. },
            } => Some(*id),
            _ => None,
        })
        .unwrap();
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id: adopt,
        result: Ok(1),
    }));
    assert!(h.core.seeded);
    assert!(h.out.events.iter().any(|event| matches!(
        event,
        SyncEvent::Seeded {
            kind: SeedKind::Remote,
            replayed_wal: 1
        }
    )));
    assert_eq!(h.doc.loro.get_text("text").to_string(), "foreign");
}
#[test]
fn comment_fork_uses_reserved_peer_and_registers_it() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.add_peer_ids([2]).unwrap();
    let peer = h.core.allocate_comment_peer(&mut h.out).unwrap();
    assert_eq!(peer, 2);
    assert!(h.core.registered_peers.contains(&2));
    assert_eq!(h.core.add_peer_ids([2]), Err(SyncError::PeerReused));
}

#[test]
fn blocked_rebase_does_not_rearm_an_expired_wake_during_reset() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.at(100, SyncInput::Tick);
    h.core.rebase_due = Some(Millis(100));
    h.core.phase = Phase::Resetting;
    h.core.reset = Some(ResetState::Awaiting { rebase: true });
    h.at(100, SyncInput::Tick);
    assert!(h.out.wake_at.is_none_or(|wake| wake > Millis(100)));
    assert!(!h.core.rebase_rerun);
    assert_eq!(h.core.rebase_due, Some(Millis(100)));
}
#[test]
fn acknowledged_rows_covered_by_a_shallow_snapshot_replay_idempotently() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    h.ack();
    let remote = h.doc.loro.fork();
    remote.set_peer_id(9).unwrap();
    remote.get_text("text").insert(1, "y").unwrap();
    remote.commit_with(loro::CommitOptions::default().timestamp(0));
    let snapshot = remote
        .export(loro::ExportMode::shallow_snapshot(
            &remote.state_frontiers(),
        ))
        .unwrap();
    let replacement = loro::LoroDoc::new();
    replacement.set_peer_id(99).unwrap();
    replacement.import(&snapshot).unwrap();
    h.doc.loro = replacement;
    let imports = h.doc.calls.borrow().imports.len();
    h.core.replay(now(h.time), &mut h.doc, &mut h.out);
    assert_eq!(h.doc.calls.borrow().imports.len(), imports);
    assert!(h.core.rebase_due.is_none());
    assert_eq!(h.doc.loro.get_text("text").to_string(), "xy");
}

#[test]
fn covered_unacknowledged_rows_still_use_the_replay_importer() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    h.doc.faults.push_back(Err(ImportFailure::Outdated));
    let imports = h.doc.calls.borrow().imports.len();
    h.core.replay(now(h.time), &mut h.doc, &mut h.out);
    assert_eq!(h.doc.calls.borrow().imports.len(), imports + 1);
    assert_eq!(h.core.rebase_due, Some(Millis(h.time)));
    assert!(!h.core.is_delivered(h.core.wal.entries.front().unwrap().seq));
}

#[test]
fn invalid_checksum_acknowledged_rows_still_use_the_replay_importer() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.append();
    h.ack();
    let entry = h.core.wal.entries.front_mut().unwrap();
    let seq = entry.seq;
    let mut bytes = entry.bytes.to_vec();
    let last = bytes.last_mut().unwrap();
    *last ^= 0xff;
    assert!(loro::LoroDoc::decode_import_blob_meta(&bytes, true).is_err());
    entry.bytes = bytes.into();
    let imports = h.doc.calls.borrow().imports.len();
    h.core.replay(now(h.time), &mut h.doc, &mut h.out);
    assert_eq!(h.doc.calls.borrow().imports.len(), imports + 1);
    assert_eq!(h.core.wal.entries.front().unwrap().seq, seq);
    assert!(h.core.is_delivered(seq));
}

#[test]
fn successful_reset_clears_pending_history_when_no_wal_replay_follows() {
    let remote = Doc::new(7);
    remote.edit("first");
    let vv = remote.oplog_vv();
    remote.edit("second");
    let delta = remote.loro.export(loro::ExportMode::updates(&vv)).unwrap();
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.core.add_peer_ids([2]).unwrap();
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&delta),
    });
    assert!(h.core.status().pending_import);
    assert!(h.core.wal.entries.is_empty());
    h.send(SyncInput::Reset);
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&remote.snapshot()),
    });
    assert_eq!(h.doc.loro.get_text("text").to_string(), "firstsecond");
    assert_eq!(h.core.phase(), Phase::Running);
    assert!(!h.core.status().pending_import);
    assert_ne!(h.core.busy(), Some(BusyReason::PendingImport));
}

#[test]
fn failed_reset_preserves_pending_history_until_its_dependency_arrives() {
    let remote = Doc::new(7);
    remote.edit("first");
    let base = remote.snapshot();
    let vv = remote.oplog_vv();
    remote.edit("second");
    let delta = remote.loro.export(loro::ExportMode::updates(&vv)).unwrap();
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.core.add_peer_ids([2]).unwrap();
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&delta),
    });
    assert!(h.core.status().pending_import);
    h.doc.replace_fails = true;
    h.send(SyncInput::Reset);
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&remote.snapshot()),
    });
    assert!(h.core.status().pending_import);
    assert_eq!(h.core.busy(), Some(BusyReason::PendingImport));
    assert_eq!(h.doc.peer_id(), 1);
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&base),
    });
    assert!(!h.core.status().pending_import);
    assert_eq!(h.doc.loro.get_text("text").to_string(), "firstsecond");
}

#[test]
fn failed_conditional_adoption_reloads_the_source_selection() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.settle();
    let first = h.core.wal.next_seq;
    let id = h.core.issue(
        StorageOp::WalAdopt {
            doc: h.core.config.doc.clone(),
            from: WalOwner::Session(SessionId(uuid_value::Uuid::from_u128(99))),
            to: h.core.config.session,
            first_seq: first,
            covers: WalSeq(1),
            expected: Vec::new(),
        },
        StorageCompletion::Adopt {
            first,
            records: Vec::new(),
        },
        now(100),
        &mut h.out,
    );
    h.at(
        100,
        SyncInput::Storage(StorageEvent::Adopted {
            id,
            result: Err(StorageFailure::Other),
        }),
    );
    assert_eq!(h.core.load_retry, Some(Millis(2100)));
    h.at(2099, SyncInput::Tick);
    assert!(!h.out.io.iter().any(|effect| matches!(
        effect,
        IoEffect::Storage {
            op: StorageOp::Load { .. },
            ..
        }
    )));
    h.at(2100, SyncInput::Tick);
    assert!(h.out.io.iter().any(|effect| matches!(
        effect,
        IoEffect::Storage {
            op: StorageOp::Load { .. },
            ..
        }
    )));
    let load = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Loaded {
        id: load,
        result: Ok(LocalState {
            snapshot: None,
            orphans: Vec::new(),
            assist: Vec::new(),
        }),
    }));
    assert_eq!(h.core.wal.health, StorageHealth::Ok);
    assert_eq!(h.core.load_retry, None);
}

#[test]
fn revoked_private_rows_recover_with_history_and_resume_after_regrant() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.core.add_peer_ids([2]).unwrap();
    h.doc.edit("private first");
    h.core.append_local(now(0), &mut h.doc, &mut h.out);
    h.doc.edit(" and second");
    h.core.append_local(now(0), &mut h.doc, &mut h.out);
    let private_vv = h.doc.oplog_vv();
    let retained = h
        .core
        .wal
        .entries
        .iter()
        .map(|row| row.bytes.clone())
        .collect::<Vec<_>>();
    h.send(SyncInput::Authorization(AuthorizationState {
        current: true,
        can_write: false,
        can_comment: false,
    }));
    h.core.wal.entries[0].park = Some(ParkReason::NeedsRebase);
    h.send(SyncInput::ImportFailed(ImportFailure::Outdated));
    h.send(SyncInput::Tick);
    assert_eq!(
        h.core.status().save,
        SaveState::Unsaved(UnsavedReason::ReadOnly)
    );
    assert!(
        h.core
            .parked()
            .iter()
            .all(|(_, reason)| *reason == ParkReason::ReadOnly)
    );
    let server = Doc::new(9);
    server.edit("server");
    let bytes = server.loro.export(loro::ExportMode::all_updates()).unwrap();
    let vv = h.core.since.back().unwrap().vv.clone();
    h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&bytes),
    });
    assert_eq!(h.doc.peer_id(), 2);
    assert!(h.doc.oplog_vv().includes_vv(&private_vv));
    assert_eq!(h.core.confirmed_base, server.loro.oplog_frontiers());
    let text = h.doc.loro.get_text("text").to_string();
    assert!(text.contains("private first and second"));
    assert!(text.contains("server"));
    assert_eq!(
        h.core
            .wal
            .entries
            .iter()
            .map(|row| row.bytes.clone())
            .collect::<Vec<_>>(),
        retained
    );
    assert!(h.core.push.is_none());
    assert!(h.core.rebase_due.is_none());
    assert!(!h.core.pending_import);
    h.send(SyncInput::Authorization(AuthorizationState {
        current: true,
        can_write: true,
        can_comment: true,
    }));
    assert!(h.core.push.is_some());
    h.ack();
    assert!(h.core.parked().is_empty());
    assert!(
        h.core
            .wal
            .entries
            .iter()
            .all(|row| h.core.is_delivered(row.seq))
    );
}

#[test]
fn insufficient_recovery_history_keeps_the_private_document_and_wal() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.core.add_peer_ids([2]).unwrap();
    // Already-imported remote history is not necessarily duplicated in the own WAL.
    let foreign = Doc::new(9);
    foreign.edit("retained history");
    h.doc.loro.import(&foreign.snapshot()).unwrap();
    h.core.wal.logged_vv = h.doc.oplog_vv();
    h.append();
    let private_vv = h.doc.oplog_vv();
    let private_value = h.doc.loro.get_deep_value();
    let retained = h.core.wal.entries[0].bytes.clone();
    h.send(SyncInput::Authorization(AuthorizationState {
        current: true,
        can_write: false,
        can_comment: false,
    }));
    h.send(SyncInput::ImportFailed(ImportFailure::Outdated));
    h.at(5_025, SyncInput::Tick);
    let vv = h.core.since.back().unwrap().vv.clone();
    h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&[]),
    });
    assert_eq!(h.doc.peer_id(), 1);
    assert_eq!(h.doc.oplog_vv(), private_vv);
    assert_eq!(h.doc.loro.get_deep_value(), private_value);
    assert_eq!(h.core.wal.entries[0].bytes, retained);
    assert_eq!(h.core.phase, Phase::Running);
    assert_eq!(
        h.core.status().save,
        SaveState::Unsaved(UnsavedReason::ReadOnly)
    );
    assert!(h.core.push.is_none());
}

#[test]
fn ordinary_catchup_timeout_does_not_expire_history_recovery() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.edit();
    h.send(SyncInput::Authorization(AuthorizationState {
        current: true,
        can_write: false,
        can_comment: false,
    }));
    h.at(5_000, SyncInput::ImportFailed(ImportFailure::Outdated));
    h.send(SyncInput::Tick);
    assert!(matches!(
        h.core.reset,
        Some(ResetState::AwaitingHistory { .. })
    ));
    h.at(10_000, SyncInput::Tick);
    assert!(
        h.core
            .since
            .iter()
            .any(|request| !request.expired && request.recovery_deadline == Some(Millis(15_000)))
    );
    assert!(
        h.core
            .since
            .iter()
            .any(|request| request.expired && request.recovery_deadline.is_none())
    );
    assert!(matches!(
        h.core.reset,
        Some(ResetState::AwaitingHistory { .. })
    ));
    h.at(15_000, SyncInput::Tick);
    assert_eq!(h.core.phase, Phase::Running);
    assert!(h.core.reset.is_none());
    assert_eq!(h.doc.loro.get_text("text").to_string(), "x");
    assert_eq!(
        h.core.status().save,
        SaveState::Unsaved(UnsavedReason::ReadOnly)
    );
}

#[test]
fn recovery_preserves_empty_vector_fifo_and_ignores_a_stale_shallow_snapshot() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.add_peer_ids([2]).unwrap();
    h.edit();
    h.send(SyncInput::Authorization(AuthorizationState {
        current: true,
        can_write: false,
        can_comment: false,
    }));
    h.at(5_000, SyncInput::ImportFailed(ImportFailure::Outdated));
    h.send(SyncInput::Tick);
    let vv = h.core.since.back().unwrap().vv.clone();
    assert_eq!(h.core.since.front().unwrap().vv, vv);
    h.core
        .reset_snapshot(Doc::new(9).snapshot(), now(5_000), &mut h.doc, &mut h.out);
    assert!(matches!(
        h.core.reset,
        Some(ResetState::AwaitingHistory { .. })
    ));
    assert_eq!(h.doc.peer_id(), 1);
    h.at(10_000, SyncInput::Tick);
    // The expired ordinary response still owns the first identical wire slot.
    h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&[]),
    });
    assert!(matches!(
        h.core.reset,
        Some(ResetState::AwaitingHistory { .. })
    ));
    h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&[]),
    });
    assert_eq!(h.core.phase, Phase::Running);
    assert_eq!(h.doc.peer_id(), 2);
    assert_eq!(h.doc.loro.get_text("text").to_string(), "x");
    assert_eq!(
        h.core.status().save,
        SaveState::Unsaved(UnsavedReason::ReadOnly)
    );
}

#[test]
fn invalid_recovery_bytes_or_row_checksum_preserve_live_private_history() {
    for corrupt_row in [false, true] {
        let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
        h.settle();
        h.core.add_peer_ids([2]).unwrap();
        h.edit();
        h.send(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: false,
        }));
        h.at(25, SyncInput::Tick);
        let private_vv = h.doc.oplog_vv();
        if corrupt_row {
            let mut bytes = h.core.wal.entries[0].bytes.to_vec();
            let last = bytes.len() - 1;
            bytes[last] ^= 1;
            h.core.wal.entries[0].bytes = bytes.into();
        }
        let retained = h.core.wal.entries[0].bytes.clone();
        h.send(SyncInput::ImportFailed(ImportFailure::Outdated));
        h.send(SyncInput::Tick);
        let vv = h.core.since.back().unwrap().vv.clone();
        let response = if corrupt_row { &[][..] } else { &[1, 2, 3][..] };
        h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
            vv: SliceWrapper::from_cooked(&vv),
            update: SliceWrapper::from_cooked(response),
        });
        assert_eq!(h.core.phase, Phase::Running);
        assert_eq!(h.doc.peer_id(), 1);
        assert_eq!(h.doc.oplog_vv(), private_vv);
        assert_eq!(h.doc.loro.get_text("text").to_string(), "x");
        assert_eq!(h.core.wal.entries[0].bytes, retained);
        assert_eq!(
            h.core.status().save,
            SaveState::Unsaved(UnsavedReason::ReadOnly)
        );
    }
}
