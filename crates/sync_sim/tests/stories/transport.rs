use super::*;

/// covers: S7:73, S7:75
#[test]
fn connect_timeout_closes_abandoned_socket_then_recovers() {
    let outcome = verify(
        SimConfig::calm(47),
        &[
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(16_000)),
            Step::Settle,
        ],
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::SocketClose { reason, .. } if reason == "ConnectTimeout")));
}
/// covers: S7:96, S7:32
#[test]
fn flush_reports_not_drained_then_drained_after_heal() {
    let outcome = verify(
        SimConfig::calm(53),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Flush {
                client: ClientName("a".into()),
            },
            Step::Run(Millis(16_000)),
            Step::Settle,
            Step::Flush {
                client: ClientName("a".into()),
            },
            Step::Run(Millis(100)),
        ],
    );
    assert!(outcome.events.iter().any(
        |event| matches!(&event.fact, Fact::Reply { reply, .. } if reply.contains("NotDrained"))
    ));
    assert!(outcome.events.iter().any(
        |event| matches!(&event.fact, Fact::Reply { reply, .. } if reply == "Flush(Drained)")
    ));
}
/// covers: S7:104, S7:105
#[test]
fn form_presence_refreshes_while_idle_and_remains_saved() {
    let outcome = verify(
        SimConfig::calm(59),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Select(Some(2)),
            },
            Step::Run(Millis(10_000)),
            Step::Settle,
        ],
    );
    assert!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(
                event.fact,
                Fact::Frame {
                    direction: Direction::ToServer,
                    kind: FrameKind::Awareness,
                    ..
                }
            ))
            .count()
            >= 3
    );
    assert!(
        outcome
            .finals
            .clients
            .values()
            .all(|client| client.status.save == doc_sync_core::SaveState::Saved)
    );
}

/// covers: S7:72
#[test]
fn reconnect_while_authorizing_keeps_one_token_fetch() {
    let outcome = verify(
        SimConfig::calm(127),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Host {
                client: ClientName("a".into()),
                signal: doc_sync_core::HostSignal::Visible,
            },
            Step::Host {
                client: ClientName("a".into()),
                signal: doc_sync_core::HostSignal::Visible,
            },
            Step::Settle,
        ],
    );
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(event.fact, Fact::TokenRequested { .. }))
            .count(),
        1
    );
}

/// covers: S7:69, S7:70
#[test]
fn heartbeat_death_and_late_pong() {
    let outcome = verify(
        SimConfig::calm(131),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::DropNext {
                client: ClientName("a".into()),
                direction: Direction::ToClient,
                kind: Some(FrameKind::Pong),
                frames: 2,
            }),
            Step::Run(Millis(32_000)),
            Step::Net(NetStep::DropNext {
                client: ClientName("a".into()),
                direction: Direction::ToClient,
                kind: Some(FrameKind::Pong),
                frames: 3,
            }),
            Step::Run(Millis(36_000)),
            Step::Settle,
        ],
    );
    let closes = outcome.events.iter().filter(|event| matches!(&event.fact, Fact::SocketClose { reason, .. } if reason == "NoHeartbeat")).collect::<Vec<_>>();
    assert_eq!(closes.len(), 1);
    assert!(closes[0].at.0 > 32_500);
    assert!(outcome.stats.reconnects > 0);
}

#[test]
fn settlement_reconnects_only_the_socket_that_lost_a_partitioned_update() {
    let outcome = verify(
        SimConfig::calm(277),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("b".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(200)),
            Step::Net(NetStep::Heal(ClientName("b".into()))),
            Step::Settle,
        ],
    );
    assert_eq!(outcome.events.iter().filter(|event| matches!(&event.fact, Fact::TokenRequested { client, .. } if client.0 == "a")).count(), 1);
    assert_eq!(outcome.events.iter().filter(|event| matches!(&event.fact, Fact::TokenRequested { client, .. } if client.0 == "b")).count(), 2);
    assert_eq!(
        outcome.finals.clients[&ClientName("b".into())].deep_value["fields"]["1"],
        11
    );
}

#[test]
fn a_lost_ack_does_not_make_settlement_reconnect_the_socket() {
    let outcome = verify(
        SimConfig::calm(281),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::LoseAcks {
                client: ClientName("a".into()),
                count: 1,
            }),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(200)),
            Step::Settle,
        ],
    );
    assert!(outcome.stats.acks_lost > 0);
    assert_eq!(outcome.stats.reconnects, 0);
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(event.fact, Fact::TokenRequested { .. }))
            .count(),
        1
    );
}

#[test]
fn a_partition_without_lost_traffic_does_not_trigger_settlement_reconnect() {
    let outcome = verify(
        SimConfig::calm(283),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Net(NetStep::Heal(ClientName("a".into()))),
            Step::Settle,
        ],
    );
    assert_eq!(outcome.stats.reconnects, 0);
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(event.fact, Fact::TokenRequested { .. }))
            .count(),
        1
    );
}

#[test]
fn old_partition_loss_cannot_close_an_already_recovered_generation() {
    let outcome = verify(
        SimConfig::calm(293),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("b".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(200)),
            Step::Net(NetStep::Heal(ClientName("b".into()))),
            Step::Net(NetStep::Break(ClientName("b".into()))),
            Step::Run(Millis(1_000)),
            Step::Settle,
        ],
    );
    assert_eq!(outcome.events.iter().filter(|event| matches!(&event.fact, Fact::TokenRequested { client, .. } if client.0 == "b")).count(), 2);
}

#[test]
fn routed_partition_loss_reconnects_only_the_affected_physical_generation() {
    let outcome = verify(
        SimConfig::routed(307),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Open(OpenSpec {
                doc: DocIx(1),
                ..OpenSpec::form("c", "two")
            }),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("b".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(200)),
            Step::Net(NetStep::Heal(ClientName("b".into()))),
            Step::Settle,
        ],
    );
    assert_eq!(outcome.events.iter().filter(|event| matches!(&event.fact, Fact::RouterSocket { profile, open: true, .. } if profile.0 == "one")).count(), 1);
    assert_eq!(outcome.events.iter().filter(|event| matches!(&event.fact, Fact::RouterSocket { profile, open: true, .. } if profile.0 == "two")).count(), 2);
    assert_eq!(
        outcome.finals.clients[&ClientName("b".into())].deep_value["fields"]["1"],
        11
    );
}

#[test]
fn offline_loss_includes_traffic_already_in_flight_at_fault_start() {
    let outcome = verify(
        SimConfig::calm(311),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Profile(NetProfile {
                latency: (Millis(1_000), Millis(1_000)),
                ..NetProfile::calm()
            })),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(1_300)),
            Step::Offline {
                client: ClientName("b".into()),
                offline: true,
            },
            Step::Run(Millis(1_200)),
            Step::Offline {
                client: ClientName("b".into()),
                offline: false,
            },
            Step::Settle,
        ],
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::Frame { client, direction: Direction::ToClient, kind: FrameKind::RemoteUpdate, fate, .. } if client.0 == "b" && fate == "Lost")));
    assert_eq!(outcome.events.iter().filter(|event| matches!(&event.fact, Fact::TokenRequested { client, .. } if client.0 == "b")).count(), 2);
    assert_eq!(outcome.events.iter().filter(|event| matches!(&event.fact, Fact::TokenRequested { client, .. } if client.0 == "a")).count(), 1);
}
