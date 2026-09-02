use super::*;
use crate::local::e2e::LocalE2eSuite;

#[test]
fn local_e2e_accepts_suite_and_trailing_test_arguments() {
    let cli = Cli::try_parse_from([
        "cargo-x",
        "local-e2e",
        "--suite",
        "web",
        "--",
        "tests/e2e/local-smoke.spec.ts",
        "--grep",
        "channels",
    ])
    .unwrap();

    let Cmd::LocalE2e(args) = cli.command else {
        panic!("expected local-e2e command");
    };
    assert_eq!(args.suite, LocalE2eSuite::Web);
    assert_eq!(
        args.test_args,
        ["tests/e2e/local-smoke.spec.ts", "--grep", "channels"]
    );
}

#[test]
fn stack_update_accepts_binaries_dir_with_build_aux_services() {
    let cli = Cli::try_parse_from([
        "cargo-x",
        "stack",
        "update",
        "--binaries-dir",
        "/tmp/bins",
        "--build-aux-services",
    ])
    .unwrap();
    let Cmd::Stack(StackCmd::Update(args)) = cli.command else {
        panic!("expected stack update");
    };
    assert_eq!(
        args.binaries_dir.as_deref(),
        Some(std::path::Path::new("/tmp/bins"))
    );
    assert!(args.build_aux_services);
}

#[test]
fn run_local_defaults_onboarding_off() {
    let cli = Cli::try_parse_from(["cargo-x", "run-local"]).unwrap();
    let Cmd::RunLocal(args) = cli.command else {
        panic!("expected run-local command");
    };
    assert!(!args.enable_onboarding);
}

#[test]
fn run_local_defaults_cf_tunnels_off() {
    let cli = Cli::try_parse_from(["cargo-x", "run-local"]).unwrap();
    let Cmd::RunLocal(args) = cli.command else {
        panic!("expected run-local command");
    };
    assert!(!args.with_cf_tunnel);
}

#[test]
fn run_local_accepts_with_cf_tunnel() {
    let cli = Cli::try_parse_from(["cargo-x", "run-local", "--with-cf-tunnel"]).unwrap();
    let Cmd::RunLocal(args) = cli.command else {
        panic!("expected run-local command");
    };
    assert!(args.with_cf_tunnel);
}

#[test]
fn run_local_accepts_enable_onboarding() {
    let cli = Cli::try_parse_from(["cargo-x", "run-local", "--enable-onboarding"]).unwrap();
    let Cmd::RunLocal(args) = cli.command else {
        panic!("expected run-local command");
    };
    assert!(args.enable_onboarding);
}

#[test]
fn stack_has_no_snapshot_verb() {
    match Cli::try_parse_from(["cargo-x", "stack", "snapshot"]) {
        Err(err) => assert_eq!(err.kind(), clap::error::ErrorKind::InvalidSubcommand),
        Ok(_) => panic!("stack snapshot must not parse"),
    }
}

#[test]
fn seed_scenario_accepts_instance_and_trailing_scenario_arguments() {
    let cli = Cli::try_parse_from([
        "cargo-x",
        "seed-scenario",
        "--instance",
        "2508",
        "apply",
        "--file",
        "seed/scenarios/team-perms.json",
    ])
    .unwrap();

    let Cmd::SeedScenario(args) = cli.command else {
        panic!("expected seed-scenario command");
    };
    assert_eq!(args.instance.instance.as_deref(), Some("2508"));
    assert_eq!(
        args.scenario_args,
        ["apply", "--file", "seed/scenarios/team-perms.json"]
    );
}
