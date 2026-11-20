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
async fn herdr_core_starts_the_agent_in_a_login_shell() {
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

/// herdr-core's refusal of a `send` to a terminal in its first seconds whose
/// output has not yet been still: nothing was typed, so it is safe to retry.
const STILL_STARTING: &str = r#"{"error":{"hint":"nothing was typed; check hc read t9, then retry","kind":"unavailable","message":"t9 is still starting: its output has not settled"}}"#;

/// A fake `hc` whose first `refusals` sends fail like a starting terminal.
fn starting_hc(root: &Path, refusals: u32) -> std::path::PathBuf {
    let script = root.join("hc");
    let calls = root.join("calls");
    let refused = root.join("refused");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
printf '%s\n' "$*" >> {calls}
case "$1" in
  send)
    count=$(cat {refused} 2>/dev/null || echo 0)
    if [ "$count" -lt {refusals} ]; then
      echo $((count + 1)) > {refused}
      echo '{still}' >&2
      exit 1
    fi
    echo '{{"status":"idle","turn":1,"started":true}}' ;;
  *) echo '{{}}' ;;
esac
"#,
            calls = shell_words::quote(&calls.to_string_lossy()),
            refused = shell_words::quote(&refused.to_string_lossy()),
            still = STILL_STARTING,
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    script
}

#[tokio::test]
async fn a_prompt_to_a_starting_terminal_is_retried_until_it_types() {
    let root = tempfile::tempdir().unwrap();
    let herdr = HerdrCli::core(starting_hc(root.path(), 2), "t1");
    herdr.prompt_agent("macro-abc", "hello").await.unwrap();
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(
        calls
            .lines()
            .filter(|call| *call == "send macro-abc hello")
            .count(),
        3
    );
}

#[tokio::test]
async fn other_send_refusals_are_not_retried() {
    let root = tempfile::tempdir().unwrap();
    let script = root.path().join("hc");
    std::fs::write(
        &script,
        "#!/bin/sh\necho '{\"error\":{\"kind\":\"blocked\",\"message\":\"t9 is blocked (permission)\"}}' >&2\nexit 1\n",
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let error = HerdrCli::core(script, "t1")
        .prompt_agent("macro-abc", "hello")
        .await
        .unwrap_err();
    assert!(!error.still_starting());
}

#[test]
fn only_a_settle_refusal_counts_as_still_starting() {
    let refused = |stderr: &str| HerdrError::Refused {
        command: "send".to_owned(),
        stderr: stderr.to_owned(),
    };
    assert!(refused(STILL_STARTING).still_starting());
    assert!(
        !refused(r#"{"error":{"kind":"unavailable","message":"t9 has exited"}}"#).still_starting()
    );
}

fn launch<'a>(name: &'a str, args: &'a [String]) -> AgentLaunch<'a> {
    AgentLaunch {
        name,
        kind: "codex",
        reports_status: false,
        cwd: Path::new("/work"),
        label: "fix it",
        focus: false,
        environment: None,
        args,
    }
}

#[tokio::test]
async fn herdr_core_opens_every_session_in_its_own_space() {
    let root = tempfile::tempdir().unwrap();
    let herdr = HerdrCli::core(fake_hc(root.path()), "t1");
    herdr.launch_agent(&launch("macro-abc", &[])).await.unwrap();
    herdr.launch_agent(&launch("macro-abc", &[])).await.unwrap();

    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    let spaces: Vec<&str> = calls
        .lines()
        .filter(|call| call.starts_with("run "))
        .map(|call| {
            call.split(' ')
                .find_map(|word| word.strip_prefix("herdr.space="))
                .unwrap()
        })
        .collect();
    assert_eq!(spaces.len(), 2);
    // Never the operator's space that macrod runs in.
    assert!(!spaces.contains(&"space-1"));
    assert_ne!(spaces[0], spaces[1]);
}

/// A fake herdr 0.9 that logs each call and answers like it does.
fn fake_legacy_herdr(root: &Path) -> std::path::PathBuf {
    let script = root.join("herdr");
    let calls = root.join("calls");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
printf '%s\n' "$*" >> {calls}
case "$1 $2" in
  "workspace create"|"tab create") echo '{{"result":{{"workspace":{{"workspace_id":"w7"}},"tab":{{"tab_id":"w7:t1"}},"root_pane":{{"pane_id":"w7:p1","tab_id":"w7:t1"}}}}}}' ;;
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
async fn herdr_09_opens_every_session_as_its_own_workspace() {
    let root = tempfile::tempdir().unwrap();
    let herdr = HerdrCli::new(fake_legacy_herdr(root.path()), Some("w1".to_owned()));
    let window = herdr.launch_agent(&launch("macro-abc", &[])).await.unwrap();
    assert_eq!(window.pane_id, "w7:p1");

    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    let calls: Vec<&str> = calls.lines().collect();
    assert_eq!(
        calls[0],
        "workspace create --cwd /work --label fix it --no-focus"
    );
    // Not a tab in macrod's workspace, nor a worktree grouped under the
    // operator's repository workspace.
    assert!(!calls.iter().any(|call| call.starts_with("tab create")));
    assert!(!calls.iter().any(|call| call.starts_with("worktree ")));
    assert!(
        calls
            .iter()
            .any(|call| call.starts_with("agent start macro-abc --kind codex --pane w7:p1"))
    );
}
