use super::*;

/// covers: S7:39
#[test]
fn corrupt_local_snapshot_is_deleted_and_remote_seed_recovers() {
    let mut config = SimConfig::calm(37);
    config.seeds.insert(
        DocIx(0),
        SeedDocument::Cached {
            server: vec![],
            s3: None,
            local: Some(vec![]),
        },
    );
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(6_000)),
            Step::Crash {
                client: ClientName("a".into()),
            },
            Step::Storage {
                profile: ProfileName("one".into()),
                fault: StorageFault::CorruptSnapshot,
            },
            Step::Reopen {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::Telemetry { name, .. } if name == "doc.seed" || name == "span.end:seeded")));
    assert!(
        outcome
            .events
            .iter()
            .any(|event| matches!(event.fact, Fact::SnapshotDeleted { .. }))
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
}
/// covers: S7:82
#[test]
fn view_token_regrant_reconnects_without_quarantine() {
    let outcome = verify(
        SimConfig::calm(41),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Grant {
                client: ClientName("a".into()),
                access: Access::Read,
                force_reconnect: true,
            },
            Step::Run(Millis(2_000)),
            Step::Grant {
                client: ClientName("a".into()),
                access: Access::Edit,
                force_reconnect: false,
            },
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
    assert!(outcome.events.iter().any(
        |event| matches!(&event.fact, Fact::SocketClose { reason, .. } if reason == "Superseded")
    ));
    assert!(!outcome.events.iter().any(|event| matches!(&event.fact, Fact::RowsParked { rows, .. } if rows.iter().any(|(_, reason)| reason == "Poison"))));
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
}
/// covers: S7:82
#[test]
fn revoked_rows_remain_parked_and_durable_without_regrant() {
    let outcome = verify(
        SimConfig::calm(43),
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
            Step::Run(Millis(100)),
            Step::Grant {
                client: ClientName("a".into()),
                access: Access::Read,
                force_reconnect: false,
            },
            Step::Settle,
        ],
    );
    assert!(outcome.stats.parked_rows_at_end > 0);
    let mut missing_history = outcome.clone();
    missing_history
        .finals
        .clients
        .get_mut(&ClientName("a".into()))
        .unwrap()
        .oplog_vv
        .clear();
    assert!(invariants::all_docs_equal(&missing_history).is_err());
    let mut wrong_content = outcome.clone();
    let client = wrong_content
        .finals
        .clients
        .get_mut(&ClientName("a".into()))
        .unwrap();
    client.oplog_vv = wrong_content.finals.servers[&DocIx(0)].oplog_vv.clone();
    assert!(invariants::all_docs_equal(&wrong_content).is_err());
    assert!(
        outcome.finals.profiles[&ProfileName("one".into())]
            .entries
            .values()
            .any(|row| !row.delivered)
    );
}

/// covers: S7:40, S7:122
#[test]
fn poison_row_is_retained_quarantined_and_later_rows_deliver() {
    let outcome = verify(
        SimConfig::calm(137),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 41,
                },
            },
            Step::Run(Millis(100)),
            Step::Crash {
                client: ClientName("a".into()),
            },
            Step::Storage {
                profile: ProfileName("one".into()),
                fault: StorageFault::CorruptRow,
            },
            Step::Net(NetStep::Heal(ClientName("a".into()))),
            Step::Reopen {
                client: ClientName("a".into()),
            },
            Step::Run(Millis(220_000)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 42,
                },
            },
            Step::Settle,
        ],
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::RowsParked { rows, .. } if rows.iter().any(|(_, reason)| reason == "Poison"))));
    assert!(
        outcome.finals.profiles[&ProfileName("one".into())]
            .entries
            .values()
            .any(|row| row.record.quarantined && !row.delivered)
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        42
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::PeerAssigned { purpose, .. } if purpose == "probe")));
    assert!(outcome.events.iter().any(|event| matches!(
        event.fact,
        Fact::Frame {
            kind: FrameKind::RequestSnapshot,
            direction: Direction::ToServer,
            ..
        }
    )));
    assert_eq!(outcome.stats.resets, 1);
    let mut no_fault = outcome.clone();
    no_fault
        .events
        .retain(|event| !matches!(event.fact, Fact::WalCorrupted { .. }));
    assert!(invariants::no_persisted_edit_lost(&no_fault).is_err());
    let mut not_quarantined = outcome.clone();
    for row in not_quarantined
        .finals
        .profiles
        .get_mut(&ProfileName("one".into()))
        .unwrap()
        .entries
        .values_mut()
    {
        row.record.quarantined = false;
    }
    assert!(invariants::no_persisted_edit_lost(&not_quarantined).is_err());
    let mut not_retained = outcome.clone();
    not_retained
        .finals
        .profiles
        .get_mut(&ProfileName("one".into()))
        .unwrap()
        .entries
        .retain(|_, row| !row.record.quarantined);
    assert!(invariants::no_persisted_edit_lost(&not_retained).is_err());
    let mut later_edit_lost = outcome.clone();
    later_edit_lost
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(invariants::no_persisted_edit_lost(&later_edit_lost).is_err());
    assert!(invariants::no_acked_edit_lost(&later_edit_lost).is_err());
}
