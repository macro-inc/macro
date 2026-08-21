use super::*;

fn spec() -> RunSpec {
    RunSpec {
        image: "macro-agent-harness:latest".to_owned(),
        name: "macro-agent-abc".to_owned(),
        labels: vec![("macro.agent_session_id".to_owned(), "abc".to_owned())],
        env: vec![(
            "REPO_URL".to_owned(),
            "https://github.com/macro-inc/macro".to_owned(),
        )],
        network: "macro_services".to_owned(),
    }
}

/// The container has to outlive the image's own `CMD`, or there is nothing
/// left for `docker exec` to enter.
#[test]
fn run_detaches_and_keeps_the_container_alive() {
    let args = run_args(&spec());

    assert_eq!(args[0], "run");
    assert!(args.contains(&"--detach".to_owned()));
    assert_eq!(
        &args[args.len() - 3..],
        ["macro-agent-harness:latest", "sleep", "infinity"]
    );
}

#[test]
fn run_passes_labels_and_environment_as_key_equals_value() {
    let args = run_args(&spec());

    let label = args.iter().position(|arg| arg == "--label").unwrap();
    assert_eq!(args[label + 1], "macro.agent_session_id=abc");
    let env = args.iter().position(|arg| arg == "--env").unwrap();
    assert_eq!(args[env + 1], "REPO_URL=https://github.com/macro-inc/macro");
}

/// The harness is itself a container, so a published host port would be on the
/// host's loopback, which is not this process. Sandboxes join the Compose
/// network and are dialed by name instead.
#[test]
fn a_sandbox_joins_the_compose_network_and_publishes_nothing() {
    let args = run_args(&spec());

    let network = args.iter().position(|arg| arg == "--network").unwrap();
    assert_eq!(args[network + 1], "macro_services");
    assert!(!args.contains(&"--publish".to_owned()));
}

/// A login shell, so the image's baked nix dev shell is on `PATH`.
#[test]
fn exec_runs_the_command_through_a_login_shell() {
    assert_eq!(
        exec_args("macro-agent-abc", "echo hi"),
        ["exec", "macro-agent-abc", "bash", "-lc", "echo hi"]
    );
}

/// A resume looks up a container that exists and is *not* running, so the
/// lookup must not be limited to running ones.
#[test]
fn finding_by_label_includes_stopped_containers() {
    let args = find_by_label_args("macro.agent_session_id", "abc");

    assert!(args.contains(&"--all".to_owned()));
    assert!(args.contains(&"label=macro.agent_session_id=abc".to_owned()));
}

/// Shutdown has to see stopped sandboxes too, or a Ctrl-C after idle leaves
/// them behind.
#[test]
fn listing_by_label_key_includes_stopped_containers() {
    let args = find_all_by_label_key_args("macro.agent_session_id");

    assert!(args.contains(&"--all".to_owned()));
    assert!(args.contains(&"label=macro.agent_session_id".to_owned()));
}

#[test]
fn image_inspect_names_the_image() {
    assert_eq!(
        image_inspect_args("macro-agent-harness:latest"),
        ["image", "inspect", "macro-agent-harness:latest"]
    );
}
