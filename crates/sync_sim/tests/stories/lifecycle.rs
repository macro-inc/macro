use super::*;

/// covers: S7:78, S7:74
#[test]
fn token_fallback_and_expiry_fetch_again() {
    let outcome = verify(
        SimConfig::calm(139),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::TokenFetchFail {
                client: ClientName("a".into()),
                n: 1,
            },
            Step::Net(NetStep::Break(ClientName("a".into()))),
            Step::Run(Millis(2_000)),
            Step::TokenExpire {
                client: ClientName("a".into()),
            },
            Step::Net(NetStep::Break(ClientName("a".into()))),
            Step::Run(Millis(3_000)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Settle,
        ],
    );
    assert!(outcome.stats.reconnects >= 2);
    assert!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(event.fact, Fact::TokenRequested { .. }))
            .count()
            >= 3
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
}

/// covers: S7:99
#[test]
fn host_editor_error_stops_and_clears_presence() {
    let outcome = verify(
        SimConfig::calm(149),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Select(Some(2)),
            },
            Step::Run(Millis(100)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::EditorError {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
    assert!(
        outcome
            .events
            .iter()
            .any(|event| matches!(&event.fact, Fact::Closed { client } if client.0 == "a"))
    );
    assert_eq!(outcome.stats.close_in_window, 1);
    assert!(
        outcome.finals.clients[&ClientName("a".into())]
            .selection
            .is_none()
    );
}

/// covers: S7:108, S7:113, S7:114
#[test]
fn ai_worker_is_hidden_and_flush_is_loud_while_partitioned() {
    let outcome = verify(
        SimConfig::calm(151),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec {
                kind: ClientKind::AiWorker,
                ..OpenSpec::form("ai", "worker")
            }),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("ai".into()))),
            Step::Edit {
                client: ClientName("ai".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Flush {
                client: ClientName("ai".into()),
            },
            Step::Run(Millis(16_000)),
            Step::Net(NetStep::Heal(ClientName("ai".into()))),
            Step::Run(Millis(20_000)),
            Step::Close {
                client: ClientName("ai".into()),
            },
            Step::Settle,
        ],
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::Reply { client, reply, .. } if client.0 == "ai" && reply.contains("NotDrained"))));
    assert!(
        outcome
            .events
            .iter()
            .any(|event| matches!(&event.fact, Fact::Closed { client } if client.0 == "ai"))
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
}

/// covers: S7 R-6
#[test]
fn power_loss_window_reports_exact_lost_writes() {
    let outcome = verify(
        SimConfig::calm(157),
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
            Step::Run(Millis(50)),
            Step::CrashProfile {
                profile: ProfileName("one".into()),
                mode: CrashMode::PowerLoss {
                    window: Millis(200),
                },
            },
            Step::ReopenCrashed,
            Step::Settle,
        ],
    );
    assert!(
        outcome
            .events
            .iter()
            .any(|event| matches!(event.fact, Fact::WalWriteLost { .. }))
    );
}

/// covers: S7:90
#[test]
fn clock_skew_presence_keeps_the_document_safe() {
    let mut config = SimConfig::calm(163);
    config.session.presence_timeout = doc_sync_core::WallDuration(5_000);
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::ClockSkew {
                client: ClientName("b".into()),
                wall_offset_ms: -6_000,
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::Select(Some(2)),
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(6_000)),
            Step::Settle,
        ],
    );
    let peer = &outcome.finals.clients[&ClientName("b".into())].presence_key;
    assert!(!outcome.finals.presence.as_ref().unwrap()[&ClientName("a".into())].contains_key(peer));
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
}

#[test]
fn frozen_receiver_expires_a_dead_peer_at_its_actual_thaw() {
    let outcome = verify(
        SimConfig::calm(179),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Select(Some(1)),
            },
            Step::Run(Millis(100)),
            Step::Freeze {
                client: ClientName("b".into()),
            },
            Step::Crash {
                client: ClientName("a".into()),
            },
            Step::Run(Millis(20_000)),
            Step::Thaw {
                client: ClientName("b".into()),
            },
            Step::Settle,
        ],
    );
    let key = outcome.finals.clients[&ClientName("a".into())]
        .presence_key
        .clone();
    let mut stale = outcome.clone();
    let thaw = stale
        .events
        .iter()
        .position(|event| matches!(&event.fact, Fact::Thawed { client } if client.0 == "b"))
        .unwrap();
    for event in &mut stale.events[thaw..] {
        if let Fact::PresenceChanged { client, remote } = &mut event.fact
            && client.0 == "b"
        {
            remote.insert(key.clone(), serde_json::json!({"selection": 1}));
        }
    }
    assert!(invariants::presence_expires(&stale).is_err());
}
