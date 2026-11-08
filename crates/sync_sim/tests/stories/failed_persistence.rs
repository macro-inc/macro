use sync_sim::*;

#[test]
fn failed_pending_write_cannot_seed_a_durably_acked_dependency() {
    let outcome = Sim::new(SimConfig::calm(211)).run(&[
        Step::Open(OpenSpec {
            kind: ClientKind::AiWorker,
            ..OpenSpec::form("ai", "memory")
        }),
        Step::Run(Millis(500)),
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::Edit {
            client: ClientName("ai".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 11,
            },
        },
        Step::Run(Millis(200)),
        Step::Open(OpenSpec::form("tab", "browser")),
        Step::Run(Millis(500)),
        Step::Edit {
            client: ClientName("tab".into()),
            op: AbstractOp::FormSet {
                field: 2,
                value: 22,
            },
        },
        Step::Run(Millis(200)),
        Step::Crash {
            client: ClientName("ai".into()),
        },
        Step::Server(ServerStep::Hibernate),
        Step::Settle,
    ]);
    assert!(outcome.stats.storage_outages > 0);
    invariants::no_acked_edit_lost(&outcome).unwrap();
    invariants::check_all(&outcome).unwrap();
    outcome.check_replay().unwrap();
}
