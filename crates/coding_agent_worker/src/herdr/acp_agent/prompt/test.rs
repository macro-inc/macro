use super::*;
use crate::herdr::acp_agent::test::{save_transcript, test_adapter};
use std::os::unix::fs::PermissionsExt as _;

#[tokio::test]
async fn codex_followup_reaches_a_working_turn_without_waiting_for_idle() {
    check_codex_steering(false).await;
}

#[tokio::test]
async fn recovered_codex_followup_reaches_the_existing_working_turn() {
    check_codex_steering(true).await;
}

async fn check_codex_steering(recover: bool) {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    let transcript = save_transcript(root.path(), &id);
    let (mut adapter, mut output) = test_adapter(root.path());
    let script = root.path().join("herdr");
    std::fs::write(
        &script,
        include_str!("herdr.sh")
            .replace(
                "@ROOT@",
                &shell_words::quote(&root.path().to_string_lossy()),
            )
            .replace(
                "@TRANSCRIPT@",
                &shell_words::quote(&transcript.to_string_lossy()),
            ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(root.path().join("status"), "working").unwrap();
    std::fs::write(
        root.path().join("submitted"),
        format!(
            "{}\n{}\n{}\n",
            // The preceding turn can finish between PTY submission and receipt.
            json!({"type":"event_msg","payload":{"type":"task_complete"}}),
            json!({"type":"event_msg","payload":{"type":"item_completed","item":{
                "id":"followup","type":"UserMessage","content":[{"text":"from macro"}]
            }}}),
            json!({"type":"event_msg","payload":{"type":"task_complete"}}),
        ),
    )
    .unwrap();
    let adapter_mut = Arc::get_mut(&mut adapter).unwrap();
    adapter_mut.herdr = Some(HerdrCli::new(script, None));
    adapter_mut.options.kind = TuiAgent::Codex;
    let mut record = adapter.store.load(&id).unwrap();
    record.kind = TuiAgent::Codex;
    record.model = "gpt-6-astra".to_owned();
    adapter.store.save(&record).unwrap();
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    session.prompt_pending.store(true, Ordering::SeqCst);
    if recover {
        *session.live.lock().await = None;
    }

    let result = tokio::time::timeout(
        Duration::from_secs(3),
        adapter.prompt(&session, "from macro"),
    )
    .await;
    adapter.shutdown.cancel();
    assert_eq!(
        result
            .expect("the active turn must receive the followup")
            .unwrap(),
        "end_turn"
    );
    let updates: Vec<_> = std::iter::from_fn(|| output.try_recv().ok()).collect();
    assert_eq!(
        updates.len(),
        2,
        "only the submitted prompt's end is forwarded"
    );
    assert_eq!(
        updates[0]["params"]["update"]["content"]["text"],
        "from macro"
    );
    assert_eq!(updates[1]["method"], "_session/turn_complete");
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(calls.matches("agent prompt").count(), 1);
    assert!(
        !calls.contains("send-keys"),
        "steering must not interrupt the turn"
    );
    assert_eq!(adapter.store.load(&id).unwrap().native_id, Some(id));
}

#[tokio::test]
async fn old_completions_and_other_user_input_do_not_acknowledge_a_codex_prompt() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    save_transcript(root.path(), &id);
    let (adapter, mut output) = test_adapter(root.path());
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    let mut guard = session.live.lock().await;
    let live = guard.as_mut().unwrap();
    live.pending.extend([
        LogEvent::TurnEnded("end_turn"),
        LogEvent::Update(json!({
            "sessionUpdate":"user_message_chunk",
            "content":{"type":"text","text":"a different local prompt"}
        })),
        LogEvent::TurnEnded("end_turn"),
    ]);
    let mut expected = Some("from macro");
    let (_, ended) = adapter
        .forward_submission(&session, live, &mut None, &mut expected)
        .unwrap();
    assert_eq!(ended, None);
    assert_eq!(expected, Some("from macro"));
    assert_eq!(
        output.try_recv().unwrap()["params"]["update"]["content"]["text"],
        "a different local prompt"
    );
    assert!(
        output.try_recv().is_err(),
        "no successful completion before receipt"
    );
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn codex_controls_and_blocked_dialogs_wait_without_typing_into_the_active_ui() {
    for (status, text) in [("working", "/model"), ("blocked", "from macro")] {
        let root = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::now_v7().to_string();
        let transcript = save_transcript(root.path(), &id);
        let (mut adapter, mut output) = test_adapter(root.path());
        let script = root.path().join("herdr");
        std::fs::write(
            &script,
            include_str!("herdr.sh")
                .replace(
                    "@ROOT@",
                    &shell_words::quote(&root.path().to_string_lossy()),
                )
                .replace(
                    "@TRANSCRIPT@",
                    &shell_words::quote(&transcript.to_string_lossy()),
                ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(root.path().join("status"), status).unwrap();
        std::fs::write(root.path().join("submitted"), "").unwrap();
        let adapter_mut = Arc::get_mut(&mut adapter).unwrap();
        adapter_mut.options.kind = TuiAgent::Codex;
        adapter_mut.herdr = Some(HerdrCli::new(script, None));
        let mut record = adapter.store.load(&id).unwrap();
        record.kind = TuiAgent::Codex;
        adapter.store.save(&record).unwrap();
        adapter
            .load_session(&json!({"sessionId":id,"cwd":root.path()}))
            .await
            .unwrap();
        let session = adapter.session(&json!({"sessionId":id})).unwrap();
        session.prompt_pending.store(true, Ordering::SeqCst);
        std::fs::write(&transcript, format!("{}\n", json!({
            "type":"event_msg","payload":{"type":"item_completed","item":{
                "id":"local-progress","type":"AgentMessage","content":[{"text":"still working"}]
            }}
        }))).unwrap();
        let prompt = tokio::spawn({
            let adapter = adapter.clone();
            let session = session.clone();
            async move { adapter.prompt(&session, text).await }
        });
        let update = tokio::time::timeout(Duration::from_secs(3), output.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            update["params"]["update"]["content"]["text"],
            "still working"
        );
        prompt.abort();
        let _ = prompt.await;
        let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
        assert!(!calls.contains("agent prompt"));
        assert!(!calls.contains("send-keys"));
        adapter.shutdown.cancel();
    }
}
