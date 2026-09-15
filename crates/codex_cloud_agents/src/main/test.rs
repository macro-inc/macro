use super::*;
use clap::CommandFactory as _;

#[test]
fn cli_definition_and_documented_login_invocation_are_valid() {
    Args::command().debug_assert();
    let args = Args::try_parse_from([
        "codex-cloud-probe",
        "--state-dir",
        "/tmp/private-probe",
        "login",
    ])
    .unwrap();
    assert_eq!(args.state_dir, PathBuf::from("/tmp/private-probe"));
    assert!(matches!(args.command, Command::Login));
    assert!(Args::try_parse_from(["codex-cloud-probe", "login"]).is_err());
}

#[tokio::test]
async fn status_and_logout_do_not_require_network_or_existing_credentials() {
    let root = tempfile::tempdir().unwrap();
    let state_dir = root.path().join("private-probe");
    run(Args {
        state_dir: state_dir.clone(),
        command: Command::Status,
    })
    .await
    .unwrap();
    assert!(!state_dir.join("credentials.json").exists());
    run(Args {
        state_dir,
        command: Command::Logout,
    })
    .await
    .unwrap();
}

#[test]
fn launch_stream_and_resume_parse_without_starting_work() {
    let args = Args::try_parse_from([
        "codex-cloud-probe",
        "--state-dir",
        "/tmp/probe",
        "launch",
        "--environment",
        "env-test",
        "--branch",
        "main",
        "--prompt-file",
        "/tmp/prompt.txt",
        "--stream",
    ])
    .unwrap();
    assert!(matches!(args.command, Command::Launch { stream: true, .. }));
    let args = Args::try_parse_from([
        "codex-cloud-probe",
        "--state-dir",
        "/tmp/probe",
        "stream",
        "task-test",
    ])
    .unwrap();
    assert!(matches!(args.command, Command::Stream { .. }));
}

#[test]
fn observation_changes_preserve_revisions_and_terminal_empty_output() {
    let mut changes = Changes::default();
    let running = serde_json::json!({"status":"in_progress", "messages":[]});
    assert_eq!(changes.observe(running.clone()), Some(running.clone()));
    assert!(changes.observe(running).is_none());
    for text in ["hello", "hello world", "corrected", ""] {
        let update = serde_json::json!({"status":"in_progress", "messages":[text]});
        assert_eq!(changes.observe(update.clone()), Some(update.clone()));
        assert!(changes.observe(update).is_none());
    }
    let complete = serde_json::json!({"status":"completed", "messages":[]});
    assert_eq!(changes.observe(complete.clone()), Some(complete));
}
