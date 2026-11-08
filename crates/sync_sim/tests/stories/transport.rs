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
