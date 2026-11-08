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

/// covers: S7:R-6; power loss may roll back a stopped tab's exact recent durable row.
#[test]
fn power_loss_after_stop_exempts_only_the_row_actually_rolled_back() {
    let outcome = verify(
        SimConfig::calm(181),
        &[
            Step::Open(OpenSpec::form("a", "browser")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(200)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 22,
                },
            },
            Step::Close {
                client: ClientName("a".into()),
            },
            Step::CrashProfile {
                profile: ProfileName("browser".into()),
                mode: CrashMode::PowerLoss {
                    window: Millis(100),
                },
            },
            Step::Reopen {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
    assert!(
        outcome
            .events
            .iter()
            .any(|event| matches!(&event.fact, Fact::WalWriteLost { .. }))
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        11
    );
    assert_ne!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        22
    );
    let mut no_loss = outcome.clone();
    no_loss
        .events
        .retain(|event| !matches!(event.fact, Fact::WalWriteLost { .. }));
    assert!(invariants::no_edit_lost_without_crash(&no_loss).is_err());
    assert!(invariants::no_persisted_edit_lost(&no_loss).is_err());
    let mut unrelated = outcome.clone();
    for event in &mut unrelated.events {
        if let Fact::WalWriteLost { profile, .. } = &mut event.fact {
            *profile = ProfileName("other".into());
        }
    }
    assert!(invariants::no_edit_lost_without_crash(&unrelated).is_err());
    let mut lost_acknowledged = outcome.clone();
    lost_acknowledged
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(invariants::no_acked_edit_lost(&lost_acknowledged).is_err());
}

/// covers: S7:104; an already dead receiver cannot run another peer's expiry timer.
#[test]
fn receiver_crashed_before_source_has_no_stale_live_presence_obligation() {
    let outcome = verify(
        SimConfig::calm(199),
        &[
            Step::Open(OpenSpec::form("source", "one")),
            Step::Open(OpenSpec::form("receiver", "two")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("source".into()),
                op: AbstractOp::Select(Some(1)),
            },
            Step::Run(Millis(100)),
            Step::Crash {
                client: ClientName("receiver".into()),
            },
            Step::Crash {
                client: ClientName("source".into()),
            },
            Step::Run(Millis(6_000)),
            Step::ReopenCrashed,
            Step::Settle,
        ],
    );
    let mut live_receiver = outcome.clone();
    live_receiver
        .events
        .retain(|event| !matches!(&event.fact, Fact::Crashed { client } if client.0 == "receiver"));
    assert!(invariants::presence_expires(&live_receiver).is_err());
}

#[test]
fn first_presence_snapshot_waits_for_the_issued_publications_to_arrive() {
    let config = SimConfig::calm(241);
    verify(
        config,
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
                op: AbstractOp::Select(Some(1)),
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::Select(Some(2)),
            },
            Step::Run(Millis(26)),
            Step::Settle,
        ],
    );
}

#[test]
fn bounded_backward_clock_keeps_offsets_and_resends_after_lww_time_catches_up() {
    let outcome = verify(
        SimConfig::calm(251),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(5_000)),
            Step::ClockSkew {
                client: ClientName("b".into()),
                wall_offset_ms: -2_488,
            },
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Select(Some(1)),
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::Select(Some(2)),
            },
            Step::Settle,
        ],
    );
    assert_eq!(outcome.finals.clients[&ClientName("b".into())].skew, -2_488);
}

#[test]
fn overlapping_periodic_refreshes_do_not_extend_the_healing_barrier() {
    let mut config = SimConfig::calm(263);
    config.session.presence_refresh = Some(doc_sync_core::Millis(1));
    config.session.wal.coalesce = doc_sync_core::Millis(1);
    config.session.heartbeat.interval = doc_sync_core::Millis(100);
    config.budgets.quiet = Millis(100);
    config.budgets.settle = Millis(5_000);
    verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Select(Some(1)),
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::Select(Some(2)),
            },
            Step::Settle,
        ],
    );
}

