use super::*;
use crate::local::e2e::LocalE2eSuite;
use crate::local::supervisor::RunAction;

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
fn run_local_defaults_cf_tunnels_off() {
    let cli = Cli::try_parse_from(["cargo-x", "run-local"]).unwrap();
    let Cmd::RunLocal(args) = cli.command else {
        panic!("expected run-local command");
    };
    assert!(!args.run.with_cf_tunnel);
}

#[test]
fn run_local_accepts_with_cf_tunnel() {
    let cli = Cli::try_parse_from(["cargo-x", "run-local", "--with-cf-tunnel"]).unwrap();
    let Cmd::RunLocal(args) = cli.command else {
        panic!("expected run-local command");
    };
    assert!(args.run.with_cf_tunnel);
}

#[test]
fn stack_has_no_snapshot_verb() {
    match Cli::try_parse_from(["cargo-x", "stack", "snapshot"]) {
        Err(err) => assert_eq!(err.kind(), clap::error::ErrorKind::InvalidSubcommand),
        Ok(_) => panic!("stack snapshot must not parse"),
    }
}

#[test]
fn run_local_and_stack_up_accept_no_snapshot() {
    let cli = Cli::try_parse_from(["cargo-x", "run-local", "--no-snapshot"]).unwrap();
    let Cmd::RunLocal(args) = cli.command else {
        panic!("expected run-local command");
    };
    assert!(args.run.no_snapshot);

    let cli = Cli::try_parse_from(["cargo-x", "stack", "up", "--no-snapshot"]).unwrap();
    let Cmd::Stack(StackCmd::Up(args)) = cli.command else {
        panic!("expected stack up");
    };
    assert!(args.run.no_snapshot);
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

#[test]
fn run_local_and_stack_up_parse_the_computers_flags() {
    use crate::local::computers::Fleet;

    let fleet = |argv: &[&str], default: Fleet| {
        let cli = Cli::try_parse_from(argv).unwrap();
        match cli.command {
            Cmd::RunLocal(args) => args.run.computers.fleet(default),
            Cmd::Stack(StackCmd::Up(args)) => args.run.computers.fleet(default),
            Cmd::ValidateLocalCompose(args) => args.computers.fleet(default),
            _ => panic!("unexpected command"),
        }
    };
    assert_eq!(
        fleet(&["cargo-x", "run-local"], Fleet::Docker),
        Fleet::Docker
    );
    assert_eq!(
        fleet(&["cargo-x", "run-local", "--no-computers"], Fleet::Docker),
        Fleet::Off
    );
    assert_eq!(
        fleet(
            &["cargo-x", "run-local", "--computers-incus"],
            Fleet::Docker
        ),
        Fleet::Incus
    );
    assert_eq!(
        fleet(
            &["cargo-x", "stack", "up", "--computers", "docker"],
            Fleet::Off
        ),
        Fleet::Docker
    );
    assert_eq!(
        fleet(
            &["cargo-x", "validate-local-compose", "--computers-incus"],
            Fleet::Docker
        ),
        Fleet::Incus
    );
    assert!(
        Cli::try_parse_from([
            "cargo-x",
            "run-local",
            "--no-computers",
            "--computers-incus"
        ])
        .is_err()
    );
}

#[test]
fn run_local_takes_start_flags_or_a_subcommand_but_not_both() {
    let cli = Cli::try_parse_from([
        "cargo-x",
        "run-local",
        "--instance",
        "a",
        "--fresh",
        "--json",
    ])
    .unwrap();
    let Cmd::RunLocal(args) = cli.command else {
        panic!("expected run-local");
    };
    assert_eq!(args.run.instance.instance.as_deref(), Some("a"));
    assert!(args.flags.fresh && args.flags.json && args.action.is_none());

    let cli = Cli::try_parse_from([
        "cargo-x",
        "run-local",
        "rebuild",
        "--instance",
        "a",
        "--port-base",
        "23000",
        "--no-wait",
    ])
    .unwrap();
    let Cmd::RunLocal(args) = cli.command else {
        panic!("expected run-local");
    };
    let Some(RunAction::Rebuild(rebuild)) = args.action else {
        panic!("expected rebuild");
    };
    assert_eq!(rebuild.instance.port_base, Some(23000));
    assert!(rebuild.no_wait);

    assert!(Cli::try_parse_from(["cargo-x", "run-local", "--fresh", "status"]).is_err());
}

/// The background process re-runs the caller's own arguments plus `--supervise`,
/// whichever of these the caller used.
#[test]
fn every_detachable_command_accepts_the_internal_supervise_flag() {
    for argv in [
        vec!["cargo-x", "run-local", "--supervise"],
        vec!["cargo-x", "run-dev", "--no-frontend", "--supervise"],
        vec!["cargo-x", "run-local", "rebuild", "--supervise"],
    ] {
        assert!(Cli::try_parse_from(&argv).is_ok(), "{argv:?}");
    }
}

#[test]
fn static_frontend_conflicts_with_no_frontend() {
    assert!(
        Cli::try_parse_from(["cargo-x", "run-local", "--static-frontend", "--no-frontend"])
            .is_err()
    );
}
