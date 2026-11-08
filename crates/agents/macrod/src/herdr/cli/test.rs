use std::os::unix::fs::PermissionsExt as _;
use std::path::Path;

use super::hc::parse_terminal;
use super::*;

fn info(record: &str) -> Result<AgentInfo, HerdrError> {
    parse_terminal("get", record).unwrap().info()
}

#[test]
fn a_reporting_agent_shows_its_own_status() {
    let info = info(
        r#"{"address":"t4","state":"live","cwd":"/work","status":{"state":"blocked","app":"claude-code"},"status_ms":42,"foreground":{"pid":1,"name":".claude-wrapped","argv":[],"cwd":"/work/sub"}}"#,
    )
    .unwrap();
    assert_eq!(
        info,
        AgentInfo {
            status: "blocked".to_owned(),
            session_id: None,
            cwd: Some("/work".into()),
            state_change_seq: 42,
        }
    );
}

#[test]
fn an_agent_without_status_is_unknown_while_it_runs() {
    let info = info(
        r#"{"address":"t4","state":"live","cwd":"/work","labels":{"macro.agent":"codex"},"status":null,"foreground":{"pid":1,"name":"codex","argv":[],"cwd":"/work"}}"#,
    )
    .unwrap();
    assert_eq!(info.status, "unknown");
}

#[test]
fn a_finished_or_replaced_agent_is_missing() {
    let finished = info(r#"{"address":"t4","state":"finished","cwd":"/work"}"#).unwrap_err();
    assert!(finished.missing_agent());
    // A kept terminal whose agent was lost runs a fresh shell in its place.
    let replaced = info(
        r#"{"address":"t4","state":"live","cwd":"/work","labels":{"macro.agent":"claude"},"status":null,"foreground":{"pid":1,"name":"bash","argv":[],"cwd":"/work"}}"#,
    )
    .unwrap_err();
    assert!(replaced.missing_agent());
}

#[test]
fn both_herdrs_name_a_missing_agent() {
    let refused = |stderr: &str| HerdrError::Refused {
        command: "get".to_owned(),
        stderr: stderr.to_owned(),
    };
    assert!(refused(r#"{"error":{"code":"agent_not_found"}}"#).missing_agent());
    assert!(refused(r#"{"error":{"kind":"not_found","message":"no terminal"}}"#).missing_agent());
    assert!(!refused(r#"{"error":{"kind":"blocked"}}"#).missing_agent());
    assert!(refused(r#"{"error":{"code":"agent_pane_busy"}}"#).pane_busy());
}

/// A fake `hc` that logs each call and answers like herdr-core does.
fn fake_hc(root: &Path) -> std::path::PathBuf {
    let script = root.join("hc");
    let calls = root.join("calls");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
printf '%s\n' "$*" >> {calls}
case "$1 $2" in
  "get t1") echo '{{"address":"t1","state":"live","cwd":"/","labels":{{"herdr.space":"space-1"}}}}' ;;
  "get macro-abc") echo '{{"address":"t9","state":"live","cwd":"/work","labels":{{"macro.agent":"codex"}},"status":{{"state":"idle"}}}}' ;;
  run*) echo '{{"address":"t9","state":"live","cwd":"/work"}}' ;;
  *) echo '{{}}' ;;
esac
"#,
            calls = shell_words::quote(&calls.to_string_lossy()),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    script
}

#[tokio::test]
async fn herdr_core_opens_the_agent_as_a_tab_in_macrods_space() {
    let root = tempfile::tempdir().unwrap();
    let herdr = HerdrCli::core(fake_hc(root.path()), "t1");
    let args = ["--model".to_owned(), "gpt 5".to_owned()];
    let window = herdr
        .launch_agent(&AgentLaunch {
            name: "macro-abc",
            kind: "codex",
            reports_status: false,
            cwd: Path::new("/work"),
            label: "fix it",
            focus: false,
            worktree_source: None,
            environment: Some(Path::new("/private/env file")),
            args: &args,
        })
        .await
        .unwrap();
    assert_eq!(window.pane_id, "t9");

    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    let calls: Vec<&str> = calls.lines().collect();
    let run = calls.iter().find(|call| call.starts_with("run ")).unwrap();
    assert!(run.contains("--no-parent"));
    assert!(run.contains("--label herdr.space=space-1"));
    assert!(run.contains(&format!("--label herdr.tab={}", window.tab_id)));
    assert!(run.contains("--label macro.agent=codex"));
    assert!(run.contains("--name macro-abc"));
    // A shell, not the agent: it starts with the operator's login environment.
    assert!(!run.contains(" -- "));
    assert!(calls.contains(&"send t9 . '/private/env file' && exec codex --model 'gpt 5'"));
    // The previous terminal of this name was ended before the new one ran.
    let kill = calls
        .iter()
        .position(|call| *call == "kill macro-abc")
        .unwrap();
    let run = calls
        .iter()
        .position(|call| call.starts_with("run "))
        .unwrap();
    assert!(kill < run);
}

#[tokio::test]
async fn herdr_core_viewers_report_their_own_state() {
    let root = tempfile::tempdir().unwrap();
    let herdr = HerdrCli::core(fake_hc(root.path()), "t1");
    let window = herdr
        .open_viewer(
            Path::new("/work"),
            &["macrod".to_owned(), "herdr-pane".to_owned()],
        )
        .await
        .unwrap();
    herdr
        .report_state(&window, AgentState::Working, None, 1)
        .await
        .unwrap();
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert!(
        calls
            .lines()
            .any(|call| call.starts_with("run ") && call.ends_with("-- macrod herdr-pane"))
    );
    assert!(!calls.contains("report"));
}
