use std::os::unix::fs::PermissionsExt as _;

use super::*;

/// Where the guest would have installed an earlier environment: next to the
/// inbox in tests.
fn installed(inbox_file: &std::path::Path) -> std::path::PathBuf {
    inbox_file
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("installed.env")
}

fn inbox() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let inbox = dir.path().join("inbox");
    std::fs::create_dir(&inbox).unwrap();
    let path = inbox.join("agent.env");
    (dir, path)
}

#[test]
fn a_handed_agent_environment_is_staged_whole_for_the_guest_to_install() {
    let (_dir, path) = inbox();
    let environment = [
        ("MACRO_API_KEY".to_owned(), "mak_\"ada\"".to_owned()),
        ("MACRO_AGENT_NAME".to_owned(), "Ada".to_owned()),
    ]
    .into_iter()
    .collect();

    stage_agent_env(&path, &installed(&path), &environment).unwrap();

    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "MACRO_AGENT_NAME=\"Ada\"\nMACRO_API_KEY=\"mak_\\\"ada\\\"\"\n"
    );
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(!path.with_extension("partial").exists());
}

#[test]
fn a_rotated_environment_replaces_the_staged_one() {
    let (_dir, path) = inbox();
    let first = [("MACRO_API_KEY".to_owned(), "mak_old".to_owned())]
        .into_iter()
        .collect();
    let second = [("MACRO_API_KEY".to_owned(), "mak_new".to_owned())]
        .into_iter()
        .collect();

    stage_agent_env(&path, &installed(&path), &first).unwrap();
    stage_agent_env(&path, &installed(&path), &second).unwrap();

    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "MACRO_API_KEY=\"mak_new\"\n"
    );
}

#[test]
fn a_handed_agent_environment_with_an_unsafe_name_or_value_is_refused() {
    let (_dir, path) = inbox();

    for (key, value) in [("lowercase", "x"), ("MACRO_API_KEY", "two\nlines")] {
        let environment = [(key.to_owned(), value.to_owned())].into_iter().collect();
        assert!(
            stage_agent_env(&path, &installed(&path), &environment).is_err(),
            "{key}"
        );
    }
    assert!(!path.exists());
}

/// A person's computer has no inbox, so an environment sent to it is
/// refused rather than written anywhere.
#[test]
fn a_computer_without_an_inbox_refuses_an_agent_environment() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("absent").join("agent.env");
    let environment = [("MACRO_API_KEY".to_owned(), "mak_ada".to_owned())]
        .into_iter()
        .collect();

    assert!(stage_agent_env(&path, &installed(&path), &environment).is_err());
    assert!(!path.exists());
}

/// A hand-off sent again with the environment the agent already runs with is
/// not staged, so the guest doesn't restart a starting agent.
#[test]
fn an_environment_the_agent_already_runs_with_is_not_staged_again() {
    let (_dir, path) = inbox();
    let environment = [("MACRO_API_KEY".to_owned(), "mak_ada".to_owned())]
        .into_iter()
        .collect();
    std::fs::write(installed(&path), "MACRO_API_KEY=\"mak_ada\"\n").unwrap();

    let staged = stage_agent_env(&path, &installed(&path), &environment).unwrap();

    assert_eq!(staged, Staged::Unchanged);
    assert!(!path.exists());
}

#[test]
fn the_setup_trace_is_staged_once_beside_the_environment_never_in_it() {
    let (_dir, path) = inbox();
    let trace = path.with_file_name("setup-traceparent");
    let environment: std::collections::BTreeMap<_, _> =
        [("MACRO_AGENT_NAME".to_owned(), "Ada".to_owned())]
            .into_iter()
            .collect();
    let first = "00-11111111111111111111111111111111-2222222222222222-01";
    let redelivered = "00-33333333333333333333333333333333-4444444444444444-01";

    stage_setup_traceparent(&trace, Some(first)).unwrap();
    stage_agent_env(&path, &installed(&path), &environment).unwrap();
    // A redelivery carries a fresh trace context: the environment stays
    // byte-identical (no restart) and the first context is kept.
    stage_setup_traceparent(&trace, Some(redelivered)).unwrap();
    stage_agent_env(&path, &installed(&path), &environment).unwrap();

    assert_eq!(std::fs::read_to_string(&trace).unwrap(), first);
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "MACRO_AGENT_NAME=\"Ada\"\n"
    );
}

#[test]
fn a_malformed_or_absent_setup_trace_stages_nothing() {
    let (_dir, path) = inbox();
    let trace = path.with_file_name("setup-traceparent");

    stage_setup_traceparent(&trace, Some("00-not-a-trace")).unwrap();
    stage_setup_traceparent(&trace, None).unwrap();

    assert!(!trace.exists());
}
