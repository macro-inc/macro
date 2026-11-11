use crate::client::Identity;
use crate::*;
use doc_sync_core::{
    IoEffect, LocalState, Now, OrphanWal, PaletteColor, SeedKind, SessionId, StorageEvent,
    StorageOp, StoredWalRecord, SyncEvent, SyncInput, UnixMillis, UserKey, WalOwner, WalRecord,
    WalSeq,
};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, ..ProptestConfig::default() })]
    #[test]
    fn startup_seed_orderings_replay_every_adopted_row(
        kind in 0u8..4, before_load in any::<bool>(), reverse in any::<bool>(),
        rows in 1usize..5, delay in 0u64..30_000,
    ) {
        let empty_snapshot = loro::LoroDoc::new().export(loro::ExportMode::snapshot()).unwrap();
        let mut defaults = SessionDefaults::production();
        defaults.transport = TransportKind::None;
        let now = Now { mono: doc_sync_core::Millis(0), wall: UnixMillis(0) };
        let mut client = SimClient::new(OpenSpec::form("a", "one"), Identity {
            doc: "startup-document".parse().unwrap(), session: SessionId(uuid_value::Uuid::from_u128(9)),
            peer: 99, user: "fixture-user".into(), color: PaletteColor::Blue,
        }, vec![100,101,102], now, &defaults, false).unwrap();
        let start = client.core.handle(SyncInput::Start, now).out;
        let load = start.io.iter().find_map(|effect| match effect {
            IoEffect::Storage { id, op: StorageOp::Load { .. } } => Some(*id), _ => None,
        }).unwrap();
        let kind = [SeedKind::Local, SeedKind::Remote, SeedKind::CachedS3, SeedKind::Optimistic][usize::from(kind)];
        if before_load {
            let out = client.core.handle(SyncInput::Seed { kind, snapshot: empty_snapshot.clone() }, now).out;
            prop_assert!(!out.events.iter().any(|e| matches!(e, SyncEvent::Seeded { .. })), "seed before adoption");
        }
        let mut orphans = vec![];
        for i in 0..rows {
            let source = loro::LoroDoc::new();
            source.set_peer_id(u64::try_from(i).unwrap()+1).unwrap();
            source.get_map("fields").insert(&i.to_string(), "durable😀").unwrap();
            source.commit_with(loro::CommitOptions::default().timestamp(0));
            orphans.push(OrphanWal { owner: WalOwner::Session(SessionId(uuid_value::Uuid::from_u128(u128::try_from(i).unwrap()+20))),
                records: vec![StoredWalRecord { delivered: false, record: WalRecord {
                    seq: WalSeq(1), created_at: UnixMillis(0), user: UserKey("fixture-user".into()),
                    foreign: false, quarantined: false,
                    bytes: source.export(loro::ExportMode::all_updates()).unwrap(),
                }}],
            });
        }
        let loaded = client.core.handle(SyncInput::Storage(StorageEvent::Loaded {
            id: load, result: Ok(LocalState { snapshot: None, orphans, assist: vec![] }),
        }), now).out;
        let mut ids = loaded.io.iter().filter_map(|e| match e {
            IoEffect::Storage { id, op: StorageOp::WalAdopt { .. } } => Some(*id), _ => None,
        }).collect::<Vec<_>>();
        prop_assert_eq!(ids.len(), rows);
        if reverse { ids.reverse(); }
        let now = Now { mono: doc_sync_core::Millis(delay), wall: UnixMillis(i64::try_from(delay).unwrap()) };
        if !before_load {
            let out = client.core.handle(SyncInput::Seed { kind, snapshot: empty_snapshot.clone() }, now).out;
            prop_assert!(!out.events.iter().any(|e| matches!(e, SyncEvent::Seeded { .. })), "seed before adoption");
        }
        let out = client.core.handle(SyncInput::Tick, now).out;
        prop_assert!(!out.events.iter().any(|e| matches!(e, SyncEvent::Seeded { .. })), "seed before adoption");
        for (index, id) in ids.into_iter().enumerate() {
            let out = client.core.handle(SyncInput::Storage(StorageEvent::Adopted { id, result: Ok(1) }), now).out;
            prop_assert_eq!(out.events.iter().filter(|e| matches!(e, SyncEvent::Seeded { .. })).count(), usize::from(index+1 == rows));
        }
        let value = client.core.value().unwrap();
        for i in 0..rows { prop_assert_eq!(&value["fields"][i.to_string()], "durable😀"); }
    }
}

#[test]
fn seed_adoption_invariant_rejects_early_seed_and_requires_exact_callback() {
    let mut outcome = Sim::new(SimConfig::calm(819)).run(&[Step::Settle]);
    let client = ClientName("a".into());
    let session = SessionId(uuid_value::Uuid::from_u128(1));
    let id = 1;
    let issued = Event {
        at: Millis(0),
        fact: Fact::WalAdoptionIssued {
            client: client.clone(),
            session,
            id,
        },
    };
    let seed = Event {
        at: Millis(1),
        fact: Fact::Seeded {
            client: client.clone(),
            session,
            kind: "Optimistic".into(),
            replayed_wal: 0,
        },
    };
    outcome.events = vec![issued.clone(), seed.clone()];
    assert!(invariants::no_seed_over_unadopted_wal(&outcome).is_err());
    outcome.events.insert(
        1,
        Event {
            at: Millis(1),
            fact: Fact::WalAdoptionCompleted {
                client: client.clone(),
                session,
                id: 2,
            },
        },
    );
    assert!(invariants::no_seed_over_unadopted_wal(&outcome).is_err());
    outcome.events = vec![
        issued,
        Event {
            at: Millis(1),
            fact: Fact::WalAdoptionCompleted {
                client,
                session,
                id,
            },
        },
        seed,
    ];
    invariants::no_seed_over_unadopted_wal(&outcome).unwrap();
}
