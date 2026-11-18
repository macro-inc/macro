use super::*;

/// covers: S7:2, S7:122
#[test]
fn chatter_dependency_survives_writer_crash() {
    let outcome = verify(
        SimConfig::calm(101),
        &[
            Step::Open(OpenSpec::form("a", "shared")),
            Step::Open(OpenSpec::form("b", "shared")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 41,
                },
            },
            Step::Run(Millis(30)),
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 42,
                },
            },
            Step::Crash {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
    assert!(outcome.stats.foreign_rows > 0);
    assert!(outcome.stats.foreign_bytes_pushed > 0 || outcome.stats.assisted_pushes > 0);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        41
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        42
    );
}

/// covers: S7:3
#[test]
fn read_only_tab_parks_nothing_foreign() {
    let outcome = verify(
        SimConfig::calm(103),
        &[
            Step::Open(OpenSpec::form("a", "shared")),
            Step::Open(OpenSpec {
                access: Access::Read,
                ..OpenSpec::form("b", "shared")
            }),
            Step::Run(Millis(500)),
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
    assert!(!outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::WalAppendIssued { client, foreign: true, .. } if client.0 == "b")));
    assert_eq!(outcome.stats.parked_rows_at_end, 0);
}

/// covers: S7:2, S7:122
#[test]
fn two_tabs_do_not_echo_delivered_foreign_updates() {
    let mut script = vec![
        Step::Open(OpenSpec::form("a", "shared")),
        Step::Open(OpenSpec::form("b", "shared")),
        Step::Run(Millis(500)),
    ];
    // Two literal100-edit arrays keep the200-edit story readable and bounded.
    script.extend(include!("chatter/first.rs.inc"));
    script.extend(include!("chatter/second.rs.inc"));
    script.push(Step::Settle);
    let outcome = verify(SimConfig::calm(107), &script);
    assert!(outcome.stats.foreign_rows > 0);
    assert!(outcome.stats.own_bytes_pushed > 0);
    assert!(outcome.stats.foreign_bytes_pushed * 5 <= outcome.stats.own_bytes_pushed);
}

/// covers: S7:121
#[test]
fn frozen_tab_rows_are_assisted_before_thaw_and_own_replay_is_idempotent() {
    let outcome = verify(
        SimConfig::calm(173),
        &[
            Step::Open(OpenSpec::form("a", "shared")),
            Step::Open(OpenSpec::form("b", "shared")),
            Step::Run(Millis(500)),
            Step::Storage {
                profile: ProfileName("shared".into()),
                fault: StorageFault::Latency(Millis(100), Millis(100)),
            },
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(26)),
            Step::Freeze {
                client: ClientName("a".into()),
            },
            Step::Run(Millis(200)),
            Step::Net(NetStep::Heal(ClientName("a".into()))),
            Step::Host {
                client: ClientName("b".into()),
                signal: doc_sync_core::HostSignal::Visible,
            },
            Step::Run(Millis(1_000)),
            Step::Thaw {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
    let thaw = outcome
        .events
        .iter()
        .position(|event| matches!(&event.fact, Fact::Thawed { client } if client.0 == "a"))
        .unwrap();
    let owner = outcome
        .events
        .iter()
        .find_map(|event| match &event.fact {
            Fact::Opened {
                client, session, ..
            } if client.0 == "a" => Some(*session),
            _ => None,
        })
        .unwrap();
    assert!(outcome.events[..thaw].iter().any(|event| matches!(&event.fact,
        Fact::PushSent { client, rows, .. } if client.0 == "b" && rows.iter().any(|(id, _)| *id == doc_sync_core::WalOwner::Session(owner)))));
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
}
