use super::*;

#[test]
fn lost_ack_partition_and_eviction_recover_durable_edits() {
    let script = [
        Step::Open(OpenSpec::form("a", "one")),
        Step::Open(OpenSpec::form("b", "two")),
        Step::Run(Millis(500)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("a".into()),
            count: 1,
        }),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 77,
            },
        },
        Step::Run(Millis(100)),
        Step::Net(NetStep::Partition(ClientName("a".into()))),
        Step::Server(ServerStep::Evict {
            close_sockets: false,
        }),
        Step::Edit {
            client: ClientName("b".into()),
            op: AbstractOp::FormSet {
                field: 3,
                value: 31,
            },
        },
        Step::Run(Millis(36_000)),
        Step::Settle,
    ];
    let outcome = verify(SimConfig::calm(19), &script);
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::Frame { kind: FrameKind::Ack, fate, .. } if fate == "Dropped")));
}

#[test]
fn close_inside_the_coalesce_window_appends_before_stopped() {
    let script = [
        Step::Open(OpenSpec::form("a", "shared")),
        Step::Open(OpenSpec::form("b", "shared")),
        Step::Run(Millis(500)),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 4,
                value: 55,
            },
        },
        Step::Close {
            client: ClientName("a".into()),
        },
        Step::Settle,
    ];
    let outcome = verify(SimConfig::calm(23), &script);
    let durable = outcome
        .events
        .iter()
        .position(|event| matches!(event.fact, Fact::WalDurable { .. }))
        .unwrap();
    let closed = outcome
        .events
        .iter()
        .position(|event| matches!(event.fact, Fact::Closed { .. }))
        .unwrap();
    assert!(durable < closed);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["4"],
        55
    );
}

#[test]
fn frozen_tab_rows_are_assisted_and_tab_death_keeps_issued_transactions() {
    let script = [
        Step::Open(OpenSpec::form("a", "shared")),
        Step::Open(OpenSpec::form("b", "shared")),
        Step::Run(Millis(500)),
        Step::Storage {
            profile: ProfileName("shared".into()),
            fault: StorageFault::Latency(Millis(100), Millis(100)),
        },
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 2,
                value: 99,
            },
        },
        Step::Run(Millis(26)),
        Step::Freeze {
            client: ClientName("a".into()),
        },
        Step::Run(Millis(200)),
        Step::Crash {
            client: ClientName("a".into()),
        },
        Step::ReopenCrashed,
        Step::Settle,
    ];
    let outcome = verify(SimConfig::calm(29), &script);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        99
    );
}

#[test]
fn orphan_transaction_completes_after_tab_crash_and_is_adopted() {
    let script = [
        Step::Open(OpenSpec::form("a", "one")),
        Step::Run(Millis(500)),
        Step::Net(NetStep::Partition(ClientName("a".into()))),
        Step::Storage {
            profile: ProfileName("one".into()),
            fault: StorageFault::Latency(Millis(100), Millis(100)),
        },
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 88,
            },
        },
        Step::Run(Millis(26)),
        Step::Crash {
            client: ClientName("a".into()),
        },
        Step::Run(Millis(200)),
        Step::ReopenCrashed,
        Step::Settle,
    ];
    let outcome = verify(SimConfig::calm(31), &script);
    assert!(outcome.stats.adopted_rows > 0);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        88
    );
}

#[test]
fn directory_and_storage_outages_never_quarantine_good_rows() {
    let script = [
        Step::Open(OpenSpec::form("a", "one")),
        Step::Open(OpenSpec::form("b", "two")),
        Step::Run(Millis(500)),
        Step::Server(ServerStep::D1Outage { ms: Millis(2_000) }),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 17,
            },
        },
        Step::Run(Millis(3_000)),
        Step::Server(ServerStep::StorageErrors { n: 2 }),
        Step::Edit {
            client: ClientName("b".into()),
            op: AbstractOp::FormSet {
                field: 2,
                value: 33,
            },
        },
        Step::Run(Millis(2_000)),
        Step::Settle,
    ];
    verify(SimConfig::calm(37), &script);
}

