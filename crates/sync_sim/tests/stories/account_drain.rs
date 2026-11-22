use super::*;

#[test]
fn account_switch_follows_actual_old_user_wal_drainage() {
    verify(
        SimConfig::calm(349),
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
            Step::ReopenCrashed,
            Step::Settle,
            Step::AssertProfileDrained {
                profile: ProfileName("browser".into()),
            },
            Step::CrashProfile {
                profile: ProfileName("browser".into()),
                mode: CrashMode::ProcessDeath,
            },
            Step::SignIn {
                profile: ProfileName("browser".into()),
                user: "other-user".into(),
            },
            Step::ReopenCrashed,
            Step::Settle,
        ],
    );
}

#[test]
fn account_drain_assertion_rejects_an_actually_parked_readonly_row() {
    let outcome = Sim::new(SimConfig::calm(353)).run(&[
        Step::Open(OpenSpec::form("a", "browser")),
        Step::Run(Millis(500)),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 11,
            },
        },
        Step::Grant {
            client: ClientName("a".into()),
            access: Access::Read,
            force_reconnect: false,
        },
        Step::Close {
            client: ClientName("a".into()),
        },
        Step::Settle,
        Step::AssertProfileDrained {
            profile: ProfileName("browser".into()),
        },
    ]);
    assert!(
        outcome
            .per_step_failures
            .iter()
            .any(|failure| failure.invariant == "account_switch_drained")
    );
    assert!(
        outcome.finals.profiles[&ProfileName("browser".into())]
            .entries
            .values()
            .any(|row| !row.delivered)
    );
    assert!(
        outcome.finals.clients[&ClientName("a".into())]
            .parked
            .iter()
            .any(|(_, reason)| reason == "ReadOnly")
    );
    outcome.check_replay().unwrap();
}
