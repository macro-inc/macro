use super::*;

/// covers: S7:11, S7:9
#[test]
fn reset_flushes_the_window_and_keeps_edits_made_during_reset() {
    let mut config = SimConfig::calm(61);
    config.net.latency = (Millis(50), Millis(50));
    config.storage.latency = (Millis(50), Millis(50));
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(1_000)),
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 80,
                },
            },
            Step::Net(NetStep::CorruptNext {
                client: ClientName("b".into()),
                direction: Direction::ToClient,
            }),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(200)),
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 81,
                },
            },
            Step::Settle,
        ],
    );
    assert_eq!(outcome.stats.resets, 1);
    assert_eq!(outcome.stats.skipped_ops, 0);
    let start = outcome.events.iter().position(|event| matches!(&event.fact, Fact::Telemetry { phase: TelemetryPhase::Start, name, .. } if name == "doc.sync.reset")).unwrap();
    assert!(
        outcome.events[start..]
            .iter()
            .any(|event| matches!(&event.fact, Fact::LocalOp { client, .. } if client.0 == "b"))
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        81
    );
}
/// covers: S7:12
#[test]
fn corrupt_reset_snapshot_fails_then_a_later_reset_recovers() {
    let mut config = SimConfig::calm(67);
    config.net.latency = (Millis(100), Millis(100));
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(1_000)),
            Step::Net(NetStep::CorruptNext {
                client: ClientName("b".into()),
                direction: Direction::ToClient,
            }),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(250)),
            Step::Net(NetStep::CorruptNext {
                client: ClientName("b".into()),
                direction: Direction::ToClient,
            }),
            Step::Run(Millis(1_000)),
            Step::Net(NetStep::CorruptNext {
                client: ClientName("b".into()),
                direction: Direction::ToClient,
            }),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 43,
                },
            },
            Step::Run(Millis(500)),
            Step::Settle,
        ],
    );
    assert!(outcome.stats.resets >= 2, "resets={} facts={:?}", outcome.stats.resets, outcome.events.iter().filter(|event| matches!(&event.fact, Fact::Telemetry { name, .. } if name == "doc.sync.reset" || name.starts_with("span.end:")) || matches!(&event.fact, Fact::Frame { fate, .. } if fate == "Corrupted")).collect::<Vec<_>>());
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::Telemetry { phase: TelemetryPhase::End, name, .. } if name == "span.end:failed")));
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::Telemetry { phase: TelemetryPhase::End, name, .. } if name == "span.end:replaced")));
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        43
    );
}
/// covers: S7:42, S7:16
#[test]
fn offline_reopen_remote_seed_wins_and_rebases_once() {
    let mut config = SimConfig::calm(71);
    config.seeds.insert(
        DocIx(0),
        SeedDocument::Cached {
            server: vec![],
            s3: None,
            local: None,
        },
    );
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::LoseAcks {
                client: ClientName("a".into()),
                count: 1,
            }),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet { field: 0, value: 7 },
            },
            Step::Run(Millis(1_000)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(100)),
            Step::Crash {
                client: ClientName("a".into()),
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 81,
                },
            },
            Step::Run(Millis(100)),
            Step::Reopen {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
    assert_eq!(outcome.stats.rebases, 1, "rebases={:?}", outcome.events.iter().filter(|event| matches!(&event.fact, Fact::Telemetry { name, .. } if name == "doc.sync.rebase") || matches!(event.fact, Fact::WalAdopted { .. } | Fact::Seeded { .. } )).collect::<Vec<_>>());
    assert_eq!(outcome.stats.resets, 0);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
}
