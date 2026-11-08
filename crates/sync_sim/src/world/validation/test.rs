use super::*;
use doc_sync_core::{StoredSnapshot, StoredWalRecord, UserKey, WalOwner, WalRecord, WalSeq};

fn prefix_world() -> Sim {
    let mut sim = Sim::new(SimConfig::calm(179));
    let mut store = SimStorage::new(StorageProfile::fast());
    let doc: doc_sync_core::SyncDocId = "00000000-0000-7000-8000-000000000001".parse().unwrap();
    let session = SessionId(uuid_value::Uuid::from_u128(1));
    for seq in [WalSeq(1), WalSeq(2)] {
        store.durable.entries.insert(
            (doc.clone(), WalOwner::Session(session), seq),
            StoredWalRecord {
                delivered: true,
                record: WalRecord {
                    seq,
                    created_at: doc_sync_core::UnixMillis(100),
                    user: UserKey("user-0".into()),
                    foreign: false,
                    quarantined: false,
                    bytes: vec![1],
                },
            },
        );
    }
    store.durable.snapshots.insert(
        doc,
        StoredSnapshot {
            bytes: vec![1],
            covers: Some((session, WalSeq(2))),
        },
    );
    sim.profiles.insert(ProfileName("browser".into()), store);
    sim.validate();
    assert!(sim.failures.is_empty());
    sim
}
#[test]
fn a_delivered_prefix_cannot_disappear_or_regress_without_completed_deletion() {
    let mut sim = prefix_world();
    for row in sim
        .profiles
        .get_mut(&ProfileName("browser".into()))
        .unwrap()
        .durable
        .entries
        .values_mut()
    {
        row.delivered = false;
    }
    sim.validate();
    assert!(
        sim.failures
            .iter()
            .any(|failure| failure.invariant == "durable_prefix_monotone")
    );
    let mut sim = prefix_world();
    sim.profiles
        .get_mut(&ProfileName("browser".into()))
        .unwrap()
        .durable
        .entries
        .clear();
    sim.validate();
    assert!(
        sim.failures
            .iter()
            .any(|failure| failure.invariant == "durable_prefix_monotone")
    );
}
#[test]
fn completed_prune_allows_the_old_prefix_namespace_to_disappear() {
    let mut sim = prefix_world();
    let profile = ProfileName("browser".into());
    let session = SessionId(uuid_value::Uuid::from_u128(1));
    let store = sim.profiles.get_mut(&profile).unwrap();
    let (token, at) = store.issue(
        PendingWrite {
            client: ClientName("a".into()),
            session,
            id: doc_sync_core::StorageOpId(1),
            op: doc_sync_core::StorageOp::WalPrune {
                doc: "00000000-0000-7000-8000-000000000001".parse().unwrap(),
                owner: session,
                through: WalSeq(2),
            },
        },
        0,
        &mut sim.rng,
    );
    let completion = store
        .complete(token, &profile, at, doc_sync_core::UnixMillis(100))
        .unwrap();
    assert!(completion.facts.iter().any(
        |fact| matches!(fact, Fact::WalPruned { seqs, .. } if seqs == &[WalSeq(1), WalSeq(2)])
    ));
    for fact in completion.facts {
        sim.emit(fact);
    }
    sim.validate();
    assert!(sim.failures.is_empty(), "{:?}", sim.failures);
    assert!(sim.prefixes.is_empty());
}
#[test]
fn in_flight_checks_enforce_pushable_ranges_and_batch_bounds() {
    let rows = [
        FlightRow {
            seq: WalSeq(1),
            bytes: 10,
            eligible: true,
            writing: false,
        },
        FlightRow {
            seq: WalSeq(2),
            bytes: 10,
            eligible: false,
            writing: false,
        },
        FlightRow {
            seq: WalSeq(3),
            bytes: 10,
            eligible: true,
            writing: false,
        },
    ];
    assert!(check_flight(&[WalSeq(1), WalSeq(3)], &rows, None).is_ok());
    assert!(check_flight(&[WalSeq(3)], &rows, None).is_err());
    assert!(check_flight(&[WalSeq(1), WalSeq(2), WalSeq(3)], &rows, None).is_err());
    assert!(check_flight(&[WalSeq(1), WalSeq(3)], &rows, Some(WalSeq(1))).is_err());
    let rows = (1..=65)
        .map(|seq| FlightRow {
            seq: WalSeq(seq),
            bytes: 10,
            eligible: true,
            writing: false,
        })
        .collect::<Vec<_>>();
    assert!(check_flight(&(1..=65).map(WalSeq).collect::<Vec<_>>(), &rows, None).is_err());
    let rows = [FlightRow {
        seq: WalSeq(1),
        bytes: 256 * 1024 + 1,
        eligible: true,
        writing: false,
    }];
    assert!(check_flight(&[WalSeq(1)], &rows, None).is_ok());
    let rows = [
        FlightRow {
            seq: WalSeq(1),
            bytes: 256 * 1024,
            eligible: true,
            writing: false,
        },
        FlightRow {
            seq: WalSeq(2),
            bytes: 1,
            eligible: true,
            writing: false,
        },
    ];
    assert!(check_flight(&[WalSeq(1), WalSeq(2)], &rows, None).is_err());
    let rows = [FlightRow {
        seq: WalSeq(1),
        bytes: 1,
        eligible: true,
        writing: true,
    }];
    assert!(check_flight(&[WalSeq(1)], &rows, None).is_err());
}
#[test]
fn real_client_push_diagnostics_are_observed_while_the_ack_is_gated() {
    let mut sim = Sim::new(SimConfig::calm(181));
    sim.step(Step::Open(OpenSpec::form("a", "browser")))
        .unwrap();
    sim.advance(800);
    sim.step(Step::Server(ServerStep::DelayStorage(Millis(5000))))
        .unwrap();
    sim.step(Step::Edit {
        client: ClientName("a".into()),
        op: AbstractOp::FormSet {
            field: 1,
            value: 42,
        },
    })
    .unwrap();
    sim.advance(100);
    assert!(
        sim.clients[&ClientName("a".into())]
            .core
            .push_in_flight()
            .is_some()
    );
    sim.validate();
    assert!(sim.failures.is_empty(), "{:?}", sim.failures);
    invariants::check_all(&sim.run(&[Step::Settle])).unwrap();
}

