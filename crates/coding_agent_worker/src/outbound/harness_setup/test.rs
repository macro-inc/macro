use super::*;
use std::collections::BTreeMap;

fn command(script: &str) -> SetupCommand {
    SetupCommand {
        program: "sh".to_owned(),
        args: vec!["-c".to_owned(), script.to_owned()],
        env: BTreeMap::new(),
        success_text: None,
    }
}

#[tokio::test]
async fn native_setup_uses_workspace_and_environment_and_checks_exit_status() {
    let dir = tempfile::tempdir().unwrap();
    let runner = NativeSetup { cwd: dir.path() };
    let mut spec = command("test \"$SETUP_TEST_VALUE\" = expected && test -f workspace-marker");
    spec.env
        .insert("SETUP_TEST_VALUE".to_owned(), "expected".to_owned());
    std::fs::write(dir.path().join("workspace-marker"), "").unwrap();
    runner.run(&spec).await.unwrap();
    std::fs::remove_file(dir.path().join("workspace-marker")).unwrap();
    assert!(runner.run(&spec).await.is_err());
}

#[tokio::test]
async fn zero_exit_without_authentication_is_not_success() {
    let dir = tempfile::tempdir().unwrap();
    let runner = NativeSetup { cwd: dir.path() };
    let mut spec = command("printf 'Authentication failed'; exit 0");
    spec.success_text = Some("Authenticated");
    assert!(runner.run(&spec).await.is_err());
    spec.args[1] = "printf 'Auth'; printf 'enticated' >&2".to_owned();
    assert!(runner.run(&spec).await.is_err());
    spec.args[1] = "printf 'Authenticated' >&2".to_owned();
    runner.run(&spec).await.unwrap();
    spec.args[1] = "printf 'Authenticated'; exit 1".to_owned();
    assert!(runner.run(&spec).await.is_err());
}

#[tokio::test]
async fn distinguishes_missing_claude_server_from_inspection_failure() {
    let dir = tempfile::tempdir().unwrap();
    let runner = NativeSetup { cwd: dir.path() };
    assert_eq!(
        runner
            .configured_url(&command(
                "printf 'No MCP server found with name: macro' >&2; exit 1"
            ))
            .await
            .unwrap(),
        None
    );
    assert!(runner.configured_url(&command("exit 1")).await.is_err());
    assert_eq!(
        runner
            .configured_url(&command(
                "printf 'macro:\n  URL: https://gateway.macro.com/mcp\n'"
            ))
            .await
            .unwrap(),
        Some("https://gateway.macro.com/mcp".to_owned())
    );
    assert!(
        runner
            .configured_url(&command("printf 'Type: stdio'"))
            .await
            .is_err()
    );
}
