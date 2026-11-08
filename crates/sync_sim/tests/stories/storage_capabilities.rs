use super::*;

/// covers: S7:82, S7:114; memory AI is not a durable browser recovery session.
#[test]
fn memory_ai_does_not_make_a_readonly_browser_a_wal_recovery_opportunity() {
    let outcome = verify(
        SimConfig::calm(191),
        &[
            Step::Open(OpenSpec::form("browser", "profile")),
            Step::Open(OpenSpec {
                kind: ClientKind::AiWorker,
                ..OpenSpec::form("ai", "profile")
            }),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("browser".into()))),
            Step::Edit {
                client: ClientName("browser".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(100)),
            Step::Grant {
                client: ClientName("browser".into()),
                access: Access::Read,
                force_reconnect: true,
            },
            Step::Settle,
        ],
    );
    assert!(
        outcome.finals.profiles[&ProfileName("profile".into())]
            .entries
            .values()
            .any(|row| !row.delivered)
    );
    assert!(
        outcome.finals.clients[&ClientName("browser".into())]
            .parked
            .iter()
            .any(|(_, reason)| reason == "ReadOnly")
    );
    assert_eq!(
        outcome.finals.clients[&ClientName("ai".into())].access,
        Access::Edit
    );
    let mut fake_recovery = outcome.clone();
    for event in &mut fake_recovery.events {
        if let Fact::Opened { client, kind, .. } = &mut event.fact
            && client.0 == "ai"
        {
            *kind = ClientKind::Tab;
        }
    }
    fake_recovery
        .finals
        .clients
        .get_mut(&ClientName("ai".into()))
        .unwrap()
        .kind = ClientKind::Tab;
    assert!(invariants::no_persisted_edit_lost(&fake_recovery).is_err());
    assert!(invariants::all_wals_drained(&fake_recovery).is_ok());
    fake_recovery
        .finals
        .clients
        .get_mut(&ClientName("browser".into()))
        .unwrap()
        .parked
        .clear();
    assert!(invariants::all_wals_drained(&fake_recovery).is_err());
}

/// covers: S7:25, S7:82; a real writable Tab still drains that profile's rows.
#[test]
fn writable_browser_recovers_parked_rows_while_memory_ai_is_present() {
    let outcome = verify(
        SimConfig::calm(193),
        &[
            Step::Open(OpenSpec::form("browser", "profile")),
            Step::Open(OpenSpec {
                kind: ClientKind::AiWorker,
                ..OpenSpec::form("ai", "profile")
            }),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("browser".into()))),
            Step::Edit {
                client: ClientName("browser".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(100)),
            Step::Grant {
                client: ClientName("browser".into()),
                access: Access::Read,
                force_reconnect: true,
            },
            Step::Settle,
            Step::Open(OpenSpec::form("recovery", "profile")),
            Step::Settle,
        ],
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        11
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::PushSent { client, foreign_bytes, .. } if client.0 == "recovery" && *foreign_bytes > 0)));
    let mut lost = outcome.clone();
    lost.finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(invariants::no_persisted_edit_lost(&lost).is_err());
    assert!(invariants::no_acked_edit_lost(&lost).is_err());
}

/// covers: S7:3, S7:80; immutable host capabilities are distinct from desired grants.
#[test]
fn initial_read_and_comment_hosts_skip_document_edits_until_reopened_writable() {
    let outcome = verify(
        SimConfig::calm(197),
        &[
            Step::Open(OpenSpec {
                access: Access::Read,
                ..OpenSpec::form("read", "one")
            }),
            Step::Open(OpenSpec {
                access: Access::CommentOnly,
                ..OpenSpec::form("comment", "two")
            }),
            Step::Run(Millis(500)),
            Step::Grant {
                client: ClientName("read".into()),
                access: Access::Edit,
                force_reconnect: false,
            },
            Step::Grant {
                client: ClientName("comment".into()),
                access: Access::Edit,
                force_reconnect: false,
            },
            Step::Edit {
                client: ClientName("read".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Edit {
                client: ClientName("comment".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 22,
                },
            },
            Step::Close {
                client: ClientName("read".into()),
            },
            Step::Close {
                client: ClientName("comment".into()),
            },
            Step::Reopen {
                client: ClientName("read".into()),
            },
            Step::Reopen {
                client: ClientName("comment".into()),
            },
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("read".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 33,
                },
            },
            Step::Edit {
                client: ClientName("comment".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 44,
                },
            },
            Step::Settle,
        ],
    );
    assert_eq!(outcome.stats.skipped_ops, 2);
    assert!(!outcome.events.iter().any(|event| matches!(
        &event.fact,
        Fact::LocalOp {
            op: AbstractOp::FormSet { value: 11 | 22, .. },
            ..
        }
    )));
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        33
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        44
    );
}

#[test]
fn parked_rows_retain_exact_exemptions_after_another_user_reopens() {
    let outcome = verify(
        SimConfig::calm(223),
        &[
            Step::Open(OpenSpec::form("browser", "profile")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("browser".into()))),
            Step::Edit {
                client: ClientName("browser".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(100)),
            Step::Grant {
                client: ClientName("browser".into()),
                access: Access::Read,
                force_reconnect: true,
            },
            Step::Settle,
            Step::Close {
                client: ClientName("browser".into()),
            },
            Step::SignIn {
                profile: ProfileName("profile".into()),
                user: "other-user".into(),
            },
            Step::Reopen {
                client: ClientName("browser".into()),
            },
            Step::Settle,
        ],
    );
    assert!(
        outcome.finals.clients[&ClientName("browser".into())]
            .parked
            .is_empty()
    );
    let mut missing = outcome.clone();
    missing
        .finals
        .profiles
        .get_mut(&ProfileName("profile".into()))
        .unwrap()
        .entries
        .clear();
    assert!(invariants::no_edit_lost_without_crash(&missing).is_err());
    let mut damaged = outcome.clone();
    for row in damaged
        .finals
        .profiles
        .get_mut(&ProfileName("profile".into()))
        .unwrap()
        .entries
        .values_mut()
    {
        row.record.bytes.clear();
    }
    assert!(invariants::no_edit_lost_without_crash(&damaged).is_err());
    let mut unparked = outcome.clone();
    unparked
        .events
        .retain(|event| !matches!(&event.fact, Fact::RowsParked { .. }));
    assert!(invariants::no_edit_lost_without_crash(&unparked).is_err());
}

#[test]
fn comment_only_replicas_keep_private_parked_history_but_must_cover_the_server() {
    let outcome = verify(
        SimConfig::calm(227),
        &[
            Step::Open(OpenSpec::form("browser", "profile")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("browser".into()))),
            Step::Edit {
                client: ClientName("browser".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Run(Millis(100)),
            Step::Grant {
                client: ClientName("browser".into()),
                access: Access::CommentOnly,
                force_reconnect: true,
            },
            Step::Settle,
        ],
    );
    let mut missing = outcome.clone();
    missing
        .finals
        .clients
        .get_mut(&ClientName("browser".into()))
        .unwrap()
        .oplog_vv
        .clear();
    assert!(invariants::all_docs_equal(&missing).is_err());
    let mut fake_equal = outcome.clone();
    fake_equal
        .finals
        .clients
        .get_mut(&ClientName("browser".into()))
        .unwrap()
        .oplog_vv = outcome.finals.servers[&DocIx(0)].oplog_vv.clone();
    assert!(invariants::all_docs_equal(&fake_equal).is_err());
}
