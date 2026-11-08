//! CLI host for seed replay; the simulation library never reads the environment.
use sync_sim::*;

#[test]
fn replay() {
    let seed = match macro_env_var::read_env_var("SIM_SEED") {
        Ok(value) => value.parse().expect("SIM_SEED must be a u64"),
        Err(std::env::VarError::NotPresent) => 197,
        Err(error) => panic!("invalid SIM_SEED: {error}"),
    };
    let outcome = Sim::new(SimConfig::calm(seed)).run(&[
        Step::Open(OpenSpec::form("a", "browser")),
        Step::Open(OpenSpec::form("b", "other")),
        Step::Run(Millis(800)),
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 42,
            },
        },
        Step::Run(Millis(40)),
        Step::Crash {
            client: ClientName("a".into()),
        },
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    println!("{}", outcome.reproduction());
    println!("events={:#?}", outcome.events);
    println!("server_ports={:#?}", outcome.server_ports);
    println!("trace_hash={:016x}", outcome.trace_hash);
    invariants::check_all(&outcome).unwrap();
    outcome.check_replay().unwrap();
}
