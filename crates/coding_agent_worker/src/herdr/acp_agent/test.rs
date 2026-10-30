use super::*;

#[test]
fn agent_names_satisfy_herdr() {
    let name = agent_name("A2089F46-70e2-4439-935e-1b9c23319df1");
    assert_eq!(name, "macro-a2089f4670e2");
    assert!(name.len() <= 32);
}

#[test]
fn prompts_keep_text_and_reference_files() {
    let prompt = json!([
        {"type": "text", "text": "build a todo app"},
        {"type": "resource_link", "uri": "file:///repo/spec.md", "name": "spec.md"},
        {"type": "image", "data": "..."},
    ]);
    assert_eq!(prompt_text(&prompt), "build a todo app\n@/repo/spec.md");
}

#[test]
fn macro_mcp_servers_become_claude_config() {
    let servers = [
        json!({"type": "http", "name": "macro", "url": "https://x/mcp",
            "headers": [{"name": "Authorization", "value": "Bearer t"}]}),
        json!({"name": "local", "command": "srv", "args": ["--x"], "env": [{"name": "K", "value": "V"}]}),
        json!({"type": "http", "url": "https://nameless"}),
    ];
    assert_eq!(
        Value::Object(claude_mcp_servers(&servers)),
        json!({
            "macro": {"type": "http", "url": "https://x/mcp", "headers": {"Authorization": "Bearer t"}},
            "local": {"command": "srv", "args": ["--x"], "env": {"K": "V"}},
        })
    );
}

