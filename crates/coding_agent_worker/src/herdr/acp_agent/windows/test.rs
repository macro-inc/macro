use super::*;
use std::os::unix::fs::PermissionsExt as _;

#[tokio::test]
async fn retries_and_reloads_reuse_the_tab_and_socket_errors_do_not_create_another() {
    let root = tempfile::tempdir().unwrap();
    let script = root.path().join("herdr");
    std::fs::write(&script, include_str!("herdr.sh")).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let herdr = HerdrCli::new(script, Some("w1".to_owned()));
    let (adapter, _) = super::super::test::test_adapter(root.path());
    let response = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
    let params = json!({"sessionId":response["sessionId"],"cwd":root.path()});
    let session = adapter.session(&params).unwrap();
    let first = adapter
        .session_window(&herdr, &session, "first", None)
        .await
        .unwrap();
    std::fs::write(
        root.path().join("pane.json"),
        json!({"result":{"pane":{
            "pane_id":"w1:p2","tab_id":"w1:t2","cwd":root.path(),
            "foreground_cwd":root.path()
        }}})
        .to_string(),
    )
    .unwrap();
    assert_eq!(
        adapter
            .session_window(&herdr, &session, "retry", None)
            .await
            .unwrap(),
        first
    );
    let (reloaded, _) = super::super::test::test_adapter(root.path());
    reloaded.load_session(&params).await.unwrap();
    let restored = reloaded.session(&params).unwrap();
    assert_eq!(
        reloaded
            .session_window(&herdr, &restored, "reloaded", None)
            .await
            .unwrap(),
        first
    );
    std::fs::write(root.path().join("socket-error"), "").unwrap();
    assert!(
        reloaded
            .session_window(&herdr, &restored, "offline", None)
            .await
            .is_err()
    );
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(calls.matches("tab create").count(), 1);
    assert!(calls.contains("--workspace w1"));
    assert!(!calls.contains("worktree"));

    std::fs::remove_file(root.path().join("socket-error")).unwrap();

    // Pre-upgrade records have no tab. Reconnect to the live agent's current
    // pane instead of creating a second tab after its next native restart.
    let mut record = adapter.store.load(&session.id).unwrap();
    record.window = None;
    adapter.store.save(&record).unwrap();
    std::fs::write(
        root.path().join("agent.json"),
        json!({"result":{"agent":{
            "pane_id":"w1:p2","tab_id":"w1:t2","cwd":root.path(),
            "agent_status":"idle"
        }}})
        .to_string(),
    )
    .unwrap();
    let (mut upgraded, _) = super::super::test::test_adapter(root.path());
    Arc::get_mut(&mut upgraded).unwrap().herdr = Some(herdr.clone());
    upgraded.load_session(&params).await.unwrap();
    assert_eq!(
        upgraded.store.load(&session.id).unwrap().window,
        Some(first)
    );
    // A reused tab may now belong to an editor or another native agent. Reject
    // it before sending the MCP environment command or trying to start an agent.
    std::fs::write(root.path().join("occupied"), "").unwrap();
    let upgraded_session = upgraded.session(&params).unwrap();
    assert!(
        upgraded
            .launch(&herdr, &upgraded_session, "occupied", None)
            .await
            .is_err()
    );
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert!(!calls.contains("pane run"));
    assert!(!calls.contains("agent start"));
    assert_eq!(calls.matches("tab create").count(), 1);
    upgraded.shutdown.cancel();

    std::fs::remove_file(root.path().join("pane.json")).unwrap();
    reloaded
        .session_window(&herdr, &restored, "closed", None)
        .await
        .unwrap();
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(calls.matches("tab create").count(), 2);
    adapter.shutdown.cancel();
    reloaded.shutdown.cancel();
}
