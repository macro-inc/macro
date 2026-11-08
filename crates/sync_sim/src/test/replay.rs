use super::*;

#[test]
fn replay_identifies_the_first_actual_event_port_or_final_difference() {
    let outcome = verify(
        SimConfig::calm(199),
        &[Step::Open(OpenSpec::form("a", "browser")), Step::Settle],
    );
    outcome.check_replay().unwrap();
    let mut changed = outcome.clone();
    changed.events[0].fact = Fact::ServerSeed {
        doc: DocIx(0),
        vv: Vv::new(),
    };
    let failure = outcome.compare_replay(&changed).unwrap_err();
    assert!(failure.detail.contains("first differing event0"));
    assert!(failure.detail.contains("SIM_SEED=199"));
    let mut changed = outcome.clone();
    changed.server_ports[0].effect.operation = "changed".into();
    assert!(
        outcome
            .compare_replay(&changed)
            .unwrap_err()
            .detail
            .contains("first differing server port0")
    );
    let mut changed = outcome.clone();
    changed
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(
        outcome
            .compare_replay(&changed)
            .unwrap_err()
            .detail
            .contains("final state differs")
    );
    let mut changed = outcome.clone();
    changed.event_bytes.push(0);
    assert!(
        outcome
            .compare_replay(&changed)
            .unwrap_err()
            .detail
            .contains("canonical event bytes differ")
    );
}
#[test]
fn execution_failures_retain_the_active_script_step() {
    let mut config = SimConfig::calm(211);
    config.budgets.quiet = Millis(0);
    let outcome = Sim::new(config).run(&[
        Step::Open(OpenSpec::form("a", "browser")),
        Step::Open(OpenSpec::form("a", "browser")),
    ]);
    assert_eq!(outcome.per_step_failures[0].invariant, "open");
    assert_eq!(outcome.per_step_failures[0].step, Some(1));
    outcome.check_replay().unwrap();
}
#[test]
fn session_policy_overrides_drive_real_coalescing_and_router_timers() {
    let mut config = SimConfig::routed(223);
    config.session.wal.coalesce = doc_sync_core::Millis(500);
    config.session.wal.retry_unacked_after = doc_sync_core::Millis(1000);
    config.session.timeouts.ack = doc_sync_core::Millis(750);
    config.session.heartbeat.interval = doc_sync_core::Millis(1000);
    config.session.heartbeat.timeout = doc_sync_core::Millis(300);
    config.session.backoff.base = doc_sync_core::Millis(50);
    config.session.converge.retry_delay = doc_sync_core::Millis(300);
    config.session.snapshot_interval = Some(doc_sync_core::Millis(2000));
    config.session.presence_timeout = doc_sync_core::WallDuration(20_000);
    config.session.presence_refresh = Some(doc_sync_core::Millis(1000));
    config.session.reset_budget.max = 2;
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "browser")),
            Step::Open(OpenSpec {
                doc: DocIx(1),
                ..OpenSpec::form("b", "browser")
            }),
            Step::Run(Millis(800)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Select(Some(1)),
            },
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(600)),
            Step::Settle,
        ],
    );
    let committed = outcome
        .events
        .iter()
        .find(|event| {
            matches!(
                event.fact,
                Fact::LocalOp {
                    op: AbstractOp::FormSet { .. },
                    ..
                }
            )
        })
        .unwrap();
    let appended = outcome
        .events
        .iter()
        .find(|event| matches!(event.fact, Fact::WalAppendIssued { .. }))
        .unwrap();
    assert!(appended.at.0 >= committed.at.0 + 500);
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(event.fact, Fact::RouterSocket { open: true, .. }))
            .count(),
        1
    );
}
#[test]
fn no_live_transport_can_settle_without_opening_a_connection() {
    let mut config = SimConfig::calm(227);
    config.session.transport = TransportKind::None;
    let outcome = verify(
        config,
        &[Step::Open(OpenSpec::form("a", "browser")), Step::Settle],
    );
    assert_eq!(outcome.stats.frames, 0);
    assert!(
        outcome
            .server_ports
            .iter()
            .all(|port| port.effect.operation != "connections.accept")
    );
}