#[test]
fn the_model_option_lists_claude_aliases() {
    let options = config_options(TuiAgent::Claude, "sonnet");
    assert_eq!(options[0]["id"], MODEL_CONFIG_ID);
    assert_eq!(options[0]["currentValue"], "sonnet");
    let values: Vec<_> = options[0]["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| option["value"].as_str().unwrap())
        .collect();
    assert_eq!(values, ["default", "opus", "sonnet", "haiku"]);
}

#[test]
fn an_open_tool_is_forgotten_once_it_reports() {
    let mut open = None;
    track_open_tool(
        &mut open,
        &json!({"sessionUpdate": "tool_call", "toolCallId": "t", "title": "Bash ls", "_meta": {"claudeCode": {"toolName": "Bash"}}}),
    );
    assert_eq!(
        open,
        Some(OpenTool {
            id: "t".to_owned(),
            title: "Bash ls".to_owned(),
            name: Some("Bash".to_owned()),
        })
    );
    track_open_tool(
        &mut open,
        &json!({"sessionUpdate": "tool_call_update", "toolCallId": "other"}),
    );
    assert!(open.is_some());
    track_open_tool(
        &mut open,
        &json!({"sessionUpdate": "tool_call_update", "toolCallId": "t"}),
    );
    assert_eq!(open, None);
}

#[test]
fn codex_offers_its_own_models() {
    let options = config_options(TuiAgent::Codex, DEFAULT_MODEL);
    let values: Vec<_> = options[0]["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| option["value"].as_str().unwrap())
        .collect();
    assert_eq!(values, ["default", "gpt-6-astra", "gpt-5.6", "gpt-5.5"]);
}

#[test]
fn codex_rollouts_are_found_by_session_id() {
    let root = tempfile::tempdir().unwrap();
    let day = root.path().join("2026/09/27");
    std::fs::create_dir_all(&day).unwrap();
    let wanted = day.join("rollout-2026-09-27T05-45-49-01a0e165-f280.jsonl");
    std::fs::write(&wanted, "").unwrap();
    std::fs::write(
        day.join("rollout-2026-09-27T05-45-13-01a0e165-6546.jsonl"),
        "",
    )
    .unwrap();
    assert_eq!(
        find_codex_rollout(root.path(), "01a0e165-f280"),
        Some(wanted)
    );
    assert_eq!(find_codex_rollout(root.path(), "missing"), None);
    assert_eq!(find_codex_rollout(root.path(), ""), None);
}

#[test]
fn an_unnamed_codex_session_takes_the_newest_unclaimed_rollout_in_its_directory() {
    let root = tempfile::tempdir().unwrap();
    let day = root.path().join("2026/09/27");
    std::fs::create_dir_all(&day).unwrap();
    let meta = |cwd: &str| {
        format!(
            "{}\n",
            json!({"type": "session_meta", "payload": {"cwd": cwd}})
        )
    };
    let since = std::time::SystemTime::now();
    let elsewhere = day.join("rollout-a-1.jsonl");
    std::fs::write(&elsewhere, meta("/other")).unwrap();
    let mine = day.join("rollout-b-2.jsonl");
    std::fs::write(&mine, meta("/repo")).unwrap();

    let mut claimed = std::collections::HashSet::new();
    assert_eq!(
        newest_codex_rollout(root.path(), Path::new("/repo"), since, &claimed),
        Some(mine.clone())
    );
    claimed.insert(mine);
    assert_eq!(
        newest_codex_rollout(root.path(), Path::new("/repo"), since, &claimed),
        None
    );
}

#[test]
fn codex_permission_dialogs_are_titled_from_the_screen() {
    let screen = "  Would you like to run the following command?\n\n  Environment: local\n\n  Reason: May I run the browser checks?\n\n  $ node /tmp/daylight-check.js\n\n› 1. Yes, proceed (y)\n";
    assert_eq!(
        permission_title(TuiAgent::Codex, screen),
        "Run node /tmp/daylight-check.js"
    );
    let reason_only = "Would you like to allow network access?\nReason: fetch the npm registry\n";
    assert_eq!(
        permission_title(TuiAgent::Codex, reason_only),
        "fetch the npm registry"
    );
    assert_eq!(
        permission_title(
            TuiAgent::Codex,
            "Would you like to make the following edits?\n"
        ),
        "Edit files"
    );
    assert_eq!(
        permission_title(TuiAgent::Codex, "nothing recognizable"),
        "Codex is asking for permission"
    );
}

pub(super) fn test_adapter(root: &Path) -> (Arc<Adapter>, mpsc::UnboundedReceiver<Value>) {
    let (out, receiver) = mpsc::unbounded_channel();
    (
        Arc::new(Adapter {
            store: Store(root.to_owned()),
            shutdown: CancellationToken::new(),
            out,
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
            sessions: Mutex::new(HashMap::new()),
            herdr: None,
            options: AdapterOptions::default(),
            home: None,
            claimed: Mutex::new(std::collections::HashSet::new()),
        }),
        receiver,
    )
}

pub(super) fn save_transcript(root: &Path, id: &str) -> PathBuf {
    let transcript = root.join(format!("{id}.jsonl"));
    std::fs::write(&transcript, "").unwrap();
    Store(root.to_owned())
        .save(&Record {
            version: 1,
            id: id.to_owned(),
            kind: TuiAgent::Claude,
            cwd: root.to_owned(),
            model: "sonnet".into(),
            native_id: Some(id.to_owned()),
            transcript: Some(transcript.clone()),
            started: 1,
        })
        .unwrap();
    transcript
}

fn append_turn(path: &Path, id: &str, prompt: &str) {
    use std::io::Write as _;
    let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
    writeln!(
        file,
        "{}",
        json!({"type":"user", "uuid":format!("{id}-user"), "message":{"content":prompt}})
    )
    .unwrap();
    writeln!(file, "{}", json!({"type":"assistant", "uuid":format!("{id}-agent"), "message":{"content":[{"type":"text", "text":"done"}], "stop_reason":"end_turn"}})).unwrap();
}

#[tokio::test]
async fn restore_replays_history_and_observes_local_turns_without_a_macro_prompt() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let transcript = save_transcript(root.path(), &id);
    append_turn(&transcript, "first", "historical prompt");
    let (adapter, mut output) = test_adapter(root.path());
    adapter
        .load_session(&json!({"sessionId":id, "cwd":root.path(), "mcpServers":[]}))
        .await
        .unwrap();
    let history: Vec<_> = std::iter::from_fn(|| output.try_recv().ok()).collect();
    assert_eq!(history.len(), 3);
    assert_eq!(
        history[0]["params"]["update"]["content"]["text"],
        "historical prompt"
    );
    assert_eq!(history[2]["method"], "_session/turn_complete");
    append_turn(&transcript, "second", "local prompt");
    append_turn(&transcript, "third", "another local prompt");
    let mut live = Vec::new();
    for _ in 0..6 {
        live.push(
            tokio::time::timeout(Duration::from_secs(2), output.recv())
                .await
                .unwrap()
                .unwrap(),
        );
    }
    assert_eq!(
        live[0]["params"]["update"]["content"]["text"],
        "local prompt"
    );
    assert_eq!(live[2]["method"], "_session/turn_complete");
    assert_eq!(
        live[3]["params"]["update"]["content"]["text"],
        "another local prompt"
    );
    assert_eq!(live[5]["method"], "_session/turn_complete");
    assert!(
        tokio::time::timeout(Duration::from_millis(400), output.recv())
            .await
            .is_err()
    );
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn restore_rejects_a_different_workspace_or_agent() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    save_transcript(root.path(), &id);
    let (adapter, mut output) = test_adapter(root.path());
    assert!(
        adapter
            .load_session(&json!({"sessionId":id,"cwd":"/other"}))
            .await
            .is_err()
    );
    assert!(output.try_recv().is_err());
    let mut record = adapter.store.load(&id).unwrap();
    record.kind = TuiAgent::Codex;
    adapter.store.save(&record).unwrap();
    assert!(
        adapter
            .load_session(&json!({"sessionId":id,"cwd":root.path()}))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn observer_waits_until_the_macro_prompt_response_has_been_sent() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let transcript = save_transcript(root.path(), &id);
    let (adapter, mut output) = test_adapter(root.path());
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    session.prompt_pending.store(true, Ordering::SeqCst);
    append_turn(&transcript, "first", "local prompt");
    assert!(
        tokio::time::timeout(Duration::from_millis(400), output.recv())
            .await
            .is_err()
    );
    session.prompt_pending.store(false, Ordering::SeqCst);
    let update = tokio::time::timeout(Duration::from_secs(2), output.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        update["params"]["update"]["content"]["text"],
        "local prompt"
    );
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn a_live_native_session_does_not_pretend_to_change_its_model() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    save_transcript(root.path(), &id);
    let (adapter, _) = test_adapter(root.path());
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    assert!(
        adapter
            .request(
                "session/set_config_option",
                json!({"sessionId":id,"configId":"model","value":"opus"})
            )
            .await
            .is_err()
    );
    assert_eq!(adapter.store.load(&id).unwrap().model, "sonnet");
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn an_unconfirmed_submission_never_sends_an_extra_enter_or_reports_success() {
    use std::os::unix::fs::PermissionsExt as _;
    let root = tempfile::tempdir().unwrap();
    let calls = root.path().join("calls");
    let script = root.path().join("herdr");
    std::fs::write(&script, format!("#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}\nprintf '%s\\n' '{{\"result\":{{\"agent\":{{\"agent_status\":\"idle\"}}}}}}'\n", shell_words::quote(&calls.to_string_lossy()))).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    save_transcript(root.path(), &id);
    let (adapter, _) = test_adapter(root.path());
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    let mut guard = session.live.lock().await;
    let error = adapter
        .follow(
            &HerdrCli::new(script, None),
            &session,
            guard.as_mut().unwrap(),
            &CancellationToken::new(),
            false,
        )
        .await
        .unwrap_err();
    assert!(error.message.contains("did not confirm"));
    assert!(
        !std::fs::read_to_string(calls)
            .unwrap()
            .contains("send-keys")
    );
    adapter.shutdown.cancel();
}

/// Claude Code in vim editor mode spends the first Esc leaving insert mode;
/// the turn keeps running until the second.
#[tokio::test]
async fn a_cancelled_turn_presses_esc_until_the_native_agent_stops() {
    use std::os::unix::fs::PermissionsExt as _;
    let root = tempfile::tempdir().unwrap();
    let presses = root.path().join("presses");
    let script = root.path().join("herdr");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\npresses={}\ncase \"$2\" in\n  send-keys) printf '%s\\n' \"$4\" >> \"$presses\";;\n  get) if [ \"$(wc -l < \"$presses\" 2>/dev/null || echo 0)\" -ge 2 ]; then status=done; else status=working; fi\n       printf '{{\"result\":{{\"agent\":{{\"agent_status\":\"%s\"}}}}}}\\n' \"$status\";;\n  *) exit 2;;\nesac\n",
            shell_words::quote(&presses.to_string_lossy())
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    save_transcript(root.path(), &id);
    let (adapter, _) = test_adapter(root.path());
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    let mut guard = session.live.lock().await;
    let cancel = CancellationToken::new();
    cancel.cancel();

    let stop = adapter
        .follow(
            &HerdrCli::new(script, None),
            &session,
            guard.as_mut().unwrap(),
            &cancel,
        )
        .await
        .unwrap();

    assert_eq!(stop, "cancelled");
    assert_eq!(std::fs::read_to_string(presses).unwrap(), "esc\nesc\n");
    adapter.shutdown.cancel();
}

#[test]
fn configured_models_are_advertised_even_when_not_in_the_builtin_catalog() {
    let options = config_options(TuiAgent::Codex, "custom-model");
    assert_eq!(options[0]["currentValue"], "custom-model");
    assert!(
        options[0]["options"]
            .as_array()
            .unwrap()
            .iter()
            .any(|option| option["value"] == "custom-model")
    );
}

#[tokio::test]
async fn commands_are_advertised_after_successful_new_and_load_responses() {
    let root = tempfile::tempdir().unwrap();
    let (adapter, mut output) = test_adapter(root.path());
    adapter
        .respond_to_request(json!(1), "session/new", json!({"cwd":root.path()}))
        .await;
    let response = output.try_recv().unwrap();
    let id = response["result"]["sessionId"].as_str().unwrap();
    assert_eq!(response["id"], 1);
    let commands = output.try_recv().unwrap();
    assert_eq!(commands["params"]["sessionId"], id);
    assert_eq!(
        commands["params"]["update"]["sessionUpdate"],
        "available_commands_update"
    );
    assert!(output.try_recv().is_err());

    adapter
        .respond_to_request(
            json!(2),
            "session/load",
            json!({"sessionId":id, "cwd":root.path()}),
        )
        .await;
    assert_eq!(output.try_recv().unwrap()["id"], 2);
    assert_eq!(output.try_recv().unwrap(), commands);
    assert!(output.try_recv().is_err());

    adapter
        .respond_to_request(
            json!(3),
            "session/load",
            json!({"sessionId":id, "cwd":"/wrong"}),
        )
        .await;
    assert!(output.try_recv().unwrap().get("error").is_some());
    assert!(output.try_recv().is_err());
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn native_controls_submit_once_and_acknowledge_delivery_without_a_model_turn() {
    for (kind, command) in [
        (TuiAgent::Claude, "/fast"),
        (TuiAgent::Claude, "/fast on"),
        (TuiAgent::Claude, "/fast off"),
        (TuiAgent::Codex, "/fast"),
        (TuiAgent::Codex, "/ultrafast"),
        (TuiAgent::Claude, "/effort"),
        (TuiAgent::Claude, "/effort high"),
        (TuiAgent::Claude, "/effort auto"),
        (TuiAgent::Claude, "/effort status"),
        (TuiAgent::Codex, "/model"),
    ] {
        for reject in [false, true] {
            check_control_delivery(kind, command, reject).await;
        }
    }
}

async fn check_control_delivery(kind: TuiAgent, command: &str, reject: bool) {
    use std::os::unix::fs::PermissionsExt as _;
    let root = tempfile::tempdir().unwrap();
    let calls = root.path().join("calls");
    let script = root.path().join("herdr");
    let exit_code = if reject { 1 } else { 0 };
    std::fs::write(&script, format!(
        "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}\ncase \"$2\" in\n  get) printf '%s\\n' '{{\"result\":{{\"agent\":{{\"agent_status\":\"idle\"}}}}}}';;\n  prompt) exit {exit_code};;\n  *) exit 2;;\nesac\n",
        shell_words::quote(&calls.to_string_lossy()),
    )).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    save_transcript(root.path(), &id);
    let (mut adapter, mut output) = test_adapter(root.path());
    let adapter_mut = Arc::get_mut(&mut adapter).unwrap();
    adapter_mut.herdr = Some(HerdrCli::new(script, None));
    adapter_mut.options.kind = kind;
    let mut record = adapter.store.load(&id).unwrap();
    record.kind = kind;
    adapter.store.save(&record).unwrap();
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    // Loading may inspect the native footer; only command delivery is under test.
    std::fs::write(&calls, "").unwrap();
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    let outcome = tokio::time::timeout(Duration::from_secs(2), adapter.prompt(&session, command))
        .await
        .expect("native controls do not wait for transcript output");
    if reject {
        assert!(outcome.is_err());
        assert!(
            output.try_recv().is_err(),
            "failed delivery must not be acknowledged"
        );
    } else {
        assert_eq!(outcome.unwrap(), "end_turn");
        let acknowledgment = output.try_recv().unwrap();
        assert_eq!(
            acknowledgment["params"]["update"]["sessionUpdate"],
            "agent_message_chunk"
        );
        assert!(
            acknowledgment["params"]["update"]["content"]["text"]
                .as_str()
                .unwrap()
                .starts_with(&format!("Sent `{command}`"))
        );
        assert!(output.try_recv().is_err());
    }
    let name = agent_name(&id);
    let settings_read = if kind == TuiAgent::Codex {
        format!("agent get {name}\nagent read {name} --source visible\n")
    } else {
        String::new()
    };
    assert_eq!(
        std::fs::read_to_string(calls).unwrap(),
        format!("agent get {name}\n{settings_read}agent prompt {name} {command}\n")
    );
    assert!(lock(&session.cancel).is_none());
    assert_eq!(adapter.store.load(&id).unwrap().native_id, Some(id));
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn an_agent_waits_for_a_shell_still_loading_its_environment() {
    use std::os::unix::fs::PermissionsExt as _;
    let root = tempfile::tempdir().unwrap();
    let script = root.path().join("herdr");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
cd {}
case "$1:$2" in
  tab:create) printf '{{"result":{{"root_pane":{{"tab_id":"w1:t1","pane_id":"w1:p1"}}}}}}\n' ;;
  agent:start)
    printf x >> starts
    [ "$(wc -c < starts)" -ge 3 ] && exit 0
    printf '{{"error":{{"code":"agent_pane_busy","message":"agent target pane w1:p1 is not an available shell"}}}}\n' >&2
    exit 1 ;;
  *) exit 1 ;;
esac
"#,
            shell_words::quote(&root.path().to_string_lossy())
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (adapter, _) = test_adapter(root.path());
    let created = adapter.new_session(&json!({"cwd":root.path()})).unwrap();
    let session = adapter
        .session(&json!({"sessionId":created["sessionId"]}))
        .unwrap();

    adapter
        .launch(&HerdrCli::new(script, None), &session, "hello")
        .await
        .unwrap();

    assert_eq!(
        std::fs::read_to_string(root.path().join("starts")).unwrap(),
        "xxx"
    );
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn a_late_codex_item_never_answers_a_waiting_macro_prompt() {
    use std::io::Write as _;
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let transcript = root.path().join("rollout.jsonl");
    std::fs::write(&transcript, "").unwrap();
    Store(root.path().to_owned())
        .save(&Record {
            version: 1,
            id: id.clone(),
            kind: TuiAgent::Codex,
            cwd: root.path().to_owned(),
            model: "gpt-5".into(),
            native_id: None,
            transcript: Some(transcript.clone()),
            started: 1,
        })
        .unwrap();
    let (mut adapter, mut output) = test_adapter(root.path());
    Arc::get_mut(&mut adapter).unwrap().options.kind = TuiAgent::Codex;
    adapter
        .load_session(&json!({"sessionId":id, "cwd":root.path()}))
        .await
        .unwrap();
    while output.try_recv().is_ok() {}
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    session.prompt_pending.store(true, Ordering::SeqCst);
    // Held throughout, so the observer stays out of the way.
    let mut guard = session.live.lock().await;
    let live = guard.as_mut().unwrap();
    let append = |payload: Value| {
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&transcript)
            .unwrap();
        writeln!(file, "{}", json!({"type":"event_msg", "payload":payload})).unwrap();
    };
    let late = |id: &str| {
        json!({"type":"item_completed", "item":{"type":"CommandExecution", "id":id,
            "command":["bash","-lc","bun run type-check"], "status":"completed", "exit_code":0}})
    };

    // Submitted, but Codex has not started the prompt's turn yet.
    append(late("exec-1"));
    assert_eq!(
        adapter.forward(&session, live, &mut None).unwrap(),
        (true, None)
    );
    assert_eq!(
        output.try_recv().unwrap()["params"]["update"]["toolCallId"],
        "exec-1"
    );
    assert!(output.try_recv().is_err());

    append(json!({"type":"task_started"}));
    append(
        json!({"type":"item_completed", "item":{"type":"AgentMessage", "id":"m1", "content":[{"type":"Text", "text":"Done."}]}}),
    );
    append(json!({"type":"task_complete"}));
    assert_eq!(
        adapter.forward(&session, live, &mut None).unwrap(),
        (true, Some("end_turn"))
    );
    while output.try_recv().is_ok() {}

    // With no prompt waiting, the late item is a finished turn of its own.
    session.prompt_pending.store(false, Ordering::SeqCst);
    append(late("exec-2"));
    assert_eq!(
        adapter.forward(&session, live, &mut None).unwrap(),
        (true, None)
    );
    assert_eq!(
        output.try_recv().unwrap()["params"]["update"]["toolCallId"],
        "exec-2"
    );
    assert_eq!(
        output.try_recv().unwrap()["method"],
        "_session/turn_complete"
    );
    adapter.shutdown.cancel();
}

/// A herdr whose agent status is the `status` file. Typing a prompt starts
/// a turn that the transcript records as already answered.
fn queueing_herdr(root: &Path, transcript: &Path, status: &str) -> HerdrCli {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::write(root.join("status"), status).unwrap();
    std::fs::write(
        root.join("macro-turn"),
        format!(
            "{}\n{}\n",
            json!({"type":"user", "uuid":"macro-user", "message":{"content":"from macro"}}),
            json!({"type":"assistant", "uuid":"macro-agent", "message":{"content":[{"type":"text", "text":"answered"}], "stop_reason":"end_turn"}}),
        ),
    )
    .unwrap();
    let script = root.join("herdr");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
cd {}
printf '%s\n' "$*" >> calls
case "$1:$2" in
  agent:get) printf '{{"result":{{"agent":{{"agent_status":"%s","state_change_seq":1}}}}}}\n' "$(cat status)" ;;
  agent:read) if [ "$(cat status)" = blocked ]; then cat dialog; fi ;;
  agent:send-keys) printf idle > status ;;
  agent:prompt) printf working > status; cat macro-turn >> {} ;;
  *) exit 1 ;;
