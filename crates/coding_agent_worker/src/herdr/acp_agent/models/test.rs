use super::*;
use crate::herdr::acp_agent::test::{save_transcript, test_adapter};
use std::os::unix::fs::PermissionsExt as _;

const MODEL_PICKER: &str = include_str!("fixtures/codex-model.txt");
const EFFORT_PICKER: &str = include_str!("fixtures/codex-effort.txt");
const INITIAL: &str = include_str!("fixtures/codex-before.txt");
const CHANGED: &str = include_str!("fixtures/codex-after.txt");

#[test]
fn model_selection_uses_exact_rows_and_preserves_native_effort_selection() {
    assert_eq!(
        picker_key(Stage::Model, "gpt-6-sol", MODEL_PICKER)
            .unwrap()
            .0,
        "2"
    );
    assert_eq!(
        picker_key(Stage::Effort, "gpt-6-sol", EFFORT_PICKER)
            .unwrap()
            .0,
        "enter"
    );
    assert!(picker_key(Stage::Model, "gpt-6", MODEL_PICKER).is_none());
    assert!(picker_key(Stage::Effort, "gpt-6-astra", EFFORT_PICKER).is_none());
    assert!(picker_key(Stage::Confirmation, "gpt-6-sol", EFFORT_PICKER).is_none());
    for screen in [
        "Would you like to run the following command?\n› 1. Yes, proceed\n2. No",
        "Select Reasoning Level for gpt-6-sol\n› 1. Accept additional charges\nPress enter to confirm or esc to go back",
        "Select Reasoning Level for gpt-6-sol\n› 5. More reasoning…\nPress enter to confirm or esc to go back",
    ] {
        assert!(picker_key(Stage::Model, "gpt-6-sol", screen).is_none());
        assert!(picker_key(Stage::Effort, "gpt-6-sol", screen).is_none());
    }
}

#[test]
fn effective_model_comes_from_live_footer_not_stale_banner_or_picker() {
    assert_eq!(codex_footer_model(CHANGED), Some("gpt-6-sol"));
    assert_eq!(codex_footer_model(MODEL_PICKER), None);
    assert_eq!(
        codex_footer_model("│ model: gpt-6-astra /model to change │"),
        None
    );
    assert!(!confirmed(
        TuiAgent::Codex,
        "gpt-6-sol",
        INITIAL,
        MODEL_PICKER
    ));
    assert!(confirmed(TuiAgent::Codex, "gpt-6-sol", INITIAL, CHANGED));
}

#[test]
fn claude_requires_a_fresh_native_confirmation() {
    let confirmation = "❯ /model opus\n  ⎿ Set model to Opus 5 (1M context) and saved as your default for new sessions";
    assert!(confirmed(TuiAgent::Claude, "opus", "", confirmation));
    assert!(!confirmed(TuiAgent::Claude, "sonnet", "", confirmation));
    assert!(!confirmed(
        TuiAgent::Claude,
        "opus",
        confirmation,
        confirmation
    ));
    assert!(!confirmed(
        TuiAgent::Claude,
        "opus",
        "",
        "assistant said Set model to Opus 5"
    ));
    assert!(!confirmed(
        TuiAgent::Claude,
        "opus",
        "",
        "Set model to OpusNext"
    ));
}

fn catalog(root: &Path) {
    std::fs::create_dir(root.join(".codex")).unwrap();
    std::fs::write(
        root.join(".codex/models_cache.json"),
        json!({"models":[
            {"slug":"gpt-6-astra","display_name":"GPT-6 Astra","visibility":"list"},
            {"slug":"gpt-6-sol","display_name":"GPT-6 Sol","visibility":"list"},
            {"slug":"hidden-model","visibility":"hide"}
        ]})
        .to_string(),
    )
    .unwrap();
}