#[test]
fn power_loss_exempts_only_delivery_flags_that_actually_rolled_back() {
    let mut sim = prefix_world();
    let profile = ProfileName("browser".into());
    let owner = SessionId(uuid_value::Uuid::from_u128(2));
    let doc: doc_sync_core::SyncDocId = "00000000-0000-7000-8000-000000000001".parse().unwrap();
    for (at, op) in [
        (
            10,
            doc_sync_core::StorageOp::WalAppend {
                doc: doc.clone(),
                owner,
                retry: false,
                record: WalRecord {
                    seq: WalSeq(1),
                    created_at: doc_sync_core::UnixMillis(100),
                    user: UserKey("user-0".into()),
                    foreign: false,
                    quarantined: false,
                    bytes: vec![2],
                },
            },
        ),
        (
            100,
            doc_sync_core::StorageOp::WalMarkDelivered {
                doc: doc.clone(),
                owner,
                through: WalSeq(1),
            },
        ),
    ] {
        let store = sim.profiles.get_mut(&profile).unwrap();
        let (token, at) = store.issue(
            PendingWrite {
                client: ClientName("b".into()),
                session: owner,
                id: doc_sync_core::StorageOpId(1),
                op,
            },
            at,
            &mut sim.rng,
        );
        let completion = store
            .complete(token, &profile, at, doc_sync_core::UnixMillis(100))
            .unwrap();
        for fact in completion.facts {
            sim.emit(fact);
        }
    }
    sim.validate();
    assert_eq!(sim.prefixes.len(), 2);
    let facts = sim.profiles.get_mut(&profile).unwrap().crash(
        &CrashMode::PowerLoss { window: Millis(10) },
        &profile,
        105,
    );
    assert!(facts.iter().any(|fact| matches!(fact, Fact::WalDeliveryLost { owner: WalOwner::Session(session), seqs, .. } if *session == owner && seqs == &[WalSeq(1)])));
    for fact in facts {
        sim.emit(fact);
    }
    sim.validate();
    assert!(sim.failures.is_empty(), "{:?}", sim.failures);
    assert_eq!(sim.prefixes.len(), 1);
    assert!(sim.prefixes.keys().all(|(_, _, retained)| *retained
        == WalOwner::Session(SessionId(uuid_value::Uuid::from_u128(1)))));
}