esac
"#,
            shell_words::quote(&root.to_string_lossy()),
            shell_words::quote(&transcript.to_string_lossy()),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    HerdrCli::new(script, None)
}

#[tokio::test]
async fn a_prompt_to_a_busy_native_session_waits_for_its_turn_then_submits() {
    use std::io::Write as _;
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let transcript = save_transcript(root.path(), &id);
    let (mut adapter, mut output) = test_adapter(root.path());
    Arc::get_mut(&mut adapter).unwrap().herdr =
        Some(queueing_herdr(root.path(), &transcript, "working"));
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    session.prompt_pending.store(true, Ordering::SeqCst);
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&transcript)
        .unwrap();
    writeln!(
        file,
        "{}",
        json!({"type":"user", "uuid":"local-user", "message":{"content":"typed in herdr"}})
    )
    .unwrap();

    let prompt = tokio::spawn({
        let adapter = adapter.clone();
        let session = session.clone();
        async move { adapter.prompt(&session, "from macro").await }
    });
    let mut next = async || {
        tokio::time::timeout(Duration::from_secs(5), output.recv())
            .await
            .unwrap()
            .unwrap()
    };
    // The native turn keeps streaming while the Macro prompt waits for it.
    assert_eq!(
        next().await["params"]["update"]["content"]["text"],
        "typed in herdr"
    );
    std::fs::write(root.path().join("status"), "idle").unwrap();
    writeln!(file, "{}", json!({"type":"assistant", "uuid":"local-agent", "message":{"content":[{"type":"text", "text":"local answer"}], "stop_reason":"end_turn"}})).unwrap();
    assert_eq!(
        next().await["params"]["update"]["content"]["text"],
        "local answer"
    );
    assert_eq!(next().await["method"], "_session/turn_complete");
    assert_eq!(
        next().await["params"]["update"]["content"]["text"],
        "from macro"
    );
    assert_eq!(
        next().await["params"]["update"]["content"]["text"],
        "answered"
    );
    assert_eq!(prompt.await.unwrap().unwrap(), "end_turn");
    let name = agent_name(&id);
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(
        calls
            .matches(&format!("agent prompt {name} from macro\n"))
            .count(),
        1
    );
    adapter.shutdown.cancel();
}

#[tokio::test]
async fn a_prompt_dismisses_the_exit_confirmation_a_second_ctrl_c_left() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let transcript = save_transcript(root.path(), &id);
    std::fs::write(
        root.path().join("dialog"),
        "  Background work is running\n  ❯ 1. Exit and stop tasks\n    2. Move to background and exit\n    3. Stay\n  Enter to confirm · Esc to cancel\n",
    )
    .unwrap();
    let (mut adapter, _output) = test_adapter(root.path());
    Arc::get_mut(&mut adapter).unwrap().herdr =
        Some(queueing_herdr(root.path(), &transcript, "blocked"));
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    session.prompt_pending.store(true, Ordering::SeqCst);

    let outcome = tokio::time::timeout(
        Duration::from_secs(5),
        adapter.prompt(&session, "from macro"),
    )
    .await
    .unwrap();

    assert_eq!(outcome.unwrap(), "end_turn");
    let name = agent_name(&id);
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    let stayed = calls
        .find(&format!("agent send-keys {name} esc\n"))
        .unwrap();
    let prompted = calls
        .find(&format!("agent prompt {name} from macro\n"))
        .unwrap();
    assert!(stayed < prompted);
    adapter.shutdown.cancel();
}