#[test]
fn revoke_parks_rows_until_writable_regrant() {
    let script = [
        Step::Open(OpenSpec::form("a", "one")),
        Step::Run(Millis(500)),
        Step::Net(NetStep::Partition(ClientName("a".into()))),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 4,
                value: 22,
            },
        },
        Step::Run(Millis(30)),
        Step::Grant {
            client: ClientName("a".into()),
            access: Access::Read,
            force_reconnect: true,
        },
        Step::Run(Millis(1_000)),
        Step::Grant {
            client: ClientName("a".into()),
            access: Access::Edit,
            force_reconnect: true,
        },
        Step::Settle,
    ];
    let outcome = verify(SimConfig::calm(41), &script);
    assert!(
        outcome
            .events
            .iter()
            .any(|event| matches!(&event.fact, Fact::RowsParked { rows, .. } if !rows.is_empty()))
    );
}

#[test]
fn gated_ack_delays_and_callback_crash_replay_real_client_wal() {
    let script = [
        Step::Open(OpenSpec::form("a", "one")),
        Step::Open(OpenSpec::form("b", "two")),
        Step::Run(Millis(500)),
        Step::Server(ServerStep::DelayStorage(Millis(7_000))),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet { field: 0, value: 6 },
        },
        Step::Run(Millis(7_500)),
        Step::Server(ServerStep::Crash {
            after_port_calls: 3,
        }),
        Step::Edit {
            client: ClientName("b".into()),
            op: AbstractOp::FormSet { field: 1, value: 8 },
        },
        Step::Run(Millis(100)),
        Step::Settle,
    ];
    verify(SimConfig::calm(43), &script);
}

#[test]
fn presence_is_document_scoped_and_ai_keys_expire_after_crash() {
    let mut other = OpenSpec::form("other", "other");
    other.doc = DocIx(1);
    let mut ai = OpenSpec::form("ai", "ai");
    ai.kind = ClientKind::AiWorker;
    let script = [
        Step::Open(OpenSpec::form("a", "one")),
        Step::Open(ai),
        Step::Open(other),
        Step::Run(Millis(500)),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::Select(Some(1)),
        },
        Step::Edit {
            client: ClientName("ai".into()),
            op: AbstractOp::Select(Some(2)),
        },
        Step::Edit {
            client: ClientName("other".into()),
            op: AbstractOp::Select(Some(3)),
        },
        Step::Run(Millis(100)),
        Step::Crash {
            client: ClientName("ai".into()),
        },
        Step::Run(Millis(6_000)),
        Step::Settle,
    ];
    verify(
        SimConfig {
            documents: 2,
            ties: TieMode::Perturb,
            ..SimConfig::calm(47)
        },
        &script,
    );
}

#[test]
fn ai_close_flushes_then_lingers_before_clearing() {
    let mut ai = OpenSpec::form("ai", "worker");
    ai.kind = ClientKind::AiWorker;
    let script = [
        Step::Open(OpenSpec::form("a", "one")),
        Step::Open(ai),
        Step::Run(Millis(500)),
        Step::Edit {
            client: ClientName("ai".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 12,
            },
        },
        Step::Edit {
            client: ClientName("ai".into()),
            op: AbstractOp::Select(Some(1)),
        },
        Step::Close {
            client: ClientName("ai".into()),
        },
        Step::Settle,
    ];
    verify(SimConfig::calm(53), &script);
}

