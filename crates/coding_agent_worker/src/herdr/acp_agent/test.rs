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
        &json!({"sessionUpdate": "tool_call", "toolCallId": "t", "title": "Bash ls"}),
    );
    assert_eq!(open, Some(("t".to_owned(), "Bash ls".to_owned())));
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

fn test_adapter(root: &Path) -> (Arc<Adapter>, mpsc::UnboundedReceiver<Value>) {
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

fn save_transcript(root: &Path, id: &str) -> PathBuf {
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