#[test]
fn legacy_adoption_never_exempts_another_documents_prefix_regression() {
    let mut sim = Sim::new(SimConfig {
        documents: 2,
        ..SimConfig::calm(191)
    });
    let profile = ProfileName("browser".into());
    let first: doc_sync_core::SyncDocId = "00000000-0000-7000-8000-000000000001".parse().unwrap();
    let second: doc_sync_core::SyncDocId = "00000000-0000-7000-8000-000000000002".parse().unwrap();
    let session = SessionId(uuid_value::Uuid::from_u128(1));
    let mut store = SimStorage::new(StorageProfile::fast());
    for doc in [first.clone(), second.clone()] {
        store.durable.entries.insert(
            (doc, WalOwner::Legacy, WalSeq(1)),
            StoredWalRecord {
                delivered: true,
                record: WalRecord {
                    seq: WalSeq(1),
                    created_at: doc_sync_core::UnixMillis(100),
                    user: UserKey("user-0".into()),
                    foreign: false,
                    quarantined: false,
                    bytes: vec![1],
                },
            },
        );
    }
    sim.profiles.insert(profile.clone(), store);
    sim.validate();
    assert!(sim.failures.is_empty());
    let store = sim.profiles.get_mut(&profile).unwrap();
    let expected = store
        .image()
        .entries
        .iter()
        .filter(|((doc, owner, _), _)| doc == &first && *owner == WalOwner::Legacy)
        .map(|(_, row)| row.clone())
        .collect();
    let (token, at) = store.issue(
        PendingWrite {
            client: ClientName("a".into()),
            session,
            id: doc_sync_core::StorageOpId(1),
            op: doc_sync_core::StorageOp::WalAdopt {
                doc: first,
                from: WalOwner::Legacy,
                to: session,
                first_seq: WalSeq(10),
                covers: WalSeq(0),
                expected,
            },
        },
        0,
        &mut sim.rng,
    );
    let completion = store
        .complete(token, &profile, at, doc_sync_core::UnixMillis(100))
        .unwrap();
    assert!(matches!(
        completion.event,
        doc_sync_core::StorageEvent::Adopted { result: Ok(1), .. }
    ));
    assert!(completion.facts.iter().any(
        |fact| matches!(fact, Fact::WalAdopted { map, .. } if map == &[(WalSeq(1), WalSeq(10))])
    ));
    store
        .durable
        .entries
        .get_mut(&(second.clone(), WalOwner::Legacy, WalSeq(1)))
        .unwrap()
        .delivered = false;
    for fact in completion.facts {
        sim.emit(fact);
    }
    sim.validate();
    assert_eq!(sim.failures.len(), 1, "{:?}", sim.failures);
    assert_eq!(sim.failures[0].invariant, "durable_prefix_monotone");
    assert!(sim.failures[0].detail.contains(second.as_str()));
}

#[test]
fn borrowed_canonical_serialization_retains_exact_tree_bytes_and_trace_hash() {
    let value = serde_json::json!({"z": [null, true, -2, 4.5, {"b": 2, "a": 1}], "a": "text"});
    assert_eq!(
        postcard::to_allocvec(&Canonical(&value)).unwrap(),
        postcard::to_allocvec(&canonical(value.clone())).unwrap()
    );
    let outcome = Sim::new(SimConfig::calm(211)).run(&[
        Step::Open(OpenSpec::form("a", "browser")),
        Step::Run(Millis(500)),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 42,
            },
        },
        Step::Settle,
    ]);
    let ports = outcome
        .server_ports
        .iter()
        .map(|port| {
            (
                port.doc,
                port.callback,
                port.effect.operation.clone(),
                canonical(port.effect.value.clone()),
            )
        })
        .collect::<Vec<_>>();
    let bytes = postcard::to_allocvec(&(
        outcome.event_bytes.as_slice(),
        ports,
        canonical_finals(&outcome.finals),
        canonical_finals(&outcome.finals_after_quiet),
    ))
    .unwrap();
    assert_eq!(outcome.trace_hash, xxhash_rust::xxh3::xxh3_64(&bytes));
}

