use super::*;

/// covers: S7:122
#[test]
fn d1_outage_never_quarantines_and_heal_cancels_its_old_timer() {
    let outcome = verify(
        SimConfig::calm(109),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Server(ServerStep::D1Outage {
                ms: Millis(300_000),
            }),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(25_000)),
            Step::Settle,
        ],
    );
    assert!(outcome.stats.d1_outages > 0);
    assert!(!outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::RowsParked { rows, .. } if rows.iter().any(|(_, reason)| reason == "Poison"))));
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
}

/// covers: S7:13, S7:16
#[test]
fn reconnect_storm_has_no_terminal_corruption() {
    let outcome = verify(
        SimConfig::calm(113),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Open(OpenSpec::form("c", "three")),
            Step::Open(OpenSpec::form("d", "four")),
            Step::Run(Millis(500)),
            Step::Offline {
                client: ClientName("a".into()),
                offline: true,
            },
            Step::Offline {
                client: ClientName("b".into()),
                offline: true,
            },
            Step::Offline {
                client: ClientName("c".into()),
                offline: true,
            },
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 11,
                },
            },
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 22,
                },
            },
            Step::Edit {
                client: ClientName("c".into()),
                op: AbstractOp::FormSet {
                    field: 3,
                    value: 33,
                },
            },
            Step::Run(Millis(40_000)),
            Step::Offline {
                client: ClientName("a".into()),
                offline: false,
            },
            Step::Offline {
                client: ClientName("b".into()),
                offline: false,
            },
            Step::Offline {
                client: ClientName("c".into()),
                offline: false,
            },
            Step::Settle,
        ],
    );
    assert_eq!(outcome.stats.resets, 0);
    assert!(outcome.stats.rebases <= 4);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["3"],
        33
    );
}

/// Failed upgrades must close the accepted server half, even if metadata failed.
#[test]
fn failed_upgrade_does_not_leave_an_unrestorable_runtime_socket() {
    let outcome = verify(
        SimConfig::calm(167),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Server(ServerStep::StorageErrors { n: 1 }),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(2_000)),
            Step::Settle,
        ],
    );
    assert!(outcome.stats.storage_outages > 0);
    assert_eq!(outcome.finals.servers.len(), 1);
    assert!(
        outcome
            .server_ports
            .iter()
            .any(|port| port.effect.operation == "connections.accept")
    );
}

/// covers: S7:13, S7:122; failed downstream metadata writes in routed transport.
#[test]
fn failed_routed_upgrade_closes_the_accepted_server_half() {
    let outcome = verify(
        SimConfig::routed(173),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Server(ServerStep::StorageErrors { n: 1 }),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(2_000)),
            Step::Server(ServerStep::Hibernate),
            Step::Settle,
        ],
    );
    assert!(outcome.stats.storage_outages > 0);
    assert!(
        outcome.events.iter().any(
            |event| matches!(&event.fact, Fact::ClientSettled { client, .. } if client.0 == "b")
        )
    );
}