#[test]
fn routed_healing_barriers_drain_deferred_callbacks_with_overlapping_refreshes() {
    let mut config = SimConfig::routed(269);
    config.session.presence_refresh = Some(doc_sync_core::Millis(1));
    config.session.wal.coalesce = doc_sync_core::Millis(1);
    config.session.heartbeat.interval = doc_sync_core::Millis(100);
    config.budgets.quiet = Millis(100);
    config.budgets.settle = Millis(5_000);
    verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Server(ServerStep::DelayStorage(Millis(200))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 0,
                    value: 11,
                },
            },
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Select(Some(1)),
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::Select(Some(2)),
            },
            Step::Run(Millis(20)),
            Step::Settle,
        ],
    );
}

#[test]
fn retired_selection_with_opposite_bounded_clocks_expires_before_snapshot() {
    let outcome = verify(
        SimConfig::calm(317),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::ClockSkew {
                client: ClientName("a".into()),
                wall_offset_ms: 2_400,
            },
            Step::ClockSkew {
                client: ClientName("b".into()),
                wall_offset_ms: -2_400,
            },
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Select(Some(1)),
            },
            Step::Run(Millis(100)),
            Step::Crash {
                client: ClientName("a".into()),
            },
            Step::ReopenCrashed,
            Step::Settle,
        ],
    );
    assert_eq!(outcome.finals.clients[&ClientName("b".into())].skew, -2_400);
    let retired = outcome
        .events
        .iter()
        .find_map(|event| match &event.fact {
            Fact::Opened { client, peer, .. } if client.0 == "a" => Some(peer.to_string()),
            _ => None,
        })
        .unwrap();
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::PresenceChanged { client, remote } if client.0 == "b" && remote.contains_key(&retired))));
    let mut stale = outcome.clone();
    stale
        .finals
        .presence
        .as_mut()
        .unwrap()
        .get_mut(&ClientName("b".into()))
        .unwrap()
        .insert(retired.clone(), serde_json::json!({ "selection": 1 }));
    assert!(invariants::presence_converged(&stale).is_err());
    let crash_at = outcome
        .events
        .iter()
        .find_map(|event| {
            matches!(&event.fact,
        Fact::Crashed { client } if client.0 == "a")
            .then_some(event.at.0)
        })
        .unwrap();
    let deadline = crash_at + 5_000 + 20 + 4_800 + 1;
    stale.events.push(Event {
        at: Millis(deadline),
        fact: Fact::PresenceChanged {
            client: ClientName("b".into()),
            remote: [(retired, serde_json::json!({ "selection": 1 }))].into(),
        },
    });
    stale.events.sort_by_key(|event| event.at.0);
    // A never-applied script intention must not expand the observed clock budget.
    stale.script.push(Step::ClockSkew {
        client: ClientName("b".into()),
        wall_offset_ms: i64::MIN,
    });
    assert!(invariants::presence_expires(&stale).is_err());
    assert!(invariants::presence_converged(&stale).is_err());
}

#[test]
fn peer_replacement_during_settlement_republishes_without_a_periodic_refresh() {
    let mut config = SimConfig::calm(331);
    config.session.presence_refresh = None;
    verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::Select(Some(2)),
            },
            Step::Run(Millis(100)),
            Step::Net(NetStep::Profile(NetProfile {
                latency: (Millis(1_000), Millis(1_000)),
                ..NetProfile::calm()
            })),
            Step::Net(NetStep::CorruptNext {
                client: ClientName("b".into()),
                direction: Direction::ToClient,
            }),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(1_050)),
            Step::Settle,
        ],
    );
}

#[test]
fn a_crashed_ai_fixed_key_expires_before_the_first_healed_snapshot() {
    verify(
        SimConfig::calm(337),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec {
                kind: ClientKind::AiWorker,
                ..OpenSpec::form("ai", "worker")
            }),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("ai".into()),
                op: AbstractOp::Select(Some(2)),
            },
            Step::Run(Millis(100)),
            Step::Crash {
                client: ClientName("ai".into()),
            },
            Step::Settle,
        ],
    );
}
