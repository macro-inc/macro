use super::*;

#[test]
fn two_documents_share_one_physical_router_and_recover_together() {
    let outcome = verify(
        SimConfig {
            ..SimConfig::routed(127)
        },
        &[
            Step::Open(OpenSpec::form("a", "browser")),
            Step::Open(OpenSpec {
                doc: DocIx(1),
                ..OpenSpec::form("b", "browser")
            }),
            Step::Run(Millis(800)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 81,
                },
            },
            Step::Run(Millis(200)),
            Step::Net(NetStep::Break(ClientName("b".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 3,
                    value: 67,
                },
            },
            Step::Settle,
        ],
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["3"],
        67
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(1)].deep_value["fields"]["2"],
        81
    );
    let opened = outcome
        .events
        .iter()
        .filter_map(|event| match &event.fact {
            Fact::RouterSocket {
                profile,
                connection,
                open: true,
            } => Some((profile.clone(), *connection)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        opened,
        [
            (ProfileName("browser".into()), 1),
            (ProfileName("browser".into()), 2)
        ]
    );
}

#[test]
fn joining_a_route_resubscribes_and_detaching_one_owner_keeps_other_routes() {
    let outcome = verify(
        SimConfig {
            ..SimConfig::routed(131)
        },
        &[
            Step::Open(OpenSpec::form("a", "browser")),
            Step::Open(OpenSpec {
                doc: DocIx(1),
                ..OpenSpec::form("b", "browser")
            }),
            Step::Run(Millis(800)),
            Step::Open(OpenSpec::form("c", "browser")),
            Step::Run(Millis(800)),
            Step::Edit {
                client: ClientName("c".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
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
            Step::Settle,
        ],
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(1)].deep_value["fields"]["2"],
        81
    );
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(event.fact, Fact::RouterSocket { open: true, .. }))
            .count(),
        1
    );
    assert_eq!(
        outcome
            .server_ports
            .iter()
            .filter(|port| port.doc == DocIx(0) && port.effect.operation == "connections.accept")
            .count(),
        2
    );
    assert!(outcome.server_ports.iter().any(|port| {
        port.doc == DocIx(0)
            && port.effect.operation == "storage.delete"
            && port
                .effect
                .value
                .as_str()
                .is_some_and(|key| key.starts_with("ws_id"))
    }));
}

#[test]
fn routed_graceful_close_reopens_to_recover_the_coalesce_window() {
    verify(
        SimConfig {
            ..SimConfig::routed(137)
        },
        &[
            Step::Open(OpenSpec::form("a", "browser")),
            Step::Open(OpenSpec {
                doc: DocIx(1),
                ..OpenSpec::form("b", "browser")
            }),
            Step::Run(Millis(800)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Close {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
}

#[test]
fn routed_partition_and_lost_ack_replay_across_profiles_and_ties() {
    let script = [
        Step::Open(OpenSpec::form("a", "one")),
        Step::Open(OpenSpec {
            doc: DocIx(1),
            ..OpenSpec::form("b", "one")
        }),
        Step::Open(OpenSpec::form("c", "two")),
        Step::Run(Millis(800)),
        Step::Net(NetStep::Partition(ClientName("b".into()))),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 42,
            },
        },
        Step::Edit {
            client: ClientName("b".into()),
            op: AbstractOp::FormSet {
                field: 2,
                value: 81,
            },
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("c".into()),
            count: 1,
        }),
        Step::Edit {
            client: ClientName("c".into()),
            op: AbstractOp::FormSet {
                field: 3,
                value: 67,
            },
        },
        Step::Run(Millis(800)),
        Step::Net(NetStep::Heal(ClientName("b".into()))),
        Step::Run(Millis(6000)),
        Step::Settle,
    ];
    for seed in 140..148 {
        verify(
            SimConfig {
                documents: 2,
                ties: TieMode::Perturb,
                ..SimConfig::routed(seed)
            },
            &script,
        );
    }
}

#[test]
fn routed_corruption_uses_inner_payloads_and_recovery_preserves_other_routes() {
    let outcome = verify(
        SimConfig {
            ..SimConfig::routed(149)
        },
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec {
                doc: DocIx(1),
                ..OpenSpec::form("b", "one")
            }),
            Step::Open(OpenSpec::form("c", "two")),
            Step::Run(Millis(800)),
            Step::Net(NetStep::CorruptNext {
                client: ClientName("a".into()),
                direction: Direction::ToClient,
            }),
            Step::Edit {
                client: ClientName("c".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 81,
                },
            },
            Step::Run(Millis(500)),
            Step::Settle,
        ],
    );
    assert!(outcome.events.iter().any(
        |event| matches!(&event.fact, Fact::Telemetry { name, .. } if name == "doc.sync.reset")
    ));
    assert!(
        outcome
            .events
            .iter()
            .any(|event| matches!(&event.fact, Fact::Frame { fate, .. } if fate == "Corrupted"))
    );
}

#[test]
fn routed_process_death_and_offline_handshakes_recover() {
    verify(
        SimConfig {
            ..SimConfig::routed(151)
        },
        &[
            Step::Open(OpenSpec::form("a", "browser")),
            Step::Open(OpenSpec {
                doc: DocIx(1),
                ..OpenSpec::form("b", "browser")
            }),
            Step::Run(Millis(800)),
            Step::Offline {
                client: ClientName("b".into()),
                offline: true,
            },
            Step::Net(NetStep::Break(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 81,
                },
            },
            Step::Run(Millis(1000)),
            Step::Offline {
                client: ClientName("b".into()),
                offline: false,
            },
            Step::CrashProfile {
                profile: ProfileName("browser".into()),
                mode: CrashMode::ProcessDeath,
            },
            Step::ReopenCrashed,
            Step::Settle,
        ],
    );
}

#[test]
fn closing_every_route_releases_the_physical_socket_before_reopen() {
    let outcome = verify(
        SimConfig {
            ..SimConfig::routed(157)
        },
        &[
            Step::Open(OpenSpec::form("a", "browser")),
            Step::Open(OpenSpec {
                doc: DocIx(1),
                ..OpenSpec::form("b", "browser")
            }),
            Step::Run(Millis(800)),
            Step::Close {
                client: ClientName("a".into()),
            },
            Step::Close {
                client: ClientName("b".into()),
            },
            Step::Run(Millis(200)),
            Step::Settle,
        ],
    );
    let closes = outcome
        .events
        .iter()
        .filter(|event| {
            matches!(
                event.fact,
                Fact::RouterSocket {
                    connection: 1,
                    open: false,
                    ..
                }
            )
        })
        .count();
    assert_eq!(closes, 2); // One dial, then one actual close of generation one.
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(event.fact, Fact::RouterSocket { open: true, .. }))
            .count(),
        2
    );
}

#[test]
fn routed_tabs_and_a_direct_ai_worker_share_the_real_room() {
    verify(
        SimConfig {
            ..SimConfig::routed(163)
        },
        &[
            Step::Open(OpenSpec::form("a", "browser")),
            Step::Open(OpenSpec {
                doc: DocIx(1),
                ..OpenSpec::form("b", "browser")
            }),
            Step::Open(OpenSpec {
                kind: ClientKind::AiWorker,
                ..OpenSpec::form("agent", "worker")
            }),
            Step::Run(Millis(800)),
            Step::Edit {
                client: ClientName("agent".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
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
}