#[test]
fn installed_catalog_includes_new_models_and_retains_current_custom_model() {
    let root = tempfile::tempdir().unwrap();
    catalog(root.path());
    let (mut adapter, _) = test_adapter(root.path());
    let inner = Arc::get_mut(&mut adapter).unwrap();
    inner.home = Some(root.path().to_owned());
    inner.options.kind = TuiAgent::Codex;
    let options = adapter.model_options("my-model");
    assert_eq!(options[0]["currentValue"], "my-model");
    let values: Vec<_> = options[0]["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| option["value"].as_str().unwrap())
        .collect();
    assert_eq!(values, ["my-model", "gpt-6-astra", "gpt-6-sol"]);
}

async fn model_change(kind: TuiAgent, fails: bool) {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    save_transcript(root.path(), &id);
    let mut record = Store(root.path().to_owned()).load(&id).unwrap();
    record.kind = kind;
    record.model = DEFAULT_MODEL.to_owned();
    Store(root.path().to_owned()).save(&record).unwrap();
    catalog(root.path());
    for (index, screen) in [INITIAL, MODEL_PICKER, EFFORT_PICKER, CHANGED]
        .iter()
        .enumerate()
    {
        std::fs::write(root.path().join(format!("screen{index}")), screen).unwrap();
    }
    if kind == TuiAgent::Claude {
        std::fs::write(
            root.path().join("screen1"),
            "⎿ Set model to Opus 5 (1M context)",
        )
        .unwrap();
    }
    std::fs::write(root.path().join("stage"), "0").unwrap();
    let script = root.path().join("herdr");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
cd {root}
printf '%s\n' "$*" >> calls
stage=$(cat stage)
case "$2" in
  get)
    status=idle
    if [ '{fails}' = true ] && [ "$stage" != 0 ]; then status=working; fi
    printf '{{"result":{{"agent":{{"agent_status":"%s","state_change_seq":1}}}}}}\n' "$status" ;;
  read) cat "screen$stage" ;;
  prompt) printf '1' > stage ;;
  send-keys)
    case "$stage:$4" in
      1:2) printf '2' > stage ;;
      2:enter) printf '3' > stage ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
"#,
            root = shell_words::quote(&root.path().to_string_lossy()),
            fails = fails
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (mut adapter, mut output) = test_adapter(root.path());
    let inner = Arc::get_mut(&mut adapter).unwrap();
    inner.options.kind = kind;
    inner.home = Some(root.path().to_owned());
    inner.herdr = Some(HerdrCli::new(script, None));
    // Exercise RPCs without background polling racing the scripted native TUI.
    adapter.shutdown.cancel();
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    let wanted = if kind == TuiAgent::Codex {
        "gpt-6-sol"
    } else {
        "opus"
    };
    let result = adapter
        .request(
            "session/set_config_option",
            json!({"sessionId":id,"configId":"model","value":wanted}),
        )
        .await;
    let saved = adapter.store.load(&id).unwrap();
    if fails {
        assert!(result.is_err());
        assert_ne!(saved.model, wanted);
    } else {
        assert_eq!(result.unwrap()["configOptions"][0]["currentValue"], wanted);
        assert_eq!(saved.model, wanted);
        let mut models = Vec::new();
        while let Ok(update) = output.try_recv() {
            if let Some(model) = update
                .pointer("/params/update/configOptions/0/currentValue")
                .and_then(Value::as_str)
            {
                models.push(model.to_owned());
            }
        }
        assert_eq!(models.last().map(String::as_str), Some(wanted));
    }
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(
        calls
            .lines()
            .filter(|line| line.starts_with("agent prompt"))
            .count(),
        1
    );
    let keys: Vec<_> = calls
        .lines()
        .filter(|line| line.starts_with("agent send-keys"))
        .map(|line| line.split_whitespace().last().unwrap())
        .collect();
    assert_eq!(
        keys,
        if kind == TuiAgent::Codex && !fails {
            vec!["2", "enter"]
        } else {
            vec![]
        }
    );
}

