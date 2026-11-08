use super::*;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

fn append(seq: u64) -> StorageOp {
    StorageOp::WalAppend {
        doc: SyncDocId::new("00000000-0000-7000-8000-000000000001".into()).unwrap(),
        owner: SessionId(uuid_value::Uuid::from_u128(1)),
        retry: false,
        record: WalRecord {
            seq: WalSeq(seq),
            created_at: UnixMillis(100),
            user: UserKey("user-0".into()),
            foreign: true,
            quarantined: false,
            bytes: vec![1, 2, 3],
        },
    }
}
fn complete(store: &mut SimStorage, op: StorageOp, now: u64) -> Completion {
    let (token, at) = store.issue(
        PendingWrite {
            client: ClientName("a".into()),
            session: SessionId(uuid_value::Uuid::from_u128(1)),
            id: StorageOpId(u32::try_from(now).unwrap()),
            op,
        },
        now,
        &mut ChaCha8Rng::seed_from_u64(1),
    );
    store
        .complete(token, &ProfileName("profile".into()), at, UnixMillis(100))
        .unwrap()
}
#[test]
fn append_is_durable_only_at_completion_and_uncertain_retry_is_idempotent() {
    let mut store = SimStorage::new(StorageProfile::fast());
    store.fault(StorageFault::Uncertain { next: 1 });
    let (token, at) = store.issue(
        PendingWrite {
            client: ClientName("a".into()),
            session: SessionId(uuid_value::Uuid::from_u128(1)),
            id: StorageOpId(1),
            op: append(1),
        },
        0,
        &mut ChaCha8Rng::seed_from_u64(1),
    );
    assert!(store.image().entries.is_empty());
    assert!(matches!(
        store
            .complete(token, &ProfileName("profile".into()), at, UnixMillis(100))
            .unwrap()
            .event,
        StorageEvent::Done {
            result: Err(StorageFailure::Uncertain),
            ..
        }
    ));
    let before = store.image().clone();
    let mut retry = append(1);
    if let StorageOp::WalAppend { record, retry, .. } = &mut retry {
        record.bytes = vec![9];
        *retry = true;
    }
    assert!(matches!(
        complete(&mut store, retry, 5).event,
        StorageEvent::Done { result: Ok(()), .. }
    ));
    assert_eq!(*store.image(), before);
}
#[test]
fn adoption_checks_lease_collision_and_overflow_without_mutation() {
    let mut store = SimStorage::new(StorageProfile::fast());
    complete(&mut store, append(1), 1);
    complete(&mut store, append(2), 2);
    let doc = SyncDocId::new("00000000-0000-7000-8000-000000000001".into()).unwrap();
    let adopt = StorageOp::WalAdopt {
        doc: doc.clone(),
        from: WalOwner::Session(SessionId(uuid_value::Uuid::from_u128(1))),
        to: SessionId(uuid_value::Uuid::from_u128(2)),
        first_seq: WalSeq(1),
        covers: WalSeq(99),
    };
    let before = store.image().clone();
    store
        .leases
        .insert((doc.clone(), SessionId(uuid_value::Uuid::from_u128(1))));
    assert!(matches!(
        complete(&mut store, adopt.clone(), 3).event,
        StorageEvent::Adopted {
            result: Err(StorageFailure::Other),
            ..
        }
    ));
    assert_eq!(*store.image(), before);
    store.leases.clear();
    let mut overflow = adopt.clone();
    if let StorageOp::WalAdopt { first_seq, .. } = &mut overflow {
        *first_seq = WalSeq(u64::MAX);
    }
    assert!(matches!(
        complete(&mut store, overflow, 4).event,
        StorageEvent::Adopted {
            result: Err(StorageFailure::Other),
            ..
        }
    ));
    assert_eq!(*store.image(), before);
    let row = store.durable.entries.values().next().unwrap().clone();
    store.durable.entries.insert(
        (
            doc.clone(),
            WalOwner::Session(SessionId(uuid_value::Uuid::from_u128(2))),
            WalSeq(1),
        ),
        row,
    );
    let collision = store.image().clone();
    assert!(matches!(
        complete(&mut store, adopt.clone(), 5).event,
        StorageEvent::Adopted {
            result: Err(StorageFailure::Other),
            ..
        }
    ));
    assert_eq!(*store.image(), collision);
    store.durable.entries.remove(&(
        doc,
        WalOwner::Session(SessionId(uuid_value::Uuid::from_u128(2))),
        WalSeq(1),
    ));
    assert!(matches!(
        complete(&mut store, adopt, 6).event,
        StorageEvent::Adopted { result: Ok(2), .. }
    ));
    assert_eq!(store.image().entries.len(), 2);
    assert!(
        store
            .image()
            .entries
            .iter()
            .all(|((_, owner, _), row)| *owner
                == WalOwner::Session(SessionId(uuid_value::Uuid::from_u128(2)))
                && row.record.foreign
                && row.record.bytes == [1, 2, 3])
    );
}
#[test]
fn pruning_requires_both_delivery_and_current_durable_snapshot_cover() {
    let mut store = SimStorage::new(StorageProfile::fast());
    complete(&mut store, append(1), 1);
    complete(&mut store, append(2), 2);
    let doc = SyncDocId::new("00000000-0000-7000-8000-000000000001".into()).unwrap();
    let prune = StorageOp::WalPrune {
        doc: doc.clone(),
        owner: SessionId(uuid_value::Uuid::from_u128(1)),
        through: WalSeq(2),
    };
    complete(
        &mut store,
        StorageOp::SnapshotSave {
            doc: doc.clone(),
            bytes: vec![8],
            covers: Some((SessionId(uuid_value::Uuid::from_u128(1)), WalSeq(1))),
        },
        3,
    );
    complete(&mut store, prune.clone(), 4);
    assert_eq!(store.image().entries.len(), 2);
    complete(
        &mut store,
        StorageOp::WalMarkDelivered {
            doc,
            owner: SessionId(uuid_value::Uuid::from_u128(1)),
            through: WalSeq(2),
        },
        5,
    );
    complete(&mut store, prune, 6);
    assert_eq!(store.image().entries.len(), 1);
    assert_eq!(store.image().entries.keys().next().unwrap().2, WalSeq(2));
}
#[test]
fn process_death_cancels_pending_transactions_and_power_loss_reverts_recent_commits() {
    let mut store = SimStorage::new(StorageProfile::fast());
    complete(&mut store, append(1), 1);
    let stable = store.image().clone();
    complete(&mut store, append(2), 100);
    let (token, _) = store.issue(
        PendingWrite {
            client: ClientName("a".into()),
            session: SessionId(uuid_value::Uuid::from_u128(1)),
            id: StorageOpId(10),
            op: append(3),
        },
        101,
        &mut ChaCha8Rng::seed_from_u64(1),
    );
    let facts = store.crash(
        &CrashMode::PowerLoss {
            window: crate::Millis(10),
        },
        &ProfileName("profile".into()),
        105,
    );
    assert!(
        store
            .complete(token, &ProfileName("profile".into()), 110, UnixMillis(110))
            .is_none()
    );
    assert_eq!(*store.image(), stable);
    assert!(
        facts
            .iter()
            .any(|fact| matches!(fact, Fact::WalWriteLost { seq: WalSeq(2), .. }))
    );
}

