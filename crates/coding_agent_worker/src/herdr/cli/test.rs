use std::os::unix::fs::PermissionsExt as _;
use std::path::Path;

use super::hc::parse_terminal;
use super::*;

#[tokio::test]
async fn session_worktrees_are_created_without_registering_with_herdr() {
    use crate::outbound::git::git;
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("repo");
    std::fs::create_dir(&source).unwrap();
    git(&source, &["init", "-b", "main"]).await.unwrap();
    std::fs::write(source.join("file"), "committed").unwrap();
    git(&source, &["add", "file"]).await.unwrap();
    git(
        &source,
        &[
            "-c",
            "user.name=Agent",
            "-c",
            "user.email=agent@example.com",
            "commit",
            "-m",
            "initial",
        ],
    )
    .await
    .unwrap();
    git(&source, &["update-ref", "refs/remotes/origin/main", "HEAD"])
        .await
        .unwrap();
    std::fs::write(source.join("file"), "uncommitted").unwrap();
    let worktree = root.path().join("session");
    // Worktree creation must not invoke Herdr, whose registration would group
    // the new workspace under the repository's existing workspace.
    let herdr = HerdrCli::new(
        root.path().join("not-a-herdr-binary"),
        Some("w1".to_owned()),
    );
    herdr
        .create_worktree(&source, &worktree, "session")
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(worktree.join("file")).unwrap(),
        "committed"
    );
    assert_eq!(
        std::fs::read_to_string(source.join("file")).unwrap(),
        "uncommitted"
    );
    assert_eq!(
        git(&source, &["branch", "--show-current"]).await.unwrap(),
        "main"
    );
    assert_eq!(
        git(&worktree, &["branch", "--show-current"]).await.unwrap(),
        "session"
    );
}

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
            window: None,
            workspace_id: None,
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
  "get t9") cat {terminal} ;;
  run*) echo '{{"address":"t9","state":"live","cwd":"/work"}}' ;;
  *) echo '{{}}' ;;
esac
"#,
            calls = shell_words::quote(&calls.to_string_lossy()),
            terminal = shell_words::quote(&root.join("terminal.json").to_string_lossy()),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    script
}

#[tokio::test]
async fn herdr_core_opens_native_agents_in_independent_spaces() {
    let root = tempfile::tempdir().unwrap();
    let herdr = HerdrCli::core(fake_hc(root.path()), "t1");
    let args = ["--model".to_owned(), "gpt 5".to_owned()];
    let launch = AgentLaunch {
        name: "macro-abc",
        kind: "codex",
        reports_status: false,
        cwd: Path::new("/work"),
        label: "fix it",
        focus: false,
        environment: Some(Path::new("/private/env file")),
        args: &args,
    };
    let window = herdr.open_agent(&launch).await.unwrap();
    herdr.start_agent(&launch, &window).await.unwrap();
    assert_eq!(window.pane_id, "t9");

    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    let calls: Vec<&str> = calls.lines().collect();
    let run = calls.iter().find(|call| call.starts_with("run ")).unwrap();
    assert!(run.contains("--no-parent"));
    assert!(!run.contains("--label herdr.space=space-1"));
    assert!(run.contains(&format!(
        "--label herdr.space={}",
        window.workspace_id.as_ref().unwrap()
    )));
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
    let other = herdr
        .open_agent(&AgentLaunch {
            name: "macro-other",
            ..launch
        })
        .await
        .unwrap();
    assert_ne!(window.workspace_id, other.workspace_id);
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

#[tokio::test]
async fn herdr_core_reuses_only_a_shell_in_the_sessions_current_directory() {
    let root = tempfile::tempdir().unwrap();
    let herdr = HerdrCli::core(fake_hc(root.path()), "t1");
    let saved = Window {
        workspace_id: Some("space-2".to_owned()),
        tab_id: "tab-2".to_owned(),
        pane_id: "t9".to_owned(),
    };
    let mut terminal = serde_json::json!({
        "address":"t9", "state":"live", "cwd":"/work", "pid":100,
        "labels":{"herdr.space":"space-2","herdr.tab":"tab-2","macro.agent":"codex"},
        "foreground":{"name":"zsh", "cwd":"/elsewhere", "pid":100}
    });
    std::fs::write(root.path().join("terminal.json"), terminal.to_string()).unwrap();
    assert!(
        herdr
            .existing_window(&saved, Path::new("/work"))
            .await
            .is_err()
    );
    terminal["foreground"]["cwd"] = serde_json::Value::Null;
    std::fs::write(root.path().join("terminal.json"), terminal.to_string()).unwrap();
    assert!(
        herdr
            .existing_window(&saved, Path::new("/work"))
            .await
            .is_err()
    );
    terminal["foreground"]["cwd"] = serde_json::json!("/work");
    terminal["foreground"]["pid"] = serde_json::json!(200);
    std::fs::write(root.path().join("terminal.json"), terminal.to_string()).unwrap();
    assert!(
        herdr
            .existing_window(&saved, Path::new("/work"))
            .await
            .is_err()
    );
    terminal["foreground"]["pid"] = serde_json::json!(100);
    std::fs::write(root.path().join("terminal.json"), terminal.to_string()).unwrap();
    assert_eq!(
        herdr
            .existing_window(&saved, Path::new("/work"))
            .await
            .unwrap(),
        Some(saved)
    );
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(
        calls.lines().collect::<Vec<_>>(),
        [
            "get t9 --json",
            "get t9 --json",
            "get t9 --json",
            "get t9 --json"
        ]
    );
}
