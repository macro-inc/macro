use super::*;

#[test]
fn wal_only_seed_waits_for_adoption_for_every_source_and_startup_order() {
    for kind in [
        SeedKind::Local,
        SeedKind::Remote,
        SeedKind::Optimistic,
        SeedKind::CachedS3,
    ] {
        for before_load in [false, true] {
            for delayed in [false, true] {
                let mut h = Harness::new(TransportKind::None, Persistence::Durable);
                h.start();
                let load = h.storage_id();
                let source = Doc::new(7);
                source.edit("durable😀");
                let mut stored = row(1);
                stored.record.bytes = source.snapshot();
                if before_load {
                    h.send(SyncInput::Seed {
                        kind,
                        snapshot: vec![],
                    });
                    assert!(
                        !h.out
                            .events
                            .iter()
                            .any(|e| matches!(e, SyncEvent::Seeded { .. }))
                    );
                }
                h.send(SyncInput::Storage(StorageEvent::Loaded {
                    id: load,
                    result: Ok(LocalState {
                        snapshot: None,
                        orphans: vec![OrphanWal {
                            owner: WalOwner::Legacy,
                            records: vec![stored],
                        }],
                        assist: vec![],
                    }),
                }));
                let adopt = h.storage_id();
                assert!(
                    !h.out
                        .events
                        .iter()
                        .any(|e| matches!(e, SyncEvent::Seeded { .. }))
                );
                if !before_load {
                    h.send(SyncInput::Seed {
                        kind,
                        snapshot: vec![],
                    });
                }
                assert!(
                    !h.out
                        .events
                        .iter()
                        .any(|e| matches!(e, SyncEvent::Seeded { .. }))
                );
                h.send(SyncInput::Ready);
                assert_eq!(h.core.phase(), Phase::Loading);
                if delayed {
                    h.at(20_000, SyncInput::Tick);
                    assert!(
                        !h.out
                            .events
                            .iter()
                            .any(|e| matches!(e, SyncEvent::Seeded { .. }))
                    );
                }
                h.send(SyncInput::Storage(StorageEvent::Adopted {
                    id: adopt,
                    result: Ok(1),
                }));
                assert!(h.out.events.iter().any(|e| matches!(e,
                    SyncEvent::Seeded { kind: actual, replayed_wal: 1 } if *actual == kind)));
                assert_eq!(h.doc.loro.get_text("text").to_string(), "durable😀");
                assert!(h.doc.oplog_vv().includes_vv(&source.oplog_vv()));
                h.send(SyncInput::Ready);
                assert_eq!(h.core.phase(), Phase::Running);
            }
        }
    }
}

#[test]
fn failed_adoption_reloads_before_seed_and_local_snapshot_keeps_precedence() {
    let mut h = Harness::new(TransportKind::None, Persistence::Durable);
    h.start();
    let load = h.storage_id();
    let source = Doc::new(7);
    source.edit("durable😀");
    let mut stored = row(1);
    stored.record.bytes = source.snapshot();
    let mut local = LocalState {
        snapshot: Some(StoredSnapshot {
            bytes: source.snapshot(),
            covers: Some((SessionId(uuid_value::Uuid::from_u128(20)), WalSeq(0))),
        }),
        orphans: vec![OrphanWal {
            owner: WalOwner::Session(SessionId(uuid_value::Uuid::from_u128(20))),
            records: vec![stored],
        }],
        assist: vec![],
    };
    h.send(SyncInput::Storage(StorageEvent::Loaded {
        id: load,
        result: Ok(local.clone()),
    }));
    let adopt = h.storage_id();
    h.send(SyncInput::Seed {
        kind: SeedKind::Optimistic,
        snapshot: vec![],
    });
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id: adopt,
        result: Err(StorageFailure::Other),
    }));
    h.send(SyncInput::Seed {
        kind: SeedKind::Remote,
        snapshot: vec![],
    });
    assert!(
        !h.out
            .events
            .iter()
            .any(|e| matches!(e, SyncEvent::Seeded { .. }))
    );
    h.at(2_000, SyncInput::Tick);
    let load = h.storage_id();
    source.edit(" refreshed");
    local.snapshot = Some(StoredSnapshot {
        bytes: source.snapshot(),
        covers: Some((SessionId(uuid_value::Uuid::from_u128(20)), WalSeq(1))),
    });
    h.send(SyncInput::Storage(StorageEvent::Loaded {
        id: load,
        result: Ok(local),
    }));
    let adopt = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id: adopt,
        result: Ok(1),
    }));
    assert!(h.out.events.iter().any(|e| matches!(
        e,
        SyncEvent::Seeded {
            kind: SeedKind::Local,
            replayed_wal: 1
        }
    )));
    assert_eq!(
        h.doc.loro.get_text("text").to_string(),
        "durable😀 refreshed"
    );
}