#[tokio::test]
async fn codex_model_rpc_drives_native_picker_and_only_reports_confirmed_model() {
    model_change(TuiAgent::Codex, false).await;
}

#[tokio::test]
async fn claude_model_rpc_submits_direct_model_command_and_waits_for_confirmation() {
    model_change(TuiAgent::Claude, false).await;
}

#[tokio::test]
async fn interrupted_native_selection_does_not_report_success_or_send_keys() {
    model_change(TuiAgent::Codex, true).await;
}

#[tokio::test]
async fn replay_returns_and_persists_actual_model_instead_of_saved_default() {
    for kind in [TuiAgent::Claude, TuiAgent::Codex] {
        let root = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let transcript = save_transcript(root.path(), &id);
        let model = if kind == TuiAgent::Claude {
            "claude-opus-5"
        } else {
            "gpt-6-sol"
        };
        let event = if kind == TuiAgent::Claude {
            json!({"type":"assistant","uuid":"answer","message":{"model":model,"content":[]}})
        } else {
            json!({"type":"turn_context","payload":{"model":model}})
        };
        std::fs::write(transcript, format!("{event}\n")).unwrap();
        let mut record = Store(root.path().to_owned()).load(&id).unwrap();
        record.kind = kind;
        record.model = DEFAULT_MODEL.to_owned();
        Store(root.path().to_owned()).save(&record).unwrap();
        let (mut adapter, _) = test_adapter(root.path());
        Arc::get_mut(&mut adapter).unwrap().options.kind = kind;
        adapter.shutdown.cancel();
        let response = adapter
            .load_session(&json!({"sessionId":id,"cwd":root.path()}))
            .await
            .unwrap();
        assert_eq!(response["configOptions"][0]["currentValue"], model);
        assert_eq!(adapter.store.load(&id).unwrap().model, model);
    }
}

#[tokio::test]
async fn an_observer_lock_does_not_reject_an_idle_model_selection() {
    let root = tempfile::tempdir().unwrap();
    let (adapter, _) = test_adapter(root.path());
    adapter.shutdown.cancel();
    let response = adapter
        .new_session(&json!({"cwd":root.path(),"mcpServers":[]}))
        .unwrap();
    let session = adapter.session(&response).unwrap();
    let guard = session.live.lock().await;
    let waiting = adapter.set_model(&session, "opus");
    let unlock = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        drop(guard);
    };
    let (result, ()) = tokio::join!(waiting, unlock);
    assert_eq!(result.unwrap()["configOptions"][0]["currentValue"], "opus");
    session.prompt_pending.store(true, Ordering::SeqCst);
    assert!(adapter.set_model(&session, "sonnet").await.is_err());
    assert_eq!(*lock(&session.model), "opus");
}

#[tokio::test]
async fn native_identity_changes_are_rejected_and_metadata_is_not_a_turn() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    save_transcript(root.path(), &id);
    let (adapter, mut output) = test_adapter(root.path());
    adapter.shutdown.cancel();
    adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    let mut info = super::super::super::cli::AgentInfo {
        cwd: Some(root.path().to_owned()),
        session_id: Some(id),
        status: "idle".to_owned(),
        state_change_seq: 1,
    };
    assert!(same_session(&session, &info));
    info.cwd = Some(root.path().join("other"));
    assert!(!same_session(&session, &info));
    info.cwd = Some(root.path().to_owned());
    info.session_id = Some("another-session".to_owned());
    assert!(!same_session(&session, &info));
    let mut guard = session.live.lock().await;
    let live = guard.as_mut().unwrap();
    live.pending
        .push_back(LogEvent::ModelChanged("claude-opus-5".to_owned()));
    assert_eq!(
        adapter.forward(&session, live, &mut None).unwrap(),
        (false, None)
    );
    while let Ok(event) = output.try_recv() {
        assert_ne!(event["method"], "_session/turn_complete");
    }
}