#[test]
fn actual_delivery_above_a_true_gap_requires_both_core_and_cold_proof() {
    use doc_sync_core::{UnixMillis, WalRecord};
    let mut sim = Sim::new(SimConfig::calm(239));
    let donor = sim
        .register_external(OpenSpec::form("donor", "old"))
        .unwrap();
    let other = sim
        .register_external(OpenSpec::form("independent", "other"))
        .unwrap();
    let history = loro::LoroDoc::new();
    history.set_peer_id(donor.peer).unwrap();
    history.get_map("fields").insert("1", 11).unwrap();
    history.commit();
    let before = history.oplog_vv();
    history.get_map("fields").insert("1", 12).unwrap();
    history.commit();
    let tail = history.export(loro::ExportMode::updates(&before)).unwrap();
    sim.external_versions(
        &ClientName("donor".into()),
        crate::document::vv(&history.oplog_vv()),
    )
    .unwrap();
    let independent = loro::LoroDoc::new();
    independent.set_peer_id(other.peer).unwrap();
    independent.get_map("fields").insert("2", 22).unwrap();
    independent.commit();
    sim.external_versions(
        &ClientName("independent".into()),
        crate::document::vv(&independent.oplog_vv()),
    )
    .unwrap();
    let rows = vec![
        WalRecord {
            seq: WalSeq(2),
            created_at: UnixMillis(sim.clock.wall(0)),
            user: UserKey("user-0".into()),
            foreign: false,
            quarantined: false,
            bytes: tail,
        },
        WalRecord {
            seq: WalSeq(3),
            created_at: UnixMillis(sim.clock.wall(0)),
            user: UserKey("user-0".into()),
            foreign: false,
            quarantined: false,
            bytes: independent.export(loro::ExportMode::all_updates()).unwrap(),
        },
    ];
    let key: doc_sync_core::SyncDocId = "00000000-0000-7000-8000-000000000001".parse().unwrap();
    let mut store = SimStorage::new(StorageProfile::fast());
    for record in rows {
        store.durable.entries.insert(
            (key.clone(), WalOwner::Legacy, record.seq),
            StoredWalRecord {
                record,
                delivered: false,
            },
        );
    }
    sim.profiles.insert(ProfileName("browser".into()), store);
    let outcome = sim.run(&[
        Step::Open(OpenSpec::form("recovery", "browser")),
        Step::Run(Millis(2_000)),
    ]);
    assert!(
        outcome.per_step_failures.is_empty(),
        "{:?}",
        outcome.per_step_failures
    );
    let recovered = &outcome.finals.clients[&ClientName("recovery".into())];
    assert!(recovered.parked.iter().any(|(_, reason)| reason == "Gap"));
    assert!(!recovered.delivered.is_empty());
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        22
    );
    invariants::all_wals_drained(&outcome).unwrap();
    invariants::no_acked_edit_lost(&outcome).unwrap();
    let mut no_proof = outcome.clone();
    no_proof
        .finals
        .clients
        .get_mut(&ClientName("recovery".into()))
        .unwrap()
        .delivered
        .clear();
    assert!(invariants::all_wals_drained(&no_proof).is_err());
    let mut no_cold_proof = outcome.clone();
    no_cold_proof
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(invariants::all_wals_drained(&no_cold_proof).is_err());
}

#[test]
fn settlement_drains_an_issued_router_token_failure_through_the_real_route() {
    let mut config = SimConfig::routed(257);
    config.net.connect_latency = (Millis(10), Millis(10));
    let mut sim = Sim::new(config);
    sim.apply_step(Step::Open(OpenSpec::form("a", "browser")))
        .unwrap();
    sim.apply_step(Step::TokenFetchFail {
        client: ClientName("a".into()),
        n: 1,
    })
    .unwrap();
    sim.advance(10);
    let failed_at = sim
        .clock
        .pending_token_failures_until()
        .expect("actual issued router token failure");
    assert!(failed_at > sim.clock.now);
    sim.apply_step(Step::Settle).unwrap();
    let outcome = sim.run(&[]);
    invariants::check_all(&outcome).unwrap();
    let initial_at = outcome.events.iter().find_map(|event| matches!(&event.fact, Fact::Frame { client, kind: FrameKind::InitialSync, fate, .. } if client.0 == "a" && fate == "Delivered").then_some(event.at.0)).unwrap();
    assert!(initial_at > failed_at);
}