#[test]
fn per_document_issue_order_survives_latency_changes_without_global_head_of_line_blocking() {
    let mut store = SimStorage::new(StorageProfile::fast());
    let mut rng = ChaCha8Rng::seed_from_u64(17);
    let write = |op| PendingWrite {
        client: ClientName("a".into()),
        session: SessionId(uuid_value::Uuid::from_u128(1)),
        id: StorageOpId(1),
        op,
    };
    store.fault(StorageFault::Latency(
        crate::Millis(1_000),
        crate::Millis(1_000),
    ));
    let (first, first_at) = store.issue(write(append(1)), 0, &mut rng);
    store.fault(StorageFault::Latency(crate::Millis(0), crate::Millis(0)));
    let (second, second_at) = store.issue(write(append(2)), 0, &mut rng);
    let mut other = append(1);
    if let StorageOp::WalAppend { doc, .. } = &mut other {
        *doc = SyncDocId::new("00000000-0000-7000-8000-000000000002".into()).unwrap();
    }
    let (_, other_at) = store.issue(write(other), 0, &mut rng);
    assert!(first_at < second_at);
    assert!(other_at < first_at);
    let profile = ProfileName("profile".into());
    store
        .complete(first, &profile, first_at, UnixMillis(1_000))
        .unwrap();
    store.crash(&CrashMode::ProcessDeath, &profile, first_at);
    assert_eq!(store.image().entries.len(), 1);
    assert!(
        store
            .complete(second, &profile, second_at, UnixMillis(1_001))
            .is_none()
    );
}
#[test]
fn write_load_and_quota_errors_never_wipe_or_cross_profile_storage() {
    let mut store = SimStorage::new(StorageProfile::fast());
    let other_profile = SimStorage::new(StorageProfile::fast());
    complete(&mut store, append(1), 1);
    let before = store.image().clone();
    for fault in [
        StorageFault::FailWrites,
        StorageFault::Quota { after_bytes: 0 },
    ] {
        store.fault(fault);
        assert!(matches!(
            complete(&mut store, append(2), 2).event,
            StorageEvent::Done { result: Err(_), .. }
        ));
        assert_eq!(store.image(), &before);
        store.fault(StorageFault::Heal);
    }
    store.fault(StorageFault::FailLoad);
    let load = StorageOp::Load {
        doc: before.entries.keys().next().unwrap().0.clone(),
        owner: SessionId(uuid_value::Uuid::from_u128(2)),
        user: UserKey("user-0".into()),
    };
    assert!(matches!(
        complete(&mut store, load, 3).event,
        StorageEvent::Loaded {
            result: Err(StorageFailure::Unavailable),
            ..
        }
    ));
    assert_eq!(store.image(), &before);
    assert!(other_profile.image().entries.is_empty());
}
