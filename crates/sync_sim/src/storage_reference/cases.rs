//! Portable literal transaction cases; initial legacy rows reflect the existing v1 store.
use super::*;

/// Shared native/browser transaction cases. Each must use a separate database/profile.
/// SC-1/4/5/6/7 data semantics are compared after every action; native timing and
/// lease-order tests cover SC-2/3/9. Actual browser identity/waits require S8 §9.2.
pub fn storage_cases() -> Vec<StorageCase> {
    let doc = SyncDocId::new("00000000-0000-7000-8000-000000000001".into()).expect("literal key");
    let other = SyncDocId::new("00000000-0000-7000-8000-000000000002".into()).expect("literal key");
    let one = SessionId(uuid_value::Uuid::from_u128(1));
    let two = SessionId(uuid_value::Uuid::from_u128(2));
    let three = SessionId(uuid_value::Uuid::from_u128(3));
    let retention = Millis(1_000);
    let user = UserKey("user-0".into());
    let rows = (1..=3)
        .map(|seq| StoredWalRecord {
            record: WalRecord {
                seq: WalSeq(seq),
                created_at: UnixMillis(100),
                user: user.clone(),
                foreign: seq == 2,
                quarantined: seq == 3,
                bytes: vec![u8::try_from(seq).expect("small sequence"), 7],
            },
            delivered: seq <= 2,
        })
        .collect::<Vec<_>>();
    let initial = StoreImage {
        entries: rows
            .iter()
            .map(|row| {
                (
                    (doc.clone(), WalOwner::Session(one), row.record.seq),
                    row.clone(),
                )
            })
            .chain(rows.iter().map(|row| {
                (
                    (other.clone(), WalOwner::Session(one), row.record.seq),
                    row.clone(),
                )
            }))
            .collect(),
        snapshots: [(
            doc.clone(),
            StoredSnapshot {
                bytes: vec![8],
                covers: Some((one, WalSeq(1))),
            },
        )]
        .into(),
    };
    let op = |op| ContractAction::Execute(op, UnixMillis(2_000));
    let adoption = StorageOp::WalAdopt {
        doc: doc.clone(),
        from: WalOwner::Session(one),
        to: two,
        first_seq: WalSeq(10),
        covers: WalSeq(99),
    };
    let adopt = StorageCase {
        name: "SC-4 atomic adoption, preserved flags, lease and stale-winner protection",
        initial: initial.clone(),
        retention,
        actions: vec![
            ContractAction::Acquire(doc.clone(), one),
            op(adoption.clone()),
            op(StorageOp::Load {
                doc: doc.clone(),
                owner: three,
                user: user.clone(),
            }),
            ContractAction::Release(doc.clone(), one),
            op(adoption.clone()),
            op(adoption.clone()),
            op(StorageOp::LoadOrphans {
                doc: doc.clone(),
                owner: three,
                user: user.clone(),
            }),
            ContractAction::ProcessDeath,
        ],
    };
    let mut collision_image = initial.clone();
    collision_image.entries.insert(
        (doc.clone(), WalOwner::Session(two), WalSeq(11)),
        rows[0].clone(),
    );
    // The destination key and record sequence must agree, as in a real indexed row.
    collision_image
        .entries
        .get_mut(&(doc.clone(), WalOwner::Session(two), WalSeq(11)))
        .expect("inserted row")
        .record
        .seq = WalSeq(11);
    let collision = StorageCase {
        name: "SC-4 late destination collision aborts every row",
        initial: collision_image,
        retention,
        actions: vec![op(adoption.clone())],
    };
    let mut overflow_op = adoption.clone();
    if let StorageOp::WalAdopt { first_seq, .. } = &mut overflow_op {
        *first_seq = WalSeq(u64::MAX);
    }
    let overflow = StorageCase {
        name: "SC-4 sequence overflow aborts every row",
        initial: initial.clone(),
        retention,
        actions: vec![op(overflow_op)],
    };
    let prune = StorageCase {
        name: "SC-1/5/7 durable coverage, no wipe and conservative eviction",
        initial: initial.clone(),
        retention,
        actions: vec![
            ContractAction::Evict(doc.clone()),
            op(StorageOp::WalPrune {
                doc: doc.clone(),
                owner: one,
                through: WalSeq(3),
            }),
            op(StorageOp::SnapshotDelete { doc: doc.clone() }),
            op(StorageOp::WalPrune {
                doc: doc.clone(),
                owner: one,
                through: WalSeq(3),
            }),
            op(StorageOp::SnapshotSave {
                doc: doc.clone(),
                bytes: vec![9],
                covers: Some((one, WalSeq(3))),
            }),
            ContractAction::ProcessDeath,
            op(StorageOp::WalPrune {
                doc: doc.clone(),
                owner: one,
                through: WalSeq(3),
            }),
            ContractAction::Evict(doc.clone()),
            op(StorageOp::WalMarkDelivered {
                doc: doc.clone(),
                owner: one,
                through: WalSeq(3),
            }),
            ContractAction::Evict(doc.clone()),
            op(StorageOp::WalPrune {
                doc: doc.clone(),
                owner: one,
                through: WalSeq(3),
            }),
        ],
    };
    let append = StorageCase {
        name: "SC-1/6 retry preserves existing bytes and process death keeps completed rows",
        initial: StoreImage::default(),
        retention,
        actions: vec![
            ContractAction::Acquire(doc.clone(), one),
            op(StorageOp::WalAppend {
                doc: doc.clone(),
                owner: one,
                record: rows[0].record.clone(),
                retry: false,
            }),
            ContractAction::ProcessDeath,
            op(StorageOp::WalAppend {
                doc: doc.clone(),
                owner: one,
                record: WalRecord {
                    bytes: vec![99],
                    ..rows[0].record.clone()
                },
                retry: true,
            }),
            op(StorageOp::WalQuarantine {
                doc: doc.clone(),
                owner: one,
                seq: WalSeq(1),
            }),
            op(StorageOp::Load {
                doc: doc.clone(),
                owner: two,
                user: user.clone(),
            }),
        ],
    };
    let mut legacy_image = initial.clone();
    for row in &rows {
        legacy_image
            .entries
            .insert((doc.clone(), WalOwner::Legacy, row.record.seq), row.clone());
    }
    let legacy = StorageCase {
        name: "SC-4 legacy owner adoption is conditional and document scoped",
        initial: legacy_image,
        retention,
        actions: vec![
            op(StorageOp::WalAdopt {
                doc: doc.clone(),
                from: WalOwner::Legacy,
                to: two,
                first_seq: WalSeq(1),
                covers: WalSeq(99),
            }),
            op(StorageOp::WalAdopt {
                doc: doc.clone(),
                from: WalOwner::Legacy,
                to: three,
                first_seq: WalSeq(1),
                covers: WalSeq(99),
            }),
        ],
    };
    let mut users = initial.clone();
    for seq in 1..=3 {
        let mut row = rows[2].clone();
        row.record.seq = WalSeq(seq);
        row.record.user = UserKey("other-user".into());
        row.record.created_at = UnixMillis(if seq == 1 { 999 } else { 1_000 });
        users
            .entries
            .insert((doc.clone(), WalOwner::Session(two), WalSeq(seq)), row);
    }
    let isolation = StorageCase {
        name: "O-2/5 user, TTL-boundary, live lease and assist isolation",
        initial: users,
        retention,
        actions: vec![
            ContractAction::Acquire(doc.clone(), one),
            op(StorageOp::Load {
                doc: doc.clone(),
                owner: three,
                user: user.clone(),
            }),
            ContractAction::Acquire(doc.clone(), two),
            op(StorageOp::LoadOrphans {
                doc: doc.clone(),
                owner: three,
                user: user.clone(),
            }),
            op(StorageOp::WalDropExpired {
                doc: doc.clone(),
                from: WalOwner::Session(two),
                before: UnixMillis(1_000),
            }),
            ContractAction::Release(doc.clone(), two),
            op(StorageOp::WalDropExpired {
                doc: doc.clone(),
                from: WalOwner::Session(two),
                before: UnixMillis(1_000),
            }),
            op(StorageOp::Load {
                doc,
                owner: three,
                user,
            }),
        ],
    };
    vec![adopt, collision, overflow, prune, append, legacy, isolation]
}
