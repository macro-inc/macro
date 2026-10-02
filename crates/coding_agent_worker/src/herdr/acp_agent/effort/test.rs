use super::*;
use crate::herdr::acp_agent::test::{save_transcript, test_adapter};
use std::os::unix::fs::PermissionsExt as _;

const PICKER: &str = include_str!("../models/fixtures/codex-effort.txt");

#[test]
fn only_standalone_effort_commands_are_intercepted() {
    for text in ["/effort", " /effort status "] {
        assert_eq!(command(text).unwrap().unwrap(), None);
    }
    for level in ["low", "high", "xhigh", "max", "ultra"] {
        let text = format!("/effort {level}");
        assert_eq!(command(&text).unwrap().unwrap(), Some(level));
    }
    assert_eq!(command("/effort auto").unwrap().unwrap(), Some("default"));
    assert!(command("/effort bogus").unwrap().is_err());
    for text in [
        "/effort high explain this",
        "/effort\nfix this",
        "/effortful",
        "explain /effort",
    ] {
        assert!(command(text).is_none());
    }
}

#[test]
fn explicit_effort_selects_its_row_instead_of_the_highlighted_default() {
    assert_eq!(
        picker_key(Stage::Effort, "gpt-6-sol", "high", PICKER)
            .unwrap()
            .0,
        "3"
    );
    assert_eq!(
        picker_key(Stage::Effort, "gpt-6-sol", "xhigh", PICKER)
            .unwrap()
            .0,
        "4"
    );
    assert!(picker_key(Stage::Effort, "gpt-6-astra", "high", PICKER).is_none());
    assert!(picker_key(Stage::Effort, "gpt-6-sol", "none", PICKER).is_none());
    assert!(picker_key(Stage::Confirmation, "gpt-6-sol", "high", PICKER).is_none());
    assert!(
        picker_key(
            Stage::Effort,
            "gpt-6-sol",
            "high",
            &format!("{PICKER}\nConfirm access to this directory?")
        )
        .is_none()
    );
}

#[test]
fn advanced_effort_requires_the_explicit_requested_level() {
    assert_eq!(
        picker_key(Stage::Effort, "gpt-6-sol", "ultra", PICKER)
            .unwrap()
            .0,
        "5"
    );
    let advanced = "Advanced Reasoning\n⚠ Consumes usage limits faster\n› 1. Max\n  2. Ultra\nPress enter to confirm or esc to go back";
    assert_eq!(
        picker_key(Stage::Advanced, "gpt-6-sol", "max", advanced)
            .unwrap()
            .0,
        "1"
    );
    assert_eq!(
        picker_key(Stage::Advanced, "gpt-6-sol", "ultra", advanced)
            .unwrap()
            .0,
        "2"
    );
    assert!(picker_key(Stage::Effort, "gpt-6-sol", "ultra", advanced).is_none());
    assert!(picker_key(Stage::Advanced, "gpt-6-sol", "high", advanced).is_none());
    assert!(
        picker_key(
            Stage::Advanced,
            "gpt-6-sol",
            "ultra",
            "Allow multiple agents?\n› 1. Yes"
        )
        .is_none()
    );
}

async fn run_command(text: &str, fail: bool) -> (Result<Value, RpcError>, Vec<Value>, String) {
    run_request(Request::Prompt(text), fail).await
}

