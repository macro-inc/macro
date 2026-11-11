//! CLI host for seed replay; the simulation library never reads the environment.
use sync_sim::*;

#[test]
fn replay() {
    let seed = match macro_env_var::read_env_var("SIM_SEED") {
        Ok(value) => value.parse().expect("SIM_SEED must be a u64"),
        Err(std::env::VarError::NotPresent) => 197,
        Err(error) => panic!("invalid SIM_SEED: {error}"),
    };
    let (config, script) =
        generate::seeded_script(seed, generate::ScriptShape::forms()).materialize(seed);
    let outcome = Sim::new(config).run(&script);
    println!("{}", outcome.failure_report());
    println!("events={:#?}", outcome.events);
    println!("server_ports={:#?}", outcome.server_ports);
    println!("trace_hash={:016x}", outcome.trace_hash);
    invariants::check_all(&outcome).unwrap();
    outcome.check_replay().unwrap();
}
