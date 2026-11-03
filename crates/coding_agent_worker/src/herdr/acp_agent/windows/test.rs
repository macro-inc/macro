use super::*;
use std::os::unix::fs::PermissionsExt as _;

#[tokio::test]
async fn a_prompt_retry_adopts_the_agent_after_an_unconfirmed_first_launch() {
    for kind in [TuiAgent::Claude, TuiAgent::Codex] {
        let root = tempfile::tempdir().unwrap();
        let script = root.path().join("herdr");
        std::fs::write(&script, include_str!("herdr.sh")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let (mut adapter, _) = super::super::test::test_adapter(root.path());
        let adapter_mut = Arc::get_mut(&mut adapter).unwrap();
        adapter_mut.herdr = Some(HerdrCli::new(script, None));
        adapter_mut.options.kind = kind;
        let response = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
        let session = adapter
            .session(&json!({"sessionId":response["sessionId"]}))
            .unwrap();
        std::fs::write(
            root.path().join("started-agent.json"),
            json!({"result":{"agent":{
                "workspace_id":"w2","pane_id":"w2:p1","tab_id":"w2:t1","cwd":root.path(),
                "agent_status":"idle","agent_session":{"value":session.id}
            }}})
            .to_string(),
        )
        .unwrap();
        assert!(adapter.prompt(&session, "/fast").await.is_err());
        assert!(session.live.lock().await.is_none());
        let saved = adapter.store.load(&session.id).unwrap();
        assert!(saved.window.is_some());

        assert_eq!(adapter.prompt(&session, "/fast").await.unwrap(), "end_turn");
        let guard = session.live.lock().await;
        let live = guard.as_ref().unwrap();
        assert_eq!(
            live.started,
            std::time::UNIX_EPOCH + Duration::from_secs(saved.started)
        );
        let restored = adapter.store.load(&session.id).unwrap();
        assert_eq!(restored.window, saved.window);
        assert_eq!(restored.native_id.as_deref(), Some(session.id.as_str()));
        let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
        assert_eq!(calls.matches("workspace create").count(), 1);
        assert_eq!(calls.matches("agent start").count(), 1);
        assert_eq!(calls.matches("agent prompt").count(), 1);
        assert!(!calls.contains("rename"));
        adapter.shutdown.cancel();
    }
}

#[tokio::test]
async fn an_uninitialized_prompt_rejects_wrong_agent_identity_and_socket_errors() {
    let root = tempfile::tempdir().unwrap();
    let script = root.path().join("herdr");
    std::fs::write(&script, include_str!("herdr.sh")).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (mut adapter, _) = super::super::test::test_adapter(root.path());
    Arc::get_mut(&mut adapter).unwrap().herdr = Some(HerdrCli::new(script, None));
    let response = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
    let session = adapter
        .session(&json!({"sessionId":response["sessionId"]}))
        .unwrap();
    *lock(&session.native_id) = Some("expected-native-session".to_owned());
    for (cwd, native) in [
        (root.path().to_owned(), "another-native-session"),
        (root.path().join("another"), "expected-native-session"),
    ] {
        std::fs::write(
            root.path().join("agent.json"),
            json!({"result":{"agent":{
                "cwd":cwd,"agent_status":"idle","agent_session":{"value":native}
            }}})
            .to_string(),
        )
        .unwrap();
        let error = adapter.prompt(&session, "/model").await.unwrap_err();
        assert!(error.message.contains("identity no longer matches"));
        assert!(session.live.lock().await.is_none());
    }
    std::fs::write(root.path().join("agent-error"), "").unwrap();
    assert!(adapter.prompt(&session, "/model").await.is_err());
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert!(!calls.contains("workspace create"));
    assert!(!calls.contains("agent start"));
    assert!(!calls.contains("agent prompt"));
    assert!(session.live.lock().await.is_none());
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn recovery_preserves_readiness_and_core_support_for_agents_without_status() {
    for core in [false, true] {
        for kind in [TuiAgent::Claude, TuiAgent::Codex] {
            let root = tempfile::tempdir().unwrap();
            let script = root.path().join("herdr");
            std::fs::write(&script, include_str!("core-recovery.sh")).unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
            let (mut adapter, _) = super::super::test::test_adapter(root.path());
            let inner = Arc::get_mut(&mut adapter).unwrap();
            inner.options.kind = kind;
            inner.herdr = Some(if core {
                HerdrCli::core(script, "t1")
            } else {
                HerdrCli::new(script, None)
            });
            let response = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
            let session = adapter
                .session(&json!({"sessionId":response["sessionId"]}))
                .unwrap();
            let terminal = if core {
                json!({
                    "address":"t2","state":"live","cwd":root.path(),"status":null,
                    "labels":{"macro.agent":kind.herdr_kind()},
                    "foreground":{"pid":1,"name":kind.herdr_kind(),"argv":[],"cwd":root.path()}
                })
            } else {
                json!({"result":{"agent":{"agent_status":"unknown","cwd":root.path()}}})
            };
            std::fs::write(root.path().join("agent.json"), terminal.to_string()).unwrap();
            let result = adapter.prompt(&session, "/fast").await;
            let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
            if core && kind == TuiAgent::Codex {
                assert_eq!(result.unwrap(), "end_turn");
                assert!(
                    calls
                        .lines()
                        .filter(|line| line.starts_with("read "))
                        .count()
                        >= 3
                );
                assert!(calls.contains(&format!("send {} /fast", agent_name(&session.id))));
            } else {
                assert!(result.is_err());
                assert!(session.live.lock().await.is_none());
                assert!(!calls.contains("send "));
                assert!(!calls.contains("agent prompt"));
            }
            assert!(!calls.contains("run "));
            assert!(!calls.contains("workspace create"));
            assert!(!calls.contains("agent start"));
            adapter.shutdown.cancel();
        }
    }
}

#[tokio::test]
async fn core_recovery_does_not_submit_when_the_screen_never_settles() {
    let root = tempfile::tempdir().unwrap();
    let script = root.path().join("herdr");
    std::fs::write(&script, include_str!("core-recovery.sh")).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (mut adapter, _) = super::super::test::test_adapter(root.path());
    let inner = Arc::get_mut(&mut adapter).unwrap();
    inner.options.kind = TuiAgent::Codex;
    inner.herdr = Some(HerdrCli::core(script, "t1"));
    let response = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
    let session = adapter
        .session(&json!({"sessionId":response["sessionId"]}))
        .unwrap();
    std::fs::write(
        root.path().join("agent.json"),
        json!({
            "address":"t2","state":"live","cwd":root.path(),"status":null,
            "labels":{"macro.agent":"codex"},
            "foreground":{"pid":1,"name":"codex","argv":[],"cwd":root.path()}
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(root.path().join("unsteady"), "").unwrap();
    let error = adapter.prompt(&session, "/fast").await.unwrap_err();
    assert_eq!(error.message, HerdrError::NotReady.to_string());
    assert!(session.live.lock().await.is_none());
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert!(!calls.contains("send "));
    assert!(!calls.contains("run "));
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn a_resumed_claude_keeps_its_saved_native_identity() {
    let root = tempfile::tempdir().unwrap();
    let script = root.path().join("herdr");
    let fixture = include_str!("../effort/fixtures/startup.sh")
        .replace("ROOT", &shell_words::quote(&root.path().to_string_lossy()));
    std::fs::write(&script, fixture).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (adapter, _) = super::super::test::test_adapter(root.path());
    let response = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
    let session = adapter
        .session(&json!({"sessionId":response["sessionId"]}))
        .unwrap();
    let native = "00000000-0000-4000-8000-000000000001";
    *lock(&session.native_id) = Some(native.to_owned());
    let live = adapter
        .launch(&HerdrCli::new(script, None), &session, "continue", None)
        .await
        .unwrap();
    adapter.save(&session, Some(&live)).unwrap();
    assert_eq!(
        adapter
            .store
            .load(&session.id)
            .unwrap()
            .native_id
            .as_deref(),
        Some(native)
    );
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert!(calls.contains(&format!("--resume {native}")));
    assert!(!calls.contains("--session-id"));
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn retries_and_reloads_reuse_the_workspace_and_socket_errors_do_not_create_another() {
    let root = tempfile::tempdir().unwrap();
    let script = root.path().join("herdr");
    std::fs::write(&script, include_str!("herdr.sh")).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let herdr = HerdrCli::new(script, Some("w1".to_owned()));
    let (adapter, _) = super::super::test::test_adapter(root.path());
    let response = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
    let params = json!({"sessionId":response["sessionId"],"cwd":root.path()});
    let session = adapter.session(&params).unwrap();
    let launch = AgentLaunch {
        name: "macro-test",
        kind: "codex",
        reports_status: false,
        cwd: root.path(),
        label: "initial name",
        focus: false,
        environment: None,
        args: &[],
    };
    let first = adapter
        .session_window(&herdr, &session, &launch, None)
        .await
        .unwrap();
    assert_eq!(first.workspace_id.as_deref(), Some("w2"));
    std::fs::write(
        root.path().join("pane.json"),
        json!({"result":{"pane":{
            "workspace_id":"w2","pane_id":"w2:p1","tab_id":"w2:t1","cwd":root.path(),
            "foreground_cwd":root.path()
        }}})
        .to_string(),
    )
    .unwrap();
    assert_eq!(
        adapter
            .session_window(&herdr, &session, &launch, None)
            .await
            .unwrap(),
        first
    );
    let (reloaded, _) = super::super::test::test_adapter(root.path());
    reloaded.load_session(&params).await.unwrap();
    let restored = reloaded.session(&params).unwrap();
    assert_eq!(
        reloaded
            .session_window(&herdr, &restored, &launch, None)
            .await
            .unwrap(),
        first
    );
    std::fs::write(root.path().join("socket-error"), "").unwrap();
    assert!(
        reloaded
            .session_window(&herdr, &restored, &launch, None)
            .await
            .is_err()
    );
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(calls.matches("workspace create").count(), 1);
    assert!(!calls.contains("tab create"));
    assert!(!calls.contains("--workspace"));
    assert!(!calls.contains("worktree"));
    assert!(!calls.contains("rename"));

    std::fs::remove_file(root.path().join("socket-error")).unwrap();

    std::fs::write(
        root.path().join("agent.json"),
        json!({"result":{"agent":{
            "workspace_id":"w2","pane_id":"w2:p1","tab_id":"w2:t1","cwd":root.path(),
            "agent_status":"idle"
        }}})
        .to_string(),
    )
    .unwrap();
    let (mut connected, _) = super::super::test::test_adapter(root.path());
    Arc::get_mut(&mut connected).unwrap().herdr = Some(herdr.clone());
    connected.load_session(&params).await.unwrap();
    assert_eq!(
        connected.store.load(&session.id).unwrap().window,
        Some(first.clone())
    );
    connected.shutdown.cancel();

    // Pre-upgrade records have no tab. Reconnect to the live agent's current
    // pane without claiming ownership of its potentially shared workspace.
    let mut record = adapter.store.load(&session.id).unwrap();
    record.window = None;
    adapter.store.save(&record).unwrap();
    let (mut upgraded, _) = super::super::test::test_adapter(root.path());
    Arc::get_mut(&mut upgraded).unwrap().herdr = Some(herdr.clone());
    upgraded.load_session(&params).await.unwrap();
    let adopted = upgraded.store.load(&session.id).unwrap().window.unwrap();
    assert_eq!(adopted.pane_id, first.pane_id);
    assert_eq!(adopted.tab_id, first.tab_id);
    assert_eq!(adopted.workspace_id, None);
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
    assert_eq!(calls.matches("workspace create").count(), 1);
    upgraded.shutdown.cancel();

    std::fs::remove_file(root.path().join("pane.json")).unwrap();
    reloaded
        .session_window(&herdr, &restored, &launch, None)
        .await
        .unwrap();
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(calls.matches("workspace create").count(), 2);
    adapter.shutdown.cancel();
    reloaded.shutdown.cancel();
}

#[tokio::test]
async fn reload_rejects_a_registry_name_reused_by_another_native_session() {
    let root = tempfile::tempdir().unwrap();
    let script = root.path().join("herdr");
    std::fs::write(&script, include_str!("herdr.sh")).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (adapter, _) = super::super::test::test_adapter(root.path());
    let response = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
    let id = response["sessionId"].as_str().unwrap();
    let mut record = adapter.store.load(id).unwrap();
    record.native_id = Some("expected-native-session".to_owned());
    record.window = Some(Window {
        workspace_id: Some("w2".to_owned()),
        tab_id: "w2:t1".to_owned(),
        pane_id: "w2:p1".to_owned(),
    });
    adapter.store.save(&record).unwrap();
    for (cwd, native) in [
        (root.path().to_owned(), "another-native-session"),
        (root.path().join("another"), "expected-native-session"),
    ] {
        std::fs::write(
            root.path().join("agent.json"),
            json!({"result":{"agent":{
                "workspace_id":"w3", "tab_id":"w3:t1", "pane_id":"w3:p1", "cwd":cwd,
                "agent_session":{"value":native}, "agent_status":"idle"
            }}})
            .to_string(),
        )
        .unwrap();
        let (mut reloaded, _) = super::super::test::test_adapter(root.path());
        Arc::get_mut(&mut reloaded).unwrap().herdr = Some(HerdrCli::new(&script, None));
        assert!(
            reloaded
                .load_session(&json!({"sessionId":id,"cwd":root.path()}))
                .await
                .is_err()
        );
        assert_eq!(reloaded.store.load(id).unwrap().window, record.window);
        reloaded.shutdown.cancel();
    }
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn a_failed_session_save_rolls_back_the_new_workspace() {
    for close_fails in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let script = root.path().join("herdr");
        std::fs::write(&script, include_str!("herdr.sh")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let herdr = HerdrCli::new(script, Some("w1".to_owned()));
        let (adapter, _) = super::super::test::test_adapter(root.path());
        let response = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
        let session = adapter
            .session(&json!({"sessionId":response["sessionId"]}))
            .unwrap();
        let launch = AgentLaunch {
            name: "macro-test",
            kind: "codex",
            reports_status: false,
            cwd: root.path(),
            label: "initial name",
            focus: false,
            environment: None,
            args: &[],
        };
        let records = adapter.store.0.join("sessions");
        std::fs::rename(&records, root.path().join("saved-sessions")).unwrap();
        std::fs::write(&records, "not a directory").unwrap();
        if close_fails {
            std::fs::write(root.path().join("close-error"), "").unwrap();
        }
        let error = adapter
            .session_window(&herdr, &session, &launch, None)
            .await
            .unwrap_err();
        assert!(error.message.starts_with("could not save native session:"));
        let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
        assert_eq!(calls.matches("workspace create").count(), 1);
        assert!(calls.contains("workspace close w2"));
        assert!(lock(&session.window).is_none());
        adapter.shutdown.cancel();
    }
}