enum Request<'a> {
    Prompt(&'a str),
    Select(&'a str),
    BusySelect(&'a str),
    Observe,
}

async fn run_request(
    request: Request<'_>,
    fail: bool,
) -> (Result<Value, RpcError>, Vec<Value>, String) {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    save_transcript(root.path(), &id);
    let mut record = Store(root.path().to_owned()).load(&id).unwrap();
    record.kind = TuiAgent::Codex;
    Store(root.path().to_owned()).save(&record).unwrap();
    let initial = include_str!("../models/fixtures/codex-after.txt");
    for (i, screen) in [
        initial,
        include_str!("../models/fixtures/codex-model.txt"),
        PICKER,
        &initial.replace("medium", "high"),
    ]
    .iter()
    .enumerate()
    {
        std::fs::write(root.path().join(format!("screen{i}")), screen).unwrap();
    }
    std::fs::write(root.path().join("stage"), "0").unwrap();
    if fail {
        std::fs::write(root.path().join("fail"), "").unwrap();
    }
    std::fs::create_dir(root.path().join(".codex")).unwrap();
    std::fs::write(
        root.path().join(".codex/models_cache.json"),
        json!({"models":[{
            "slug":"gpt-6-sol","default_reasoning_level":"high",
            "supported_reasoning_levels":[{"effort":"medium"},{"effort":"high"}]
        }]})
        .to_string(),
    )
    .unwrap();
    let script = root.path().join("herdr");
    std::fs::write(
        &script,
        include_str!("fixtures/herdr.sh")
            .replace("ROOT", &shell_words::quote(&root.path().to_string_lossy())),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (mut adapter, mut output) = test_adapter(root.path());
    let inner = Arc::get_mut(&mut adapter).unwrap();
    inner.options.kind = TuiAgent::Codex;
    inner.herdr = Some(HerdrCli::new(script, None));
    inner.home = Some(root.path().to_owned());
    adapter.shutdown.cancel();
    let loaded = adapter
        .load_session(&json!({"sessionId":id,"cwd":root.path()}))
        .await
        .unwrap();
    assert_eq!(loaded["configOptions"][1]["id"], CONFIG_ID);
    assert_eq!(loaded["configOptions"][1]["category"], "thought_level");
    assert_eq!(loaded["configOptions"][1]["currentValue"], "medium");
    assert_eq!(
        loaded["configOptions"][1]["options"],
        json!([
            {"value":"medium","name":"Medium"}, {"value":"high","name":"High"}
        ])
    );
    // Production holds this flag during every session/prompt, including commands.
    let session = adapter.session(&json!({"sessionId":id})).unwrap();
    session
        .prompt_pending
        .store(!matches!(request, Request::Select(_)), Ordering::SeqCst);
    if matches!(request, Request::Observe) {
        std::fs::write(root.path().join("stage"), "3").unwrap();
        let guard = session.live.lock().await;
        adapter.sync_model(&session, guard.as_ref().unwrap()).await;
    }
    let (method, params) = match request {
        Request::Prompt(text) => (
            "session/prompt",
            json!({"sessionId":id,"prompt":[{"type":"text","text":text}]}),
        ),
        Request::Select(value) | Request::BusySelect(value) => (
            "session/set_config_option",
            json!({"sessionId":id,"configId":CONFIG_ID,"value":value}),
        ),
        Request::Observe => ("session/load", json!({"sessionId":id,"cwd":root.path()})),
    };
    if matches!(request, Request::Observe) {
        session.prompt_pending.store(false, Ordering::SeqCst);
    }
    let response = adapter.request(method, params).await;
    let mut updates = Vec::new();
    while let Ok(update) = output.try_recv() {
        updates.push(update);
    }
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    (response, updates, calls)
}

#[tokio::test]
async fn local_effort_changes_are_observed_and_preserved_on_reload() {
    let (response, updates, calls) = run_request(Request::Observe, false).await;
    assert_eq!(
        response.unwrap()["configOptions"][1]["currentValue"],
        "high"
    );
    assert!(
        updates
            .iter()
            .any(|event| event["params"]["update"]["configOptions"][1]["currentValue"] == "high")
    );
    assert!(!calls.contains("agent prompt"));
    assert!(!calls.contains("send-keys"));
}

#[tokio::test]
async fn effort_rpc_selects_current_model_and_requested_effort_and_confirms_in_macro() {
    for text in ["/effort high", "/effort default"] {
        let (response, updates, calls) = run_command(text, false).await;
        assert_eq!(response.unwrap()["stopReason"], "end_turn");
        assert!(updates.iter().any(|event| {
            event["params"]["update"]["content"]["text"]
                .as_str()
                .is_some_and(|text| text.contains("**high** effort with **gpt-6-sol**"))
        }));
        assert!(!calls.contains("/effort"));
        assert!(updates.iter().any(|event| {
            event["params"]["update"]["configOptions"][1]["currentValue"] == "high"
        }));
        let keys: Vec<_> = calls
            .lines()
            .filter(|line| line.starts_with("agent send-keys"))
            .map(|line| line.split_whitespace().last().unwrap())
            .collect();
        assert_eq!(keys, ["2", "3"]);
    }
}

#[tokio::test]
async fn graphical_effort_selection_returns_full_confirmed_configuration_without_chat() {
    let (response, updates, calls) = run_request(Request::Select("high"), false).await;
    let config = response.unwrap()["configOptions"].clone();
    assert_eq!(config[0]["currentValue"], "gpt-6-sol");
    assert_eq!(config[1]["currentValue"], "high");
    assert!(
        updates
            .iter()
            .any(|event| event["params"]["update"]["configOptions"] == config)
    );
    assert!(
        !updates
            .iter()
            .any(|event| event["params"]["update"]["sessionUpdate"] == "agent_message_chunk")
    );
    assert!(calls.contains("agent prompt"));
    assert!(!calls.contains("/effort"));
}

#[tokio::test]
async fn graphical_selection_rejects_busy_unsupported_and_unconfirmed_changes() {
    for (request, fail) in [
        (Request::BusySelect("high"), false),
        (Request::Select("ultra"), false),
        (Request::Select("bogus"), false),
        (Request::Select("high"), true),
    ] {
        let (response, updates, calls) = run_request(request, fail).await;
        assert!(response.is_err());
        assert!(
            !updates.iter().any(
                |event| event["params"]["update"]["configOptions"][1]["currentValue"] == "high"
            )
        );
        if !fail {
            assert!(!calls.contains("agent prompt"));
            assert!(!calls.contains("send-keys"));
        }
    }
}

#[tokio::test]
async fn graphical_selection_of_current_effort_does_not_send_native_input() {
    let (response, _, calls) = run_request(Request::Select("medium"), false).await;
    assert_eq!(
        response.unwrap()["configOptions"][1]["currentValue"],
        "medium"
    );
    assert!(!calls.contains("agent prompt"));
    assert!(!calls.contains("send-keys"));
}

#[tokio::test]
async fn status_and_existing_effort_require_no_native_input() {
    for text in ["/effort", "/effort status", "/effort medium"] {
        let (response, updates, calls) = run_command(text, false).await;
        assert!(response.is_ok());
        assert!(!calls.contains("agent prompt"));
        assert!(!calls.contains("send-keys"));
        assert!(updates.iter().any(|event| {
            event["params"]["update"]["content"]["text"]
                .as_str()
                .is_some_and(|text| text.contains("**medium**"))
        }));
        if text == "/effort" {
            assert!(updates.iter().any(|event| {
                event["params"]["update"]["content"]["text"]
                    .as_str()
                    .is_some_and(|text| text.contains("Available: medium, high"))
            }));
        }
    }
}

#[tokio::test]
async fn failed_or_unsupported_effort_never_claims_success() {
    for (text, fail) in [
        ("/effort high", true),
        ("/effort ultra", false),
        ("/effort bogus", false),
    ] {
        let (response, updates, _) = run_command(text, fail).await;
        assert!(response.is_err());
        assert!(
            !updates
                .iter()
                .any(|event| event["params"]["update"]["sessionUpdate"] == "agent_message_chunk")
        );
    }
}

#[test]
fn ultra_effort_uses_the_double_chevron_composer() {
    assert_eq!(
        codex_footer("» Ask Codex to do anything\n  gpt-6-astra ultra · /repo"),
        Some(("gpt-6-astra", "ultra"))
    );
}
