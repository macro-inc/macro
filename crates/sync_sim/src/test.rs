use crate::*;

#[test]
fn two_form_clients_run_the_real_cores_and_are_deterministic() {
    let script = [
        Step::Open(OpenSpec::form("a", "browser-a")),
        Step::Open(OpenSpec::form("b", "browser-b")),
        Step::Run(Millis(500)),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 2,
                value: 17,
            },
        },
        Step::Edit {
            client: ClientName("b".into()),
            op: AbstractOp::FormSet {
                field: 3,
                value: 29,
            },
        },
        Step::Settle,
    ];
    let first = Sim::new(SimConfig::calm(7)).run(&script);
    let second = Sim::new(SimConfig::calm(7)).run(&script);
    assert!(
        first.per_step_failures.is_empty(),
        "{:?}",
        first.per_step_failures
    );
    invariants::check_all(&first).unwrap();
    first.compare_replay(&second).unwrap();
}

mod mutations;
mod replay;
mod routed;
mod stories;

fn verify(config: SimConfig, script: &[Step]) -> Outcome {
    let first = Sim::new(config.clone()).run(script);
    let second = Sim::new(config).run(script);
    assert!(
        first.per_step_failures.is_empty(),
        "{:?}",
        first.per_step_failures
    );
    if let Err(errors) = invariants::check_all(&first) {
        panic!("{errors:?}");
    }
    first.compare_replay(&second).unwrap();
    first
}