#[test]
fn settlement_reopens_the_only_gracefully_closed_tab_to_drain_its_wal() {
    let outcome = verify(
        SimConfig::calm(59),
        &[
            Step::Open(OpenSpec::form("a", "only-profile")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 81,
                },
            },
            Step::Close {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
    let closed = outcome
        .events
        .iter()
        .position(|event| matches!(event.fact, Fact::Closed { .. }))
        .unwrap();
    assert!(
        outcome.events[closed + 1..]
            .iter()
            .any(|event| matches!(event.fact, Fact::Opened { .. }))
    );
    assert!(outcome.stats.adopted_rows > 0);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        81
    );
    invariants::no_edit_lost_without_crash(&outcome).unwrap();
}

#[test]
fn concurrent_four_client_moves_and_fields_replay_across_many_seeds() {
    let script = [
        Step::Open(OpenSpec::form("a", "one")),
        Step::Open(OpenSpec::form("b", "two")),
        Step::Open(OpenSpec::form("c", "three")),
        Step::Open(OpenSpec::form("d", "four")),
        Step::Run(Millis(500)),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 42,
            },
        },
        Step::Edit {
            client: ClientName("b".into()),
            op: AbstractOp::FormMove { from: 1, to: 4 },
        },
        Step::Edit {
            client: ClientName("c".into()),
            op: AbstractOp::FormSet {
                field: 2,
                value: 79,
            },
        },
        Step::Edit {
            client: ClientName("d".into()),
            op: AbstractOp::FormMove { from: 3, to: 0 },
        },
        Step::Settle,
    ];
    for seed in 0..32 {
        verify(
            SimConfig {
                ties: TieMode::Perturb,
                ..SimConfig::calm(seed)
            },
            &script,
        );
    }
}

#[test]
fn cached_local_s3_and_remote_each_win_once_without_replacing_later_edits() {
    for (local_after, s3_after, expected) in [
        (1, 1_500, "Local"),
        (500, 1, "CachedS3"),
        (500, 1_500, "Remote"),
    ] {
        let mut config = SimConfig::calm(79);
        config.storage.latency = (Millis(local_after), Millis(local_after));
        config.seeds.insert(
            DocIx(0),
            SeedDocument::Cached {
                server: vec![(1, 42)],
                s3: Some((vec![(1, 23)], Millis(s3_after))),
                local: (expected != "Remote").then_some(vec![(1, 7)]),
            },
        );
        let outcome = verify(
            config,
            &[
                Step::Open(OpenSpec::form("a", "cached-profile")),
                Step::Run(Millis(800)),
                Step::Edit {
                    client: ClientName("a".into()),
                    op: AbstractOp::FormSet {
                        field: 2,
                        value: 81,
                    },
                },
                Step::Settle,
            ],
        );
        let winners = outcome
            .events
            .iter()
            .filter_map(|event| match &event.fact {
                Fact::Seeded { kind, .. } => Some(kind.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(winners, [expected]);
        assert_eq!(
            outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
            42
        );
        assert_eq!(
            outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
            81
        );
    }
}

#[test]
fn cached_reopen_adopts_and_replays_durable_wal_after_seed_choice() {
    let mut config = SimConfig::calm(83);
    config.seeds.insert(
        DocIx(0),
        SeedDocument::Cached {
            server: vec![(1, 42)],
            s3: Some((vec![(1, 23)], Millis(1_500))),
            local: Some(vec![(1, 7)]),
        },
    );
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "cached-profile")),
            Step::Run(Millis(800)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 81,
                },
            },
            Step::Run(Millis(40)),
            Step::Crash {
                client: ClientName("a".into()),
            },
            Step::ReopenCrashed,
            Step::Settle,
        ],
    );
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(event.fact, Fact::Seeded { .. }))
            .count(),
        2
    );
    let adopted = outcome
        .events
        .iter()
        .position(|event| matches!(event.fact, Fact::WalAdopted { .. }))
        .unwrap();
    assert!(
        outcome.events[adopted + 1..]
            .iter()
            .any(|event| matches!(&event.fact,
        Fact::Imported { origin, error: None, .. } if origin == "WalReplay"))
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        81
    );
    assert!(outcome.stats.adopted_rows > 0);
}
